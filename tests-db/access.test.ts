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
  it('счётчик использования вопроса растёт при сохранении набора', async () => {
    const used = await as(db.admin, s.users.owner, async (q) => {
      await saveBatch(q, s.subjects.chem, s.questions.chem);
      return (await q('select times_used from public.question_usage where question_id = $1', [s.questions.chem]))[0]?.times_used;
    });
    expect(used).toBe(1);
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
  it('журнал аудита преподавателю не виден и из приложения не пополняется', async () => {
    const res = await as(db.admin, s.users.teacher, async (q) => ({
      insertErr: await rejected(q, "insert into public.audit_logs (user_id, action, entity_type) values ($1, 'x', 'y')", [s.users.teacher]),
      rows: (await q('select id from public.audit_logs')).length,
    }));
    expect(res.insertErr).not.toBeNull();
    expect(res.rows).toBe(0);
  });
  it('без входа закрыты профили, наборы билетов и служебные таблицы', async () => {
    for (const table of ['profiles', 'ticket_batches', 'user_subjects', 'audit_logs', 'telegram_links']) {
      const err = await as(db.admin, null, (q) => rejected(q, `select * from public.${table} limit 1`));
      expect(err, table).toMatch(/permission denied/);
    }
  });
});
