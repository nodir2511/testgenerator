// Права доступа (RLS) и функции базы на встроенном Postgres. Источник ожиданий — docs/ARCHITECTURE.md, разделы 3 и 4.4.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './db';
import { as, rejected, seed, snapshot, switchUser, type Q, type Seed } from './helpers';

let db: TestDb;
let s: Seed;
beforeAll(async () => {
  db = await startTestDb();
  if (db.schemaErrors.length === 0) s = await seed(db.admin);
});
afterAll(async () => { await db?.stop(); });

const ids = (rows: any[]) => rows.map((r) => r.id).sort();
const visibleQuestions = (userId: string | null) => as(db.admin, userId, async (q) => ids(await q('select id from public.questions')));
const saveBatch = (q: Q, subjectId: string, questionId: string, params: Record<string, unknown> = {}) =>
  q('select public.save_ticket_batch($1::jsonb, $2::jsonb) as r', [
    JSON.stringify({ title: 'Набор', subject_id: subjectId, generation_params: params }),
    JSON.stringify([{ ticket_number: 1, questions: [{ question_id: questionId, order_index: 1, question_snapshot: snapshot(questionId) }] }]),
  ]).then((rows) => rows[0].r);
const emptyBatch = (title: string, subjectId: string, params: Record<string, unknown> = {}) =>
  [JSON.stringify({ title, subject_id: subjectId, generation_params: params }), '[]'];

describe('схема из supabase/sql', () => {
  it('применяется с нуля без ошибок', () => {
    expect(db.schemaErrors).toEqual([]);
  });
});

describe('вопросы: кто что видит', () => {
  it('без входа вопросы недоступны', async () => {
    const err = await as(db.admin, null, (q) => rejected(q, 'select id from public.questions'));
    expect(err).toMatch(/permission denied/);
  });
  it('преподаватель видит неудалённые вопросы всех предметов', async () => {
    expect(await visibleQuestions(s.users.teacher)).toEqual([s.questions.chem, s.questions.law].sort());
  });
  it('преподаватель по предметам — только неудалённые своего предмета', async () => {
    expect(await visibleQuestions(s.users.subjTeacher)).toEqual([s.questions.chem]);
  });
  it('админ по предметам — все вопросы своего предмета, включая удалённые', async () => {
    expect(await visibleQuestions(s.users.subjAdmin)).toEqual([s.questions.chem, s.questions.chemDeleted].sort());
  });
  it('админ видит всё, включая удалённые', async () => {
    expect(await visibleQuestions(s.users.admin)).toEqual(Object.values(s.questions).sort());
  });
  it('варианты ответа чужого предмета преподавателю по предметам не видны', async () => {
    const rows = await as(db.admin, s.users.subjTeacher, (q) => q('select distinct question_id as id from public.question_options'));
    const seen = ids(rows);
    expect(seen).toContain(s.questions.chem);
    expect(seen).not.toContain(s.questions.law);
    expect(seen).not.toContain(s.questions.lawDeleted);
  });
  it('варианты удалённых вопросов видны только тем, кто видит сами удалённые вопросы', async () => {
    const optionsOf = (userId: string) =>
      as(db.admin, userId, async (q) => ids(await q('select distinct question_id as id from public.question_options')));
    expect(await optionsOf(s.users.subjTeacher)).toEqual([s.questions.chem]);
    expect(await optionsOf(s.users.teacher)).toEqual([s.questions.chem, s.questions.law].sort());
    expect(await optionsOf(s.users.subjAdmin)).toEqual([s.questions.chem, s.questions.chemDeleted].sort());
    expect(await optionsOf(s.users.admin)).toEqual(Object.values(s.questions).sort());
  });
  it('пары соответствия удалённого вопроса преподавателю по предметам не видны', async () => {
    const seen = await as(db.admin, s.users.subjTeacher, async (q) => {
      await q('reset role');
      await q("insert into public.matching_items (question_id, side, text, order_index) values ($1, 'left', 'удалённый', 1), ($2, 'left', 'живой', 1)",
        [s.questions.chemDeleted, s.questions.chem]);
      await q('set local role authenticated');
      return ids(await q('select distinct question_id as id from public.matching_items'));
    });
    expect(seen).toEqual([s.questions.chem]);
  });
});

describe('вопросы: кто что меняет', () => {
  const update = (userId: string, qid: string) =>
    as(db.admin, userId, async (q) => (await q("update public.questions set content = 'правка' where id = $1 returning id", [qid])).length);
  it('преподаватель не может править вопрос', async () => {
    expect(await update(s.users.teacher, s.questions.chem)).toBe(0);
  });
  it('админ по предметам правит свой предмет и не правит чужой', async () => {
    expect(await update(s.users.subjAdmin, s.questions.chem)).toBe(1);
    expect(await update(s.users.subjAdmin, s.questions.law)).toBe(0);
  });
  it('преподаватель не может добавить вопрос', async () => {
    const err = await as(db.admin, s.users.teacher, (q) => rejected(q,
      "insert into public.questions (subject_id, chapter_id, topic_id, type, content, version) values ($1, $2, $3, 'test', 'x', 1)",
      [s.subjects.chem, s.chapters.chem, s.topics.chem]));
    expect(err).toMatch(/row-level security/);
  });
  it('физически удалить вопрос может только админ', async () => {
    const del = (userId: string) =>
      as(db.admin, userId, async (q) => (await q('delete from public.questions where id = $1 returning id', [s.questions.chemDeleted])).length);
    expect(await del(s.users.subjAdmin)).toBe(0);
    expect(await del(s.users.admin)).toBe(1);
  });
});

describe('роли и предметы', () => {
  it('пользователь не может поднять себе роль', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      const err = await rejected(q, "update public.profiles set role = 'admin' where id = $1", [s.users.teacher]);
      return { err, role: (await q('select role from public.profiles where id = $1', [s.users.teacher]))[0].role };
    });
    expect(res.err).not.toBeNull();
    expect(res.role).toBe('user');
  });
  it('админ не может сделать себя главным админом', async () => {
    const after = await as(db.admin, s.users.admin, async (q) => {
      await rejected(q, 'update public.profiles set is_owner = true where id = $1', [s.users.admin]);
      return (await q('select is_owner from public.profiles where id = $1', [s.users.admin]))[0].is_owner;
    });
    expect(after).toBe(false);
  });
  it('пользователь видит только свой профиль, админ — все', async () => {
    expect(await as(db.admin, s.users.teacher, async (q) => (await q('select id from public.profiles')).length)).toBe(1);
    expect(await as(db.admin, s.users.admin, async (q) => (await q('select id from public.profiles')).length)).toBe(5);
  });
  it('предметы назначает только главный админ', async () => {
    const assign = (userId: string) => as(db.admin, userId, (q) => rejected(q,
      'insert into public.user_subjects (user_id, subject_id) values ($1, $2)', [s.users.subjTeacher, s.subjects.law]));
    expect(await assign(s.users.admin)).toMatch(/row-level security/);
    expect(await assign(s.users.owner)).toBeNull();
  });
  it('регистрация без приглашения отклоняется', async () => {
    await db.admin.query('begin');
    const err = await db.admin.query("insert into auth.users (email) values ('stranger@test.tj')").then(() => null, (e) => String(e.message));
    await db.admin.query('rollback');
    expect(err).toMatch(/Регистрация закрыта/);
  });
});

describe('наборы билетов', () => {
  it('набор виден автору и главному админу, но не другим', async () => {
    const seen = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const seenBy = async (userId: string) => {
        await switchUser(q, userId);
        return (await q('select id from public.ticket_batches where id = $1', [r.batch.id])).length;
      };
      return {
        author: await seenBy(s.users.teacher),
        owner: await seenBy(s.users.owner),
        admin: await seenBy(s.users.admin),
        other: await seenBy(s.users.subjTeacher),
      };
    });
    expect(seen).toEqual({ author: 1, owner: 1, admin: 0, other: 0 });
  });
  it('удалить набор может только главный админ', async () => {
    const tryDelete = (deleter: string) => as(db.admin, s.users.owner, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      await switchUser(q, deleter);
      return (await q('delete from public.ticket_batches where id = $1 returning id', [r.batch.id])).length;
    });
    expect(await tryDelete(s.users.admin)).toBe(0);
    expect(await tryDelete(s.users.owner)).toBe(1);
  });
  it('кластерный набор обычный преподаватель создать не может', async () => {
    const err = await as(db.admin, s.users.teacher, (q) => rejected(q, 'select public.save_ticket_batch($1::jsonb, $2::jsonb)',
      emptyBatch('Кластер', s.subjects.chem, { source: 'cluster' })));
    expect(err).toMatch(/row-level security/);
  });
  it('update_batch_questions: чужой набор менять нельзя, кластерный — никому', async () => {
    const res = await as(db.admin, s.users.owner, async (q) => {
      const own = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const cluster = await saveBatch(q, s.subjects.chem, s.questions.chem, { source: 'cluster' });
      const clusterErr = await rejected(q, "select public.update_batch_questions($1, '[]'::jsonb)", [cluster.batch.id]);
      await switchUser(q, s.users.admin);
      const foreignErr = await rejected(q, "select public.update_batch_questions($1, '[]'::jsonb)", [own.batch.id]);
      return { clusterErr, foreignErr };
    });
    expect(res.clusterErr).toMatch(/кластера менять нельзя/);
    expect(res.foreignErr).toMatch(/только его автор/);
  });
  it('update_batch_questions: автор правит текст вопроса в своём наборе, вопрос в банке не меняется', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const tq = (await q('select tq.id from public.ticket_questions tq join public.tickets t on t.id = tq.ticket_id where t.batch_id = $1', [r.batch.id]))[0];
      const edited = { ...snapshot(s.questions.chem), content: 'Правка в наборе', edited: true };
      await q('select public.update_batch_questions($1, $2::jsonb)', [
        r.batch.id, JSON.stringify([{ ticket_question_id: tq.id, question_id: s.questions.chem, question_snapshot: edited }]),
      ]);
      return {
        snap: (await q('select question_id, question_snapshot from public.ticket_questions where id = $1', [tq.id]))[0],
        bank: (await q('select content from public.questions where id = $1', [s.questions.chem]))[0].content,
        used: (await q('select times_used from public.question_usage where question_id = $1', [s.questions.chem]))[0].times_used,
      };
    });
    expect(res.snap.question_id).toBe(s.questions.chem);
    expect(res.snap.question_snapshot).toMatchObject({ content: 'Правка в наборе', edited: true });
    expect(res.bank).toBe('Формула воды');
    expect(res.used).toBe(1);
  });
  it('счётчик использования вопроса растёт при сохранении набора', async () => {
    const used = await as(db.admin, s.users.owner, async (q) => {
      await saveBatch(q, s.subjects.chem, s.questions.chem);
      return (await q('select times_used from public.question_usage where question_id = $1', [s.questions.chem]))[0]?.times_used;
    });
    expect(used).toBe(1);
  });
});

describe('билеты классу', () => {
  const newAttempt = async (q: Q, code: string, ticketId: string, tgUser = 1001) =>
    q(`insert into public.exam_attempts (code, tg_user_id, student_name, ticket_id, deadline_at)
       values ($1, $2, 'Ученик', $3, now() + interval '30 minutes')`, [code, tgUser, ticketId]);
  it('автор создаёт запуск своего набора и видит его; другой преподаватель — нет, главный админ — да', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const link = (await q('select * from public.exam_link_create($1)', [r.batch.id]))[0];
      const seen = async (userId: string) => {
        await switchUser(q, userId);
        return (await q('select code from public.exam_links where code = $1', [link.code])).length;
      };
      return {
        link,
        author: await seen(s.users.teacher),
        owner: await seen(s.users.owner),
        other: await seen(s.users.subjTeacher),
        admin: await seen(s.users.admin),
      };
    });
    expect(res.link.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(res.link.created_by).toBe(s.users.teacher);
    expect(res.link.duration_min).toBe(30);
    expect(new Date(res.link.closes_at).getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
    expect(res.link.closed_at).toBeNull();
    expect({ author: res.author, owner: res.owner, other: res.other, admin: res.admin }).toEqual({ author: 1, owner: 1, other: 0, admin: 0 });
  });

  it('попытки видны автору запуска и главному админу, но не другому преподавателю', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const link = (await q('select * from public.exam_link_create($1)', [r.batch.id]))[0];
      const ticket = (await q('select id from public.tickets where batch_id = $1', [r.batch.id]))[0].id;
      await q('reset role');
      await newAttempt(q, link.code, ticket);
      const seen = async (userId: string) => {
        await switchUser(q, userId);
        return (await q('select id from public.exam_attempts')).length;
      };
      return { author: await seen(s.users.teacher), owner: await seen(s.users.owner), other: await seen(s.users.subjTeacher) };
    });
    expect(res).toEqual({ author: 1, owner: 1, other: 0 });
  });

  it('exam_link_close: автор и главный админ закрывают, другой преподаватель получает отказ', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const link = (await q('select * from public.exam_link_create($1)', [r.batch.id]))[0];
      await switchUser(q, s.users.subjTeacher);
      const foreign = await rejected(q, 'select public.exam_link_close($1)', [link.code]);
      await switchUser(q, s.users.teacher);
      await q('select public.exam_link_close($1)', [link.code]);
      const closed = (await q('select closed_at from public.exam_links where code = $1', [link.code]))[0].closed_at;
      return { foreign, closed };
    });
    expect(res.foreign).toMatch(/Закрыть запуск может только его автор/);
    expect(res.closed).not.toBeNull();
  });

  it('exam_link_create: чужой набор — отказ, несуществующий — отказ, главный админ может любой', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const missing = await rejected(q, 'select public.exam_link_create($1)', ['00000000-0000-0000-0000-000000000000']);
      await switchUser(q, s.users.subjTeacher);
      const foreign = await rejected(q, 'select public.exam_link_create($1)', [r.batch.id]);
      await switchUser(q, s.users.owner);
      const ownerOk = await rejected(q, 'select public.exam_link_create($1)', [r.batch.id]);
      return { missing, foreign, ownerOk };
    });
    expect(res.missing).toMatch(/Набор билетов не найден/);
    expect(res.foreign).toMatch(/Запустить набор может только его автор/);
    expect(res.ownerOk).toBeNull();
  });

  it('кластерный набор классу запустить нельзя', async () => {
    const err = await as(db.admin, s.users.owner, async (q) => {
      const cluster = await saveBatch(q, s.subjects.chem, s.questions.chem, { source: 'cluster' });
      return rejected(q, 'select public.exam_link_create($1)', [cluster.batch.id]);
    });
    expect(err).toMatch(/Кластерный набор/);
  });

  it('прямая запись из приложения запрещена', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const link = (await q('select * from public.exam_link_create($1)', [r.batch.id]))[0];
      const ticket = (await q('select id from public.tickets where batch_id = $1', [r.batch.id]))[0].id;
      return {
        attempt: await rejected(q, `insert into public.exam_attempts (code, tg_user_id, student_name, ticket_id, deadline_at)
          values ($1, 1, 'Х', $2, now())`, [link.code, ticket]),
        linkInsert: await rejected(q, `insert into public.exam_links (code, batch_id, created_by, closes_at)
          values ('ZZZZZZ', $1, $2, now())`, [r.batch.id, s.users.teacher]),
        linkUpdate: await rejected(q, "update public.exam_links set duration_min = 999 where code = $1", [link.code]),
        linkDelete: await rejected(q, 'delete from public.exam_links where code = $1', [link.code]),
      };
    });
    expect(res.attempt).toMatch(/permission denied/);
    expect(res.linkInsert).toMatch(/permission denied/);
    expect(res.linkUpdate).toMatch(/permission denied/);
    expect(res.linkDelete).toMatch(/permission denied/);
  });

  it('без входа таблицы и функции недоступны', async () => {
    const res = await as(db.admin, null, async (q) => ({
      links: await rejected(q, 'select * from public.exam_links'),
      attempts: await rejected(q, 'select * from public.exam_attempts'),
      create: await rejected(q, 'select public.exam_link_create($1)', ['00000000-0000-0000-0000-000000000000']),
      close: await rejected(q, "select public.exam_link_close('AAAAAA')"),
    }));
    expect(res.links).toMatch(/permission denied/);
    expect(res.attempts).toMatch(/permission denied/);
    expect(res.create).toMatch(/permission denied/);
    expect(res.close).toMatch(/permission denied/);
  });

  it('удаление набора удаляет запуск и попытки; (code, tg_user_id) уникально', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const link = (await q('select * from public.exam_link_create($1)', [r.batch.id]))[0];
      const ticket = (await q('select id from public.tickets where batch_id = $1', [r.batch.id]))[0].id;
      await q('reset role');
      await newAttempt(q, link.code, ticket);
      const dup = await rejected(q, `insert into public.exam_attempts (code, tg_user_id, student_name, ticket_id, deadline_at)
        values ($1, 1001, 'Дубль', $2, now())`, [link.code, ticket]);
      await q('delete from public.ticket_batches where id = $1', [r.batch.id]);
      return {
        dup,
        links: (await q('select 1 from public.exam_links where code = $1', [link.code])).length,
        attempts: (await q('select 1 from public.exam_attempts where code = $1', [link.code])).length,
      };
    });
    expect(res.dup).toMatch(/duplicate key|unique/);
    expect(res.links).toBe(0);
    expect(res.attempts).toBe(0);
  });
});

describe('лимиты генерации', () => {
  it('преподаватель упирается в дневной лимит, админ — нет', async () => {
    const perDay = (await db.admin.query('select per_day from public.generation_settings')).rows[0].per_day as number;
    const run = (userId: string) => as(db.admin, userId, async (q) => {
      // Пауза между генерациями не должна мешать проверке дневного лимита
      await q('reset role');
      await q('update public.generation_settings set cooldown_seconds = 0');
      await q('set local role authenticated');
      let err: string | null = null;
      for (let i = 0; i < perDay + 1 && !err; i++) {
        err = await rejected(q, 'select public.save_ticket_batch($1::jsonb, $2::jsonb)', emptyBatch(`Набор ${i}`, s.subjects.chem));
      }
      return err;
    });
    expect(await run(s.users.teacher)).not.toBeNull();
    expect(await run(s.users.admin)).toBeNull();
  });
});

describe('служебные таблицы', () => {
  it('журнал ошибок интерфейса читает только главный админ', async () => {
    const count = (userId: string) => as(db.admin, userId, async (q) => {
      await q("select public.report_client_error('проба')");
      return (await q('select id from public.client_errors')).length;
    });
    expect(await count(s.users.admin)).toBe(0);
    expect(await count(s.users.owner)).toBe(1);
  });
  it('журнал ошибок хранит записи 400 дней (нужно годовой сводке) и сохраняет лимит на отправителя', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => {
      await q('reset role');
      await q(`insert into public.client_errors (created_at, user_id, message) values
        (now() - interval '100 days', null, 'сто дней назад'), (now() - interval '500 days', null, 'полтора года назад')`);
      await switchUser(q, s.users.teacher);
      for (let i = 0; i < 15; i++) await q('select public.report_client_error($1)', [`ошибка ${i}`]);
      await q('reset role');
      const old = (await q("select message from public.client_errors where message like '%назад' order by message")).map((r) => r.message);
      const mine = (await q("select count(*)::int as n from public.client_errors where user_id = $1", [s.users.teacher]))[0].n;
      return { old, mine };
    });
    expect(res.old).toEqual(['сто дней назад']);
    expect(res.mine).toBe(10); // не больше 10 записей в минуту от одного отправителя
  });
  it('журнал аудита преподавателю не виден и из приложения не пополняется', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => ({
      insertErr: await rejected(q, "insert into public.audit_logs (user_id, action, entity_type) values ($1, 'x', 'y')", [s.users.teacher]),
      rows: (await q('select id from public.audit_logs')).length,
    }));
    expect(res.insertErr).not.toBeNull();
    expect(res.rows).toBe(0);
  });
  it('журнал отката массовых правок закрыт для всех ролей приложения, даже для главного админа', async () => {
    for (const userId of [s.users.owner, s.users.teacher, null]) {
      const err = await as(db.admin, userId, (q) => rejected(q, 'select * from public.bulk_change_backups limit 1'));
      expect(err).toMatch(/permission denied/);
    }
  });
  it('без входа закрыты профили, наборы билетов и служебные таблицы', async () => {
    for (const table of ['profiles', 'ticket_batches', 'user_subjects', 'audit_logs', 'telegram_links']) {
      const err = await as(db.admin, null, (q) => rejected(q, `select * from public.${table} limit 1`));
      expect(err, table).toMatch(/permission denied/);
    }
  });
});

describe('ускорение (perf_round1.sql)', () => {
  /** Вопрос, созданный в обход RLS (перед вызовом — reset role) */
  const addQuestion = async (q: Q, key: 'chem' | 'law', type: string, extra: { answer?: number; deleted?: boolean } = {}) =>
    (await q(
      `insert into public.questions (subject_id, chapter_id, topic_id, type, content, is_deleted, created_by, version, correct_numeric_answer)
       values ($1, $2, $3, $4, 'проверка', $5, $6, 1, $7) returning id`,
      [s.subjects[key], s.chapters[key], s.topics[key], type, extra.deleted ?? false, s.users.owner, extra.answer ?? null],
    ))[0].id as string;
  const addOptions = (q: Q, qid: string, correct: boolean[]) =>
    q(`insert into public.question_options (question_id, text, is_correct, order_index)
       select $1, 'v' || i, c, i from unnest($2::boolean[]) with ordinality as t(c, i)`, [qid, correct]);
  /** Соответствие: left левых, right правых; linked — сколько левых получают правильный ответ */
  const addMatching = async (q: Q, qid: string, left: number, right: number, linked: number) => {
    const rights = await q(
      `insert into public.matching_items (question_id, side, text, order_index)
       select $1, 'right', 'r' || i, i from generate_series(1, $2::int) i returning id`, [qid, right]);
    for (let i = 1; i <= left; i++) {
      await q(`insert into public.matching_items (question_id, side, text, order_index, correct_match_id) values ($1, 'left', $2, $3, $4)`,
        [qid, `l${i}`, i, i <= linked ? rights[(i - 1) % rights.length].id : null]);
    }
  };
  const withIssue = async (q: Q, issue: string, subjectId: string | null = null) =>
    ids(await q('select id from public.questions_with_issue($1, $2)', [issue, subjectId]));

  it('questions_with_issue находит вопросы без ответа и не по стандарту', async () => {
    const res = await as(db.admin, s.users.admin, async (q) => {
      await q('reset role');
      const made = {
        threeOptions: await addQuestion(q, 'chem', 'test'),
        twoCorrect: await addQuestion(q, 'chem', 'test'),
        noCorrect: await addQuestion(q, 'chem', 'test'),
        noOptions: await addQuestion(q, 'chem', 'test'),
        openEmpty: await addQuestion(q, 'chem', 'open'),
        openOk: await addQuestion(q, 'chem', 'open', { answer: 12 }),
        matchOk: await addQuestion(q, 'chem', 'matching'),
        matchUnlinked: await addQuestion(q, 'chem', 'matching'),
        matchThreeLeft: await addQuestion(q, 'chem', 'matching'),
        matchFourRight: await addQuestion(q, 'chem', 'matching'),
        deletedBroken: await addQuestion(q, 'chem', 'test', { deleted: true }),
      };
      await addOptions(q, made.threeOptions, [true, false, false]);
      await addOptions(q, made.twoCorrect, [true, true, false, false]);
      await addOptions(q, made.noCorrect, [false, false, false, false]);
      await addMatching(q, made.matchOk, 4, 5, 4);
      await addMatching(q, made.matchUnlinked, 4, 5, 3);
      await addMatching(q, made.matchThreeLeft, 3, 5, 3);
      await addMatching(q, made.matchFourRight, 4, 4, 4);
      await switchUser(q, s.users.admin);
      return { made, any: await withIssue(q, 'any'), noAnswer: await withIssue(q, 'no_answer'), count: await withIssue(q, 'count') };
    });
    const m = res.made;
    expect(res.any).toEqual([m.threeOptions, m.twoCorrect, m.noCorrect, m.noOptions, m.openEmpty, m.matchUnlinked, m.matchThreeLeft, m.matchFourRight].sort());
    expect(res.noAnswer).toEqual([m.noCorrect, m.noOptions, m.openEmpty, m.matchUnlinked].sort());
    expect(res.count).toEqual([m.threeOptions, m.noOptions, m.matchThreeLeft, m.matchFourRight].sort());
  });
  it('questions_with_issue показывает только доступные вопросы и умеет отбирать по предмету', async () => {
    const res = await as(db.admin, s.users.admin, async (q) => {
      await q('reset role');
      const chem = await addQuestion(q, 'chem', 'open');
      const law = await addQuestion(q, 'law', 'open');
      await switchUser(q, s.users.admin);
      const admin = await withIssue(q, 'any');
      const adminLaw = await withIssue(q, 'any', s.subjects.law);
      await switchUser(q, s.users.subjTeacher);
      const subjTeacher = await withIssue(q, 'any');
      return { chem, law, admin, adminLaw, subjTeacher };
    });
    expect(res.admin).toEqual([res.chem, res.law].sort());
    expect(res.adminLaw).toEqual([res.law]);
    expect(res.subjTeacher).toEqual([res.chem]);
  });
  it('questions_linking_to: кто ссылается на вопрос — только видимые и неудалённые', async () => {
    const res = await as(db.admin, s.users.admin, async (q) => {
      await q('reset role');
      const made = {
        chem: await addQuestion(q, 'chem', 'open', { answer: 1 }),
        law: await addQuestion(q, 'law', 'open', { answer: 1 }),
        deleted: await addQuestion(q, 'chem', 'open', { answer: 1, deleted: true }),
        elsewhere: await addQuestion(q, 'chem', 'open', { answer: 1 }),
      };
      await q('update public.questions set linked_ids = $2::uuid[] where id = any($1::uuid[])', [[made.chem, made.law, made.deleted], [s.questions.chem]]);
      await q('update public.questions set linked_ids = $2::uuid[] where id = $1', [made.elsewhere, [s.questions.law]]);
      const find = async (userId: string) => {
        await switchUser(q, userId);
        return ids(await q('select id from public.questions_linking_to($1::uuid[])', [[s.questions.chem]]));
      };
      return { made, admin: await find(s.users.admin), subjTeacher: await find(s.users.subjTeacher), teacher: await find(s.users.teacher) };
    });
    expect(res.admin).toEqual([res.made.chem, res.made.law].sort());
    expect(res.teacher).toEqual([res.made.chem, res.made.law].sort());
    expect(res.subjTeacher).toEqual([res.made.chem]);
    const anon = await as(db.admin, null, (q) => rejected(q, 'select id from public.questions_linking_to($1::uuid[])', [[s.questions.chem]]));
    expect(anon).toMatch(/permission denied/);
  });
  it('билеты и вопросы набора видны автору и главному админу, но не другим', async () => {
    const seen = await as(db.admin, s.users.teacher, async (q) => {
      const r = await saveBatch(q, s.subjects.chem, s.questions.chem);
      const seenBy = async (userId: string) => {
        await switchUser(q, userId);
        const tickets = (await q('select id from public.tickets where batch_id = $1', [r.batch.id])).length;
        const questions = (await q('select tq.id from public.ticket_questions tq where tq.ticket_id = any($1::uuid[])', [r.tickets.map((t: any) => t.id)])).length;
        return [tickets, questions];
      };
      return {
        author: await seenBy(s.users.teacher),
        owner: await seenBy(s.users.owner),
        admin: await seenBy(s.users.admin),
        other: await seenBy(s.users.subjTeacher),
      };
    });
    expect(seen).toEqual({ author: [1, 1], owner: [1, 1], admin: [0, 0], other: [0, 0] });
  });
  it('версии «Что нового»: пишет только главный админ, читатель видит пункты своего уровня', async () => {
    const res = await as(db.admin, s.users.owner, async (q) => {
      const rel = async (version: string, items: Array<[number, string]>) => {
        const id = (await q('insert into public.site_releases (version, title) values ($1, $1) returning id', [version]))[0].id as string;
        for (const [rank, scope] of items) {
          await q("insert into public.site_release_items (release_id, kind, text, min_rank, scope) values ($1, 'new', 'пункт', $2, $3)", [id, rank, scope]);
        }
        return id;
      };
      const forAll = await rel('9.0.1', [[1, 'site'], [3, 'site']]);
      const forAdmins = await rel('9.0.2', [[3, 'site']]);
      const gameOnly = await rel('9.0.3', [[1, 'game']]);
      const mine = [forAll, forAdmins, gameOnly];
      const visible = async () => ids(await q('select id from public.site_releases where id = any($1::uuid[])', [mine]));
      const unread = async () => ids(await q('select id from public.unread_site_releases() where id = any($1::uuid[])', [mine]));
      const owner = { visible: await visible(), unread: await unread() };
      await switchUser(q, s.users.admin);
      const adminInsert = await rejected(q, "insert into public.site_releases (version, title) values ('9.9.9', 'x')");
      const adminItem = await rejected(q, "insert into public.site_release_items (release_id, kind, text) values ($1, 'new', 'x')", [forAll]);
      const adminDeleted = (await q('delete from public.site_releases where id = $1 returning id', [forAll])).length;
      await switchUser(q, s.users.teacher);
      const teacher = { visible: await visible(), unread: await unread() };
      const teacherItems = (await q('select id from public.site_release_items where release_id = $1', [forAll])).length;
      await q('insert into public.site_release_reads (user_id, release_id) values ($1, $2)', [s.users.teacher, forAll]);
      const teacherAfterRead = await unread();
      return { forAll, forAdmins, gameOnly, owner, adminInsert, adminItem, adminDeleted, teacher, teacherItems, teacherAfterRead };
    });
    expect(res.owner.visible).toEqual([res.forAll, res.forAdmins, res.gameOnly].sort());
    expect(res.owner.unread).toEqual([res.forAll, res.forAdmins].sort());
    expect(res.adminInsert).toMatch(/row-level security/);
    expect(res.adminItem).toMatch(/row-level security/);
    expect(res.adminDeleted).toBe(0);
    expect(res.teacher.visible).toEqual([res.forAll, res.gameOnly].sort());
    expect(res.teacher.unread).toEqual([res.forAll]);
    expect(res.teacherItems).toBe(1);
    expect(res.teacherAfterRead).toEqual([]);
  });
});
