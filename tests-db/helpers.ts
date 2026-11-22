// Данные и действия «от имени пользователя» для тестов прав доступа.
import type pg from 'pg';

type Client = pg.Client;
export type Q = (sql: string, params?: unknown[]) => Promise<any[]>;

export interface Seed {
  users: { owner: string; admin: string; subjAdmin: string; subjTeacher: string; teacher: string };
  subjects: { chem: string; law: string };
  chapters: { chem: string; law: string };
  topics: { chem: string; law: string };
  questions: { chem: string; chemDeleted: string; law: string; lawDeleted: string };
}

const one = async (admin: Client, sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows[0];

/** Аккаунт так, как его создаёт admin-create-user: приглашение → auth.users → профиль из триггера → роль */
async function createUser(admin: Client, email: string, role: string, isOwner = false): Promise<string> {
  await admin.query("insert into public.account_invites (email, expires_at) values ($1, now() + interval '1 hour')", [email]);
  const { id } = await one(admin, 'insert into auth.users (email) values ($1) returning id', [email]);
  await admin.query('update public.profiles set role = $2, is_owner = $3 where id = $1', [id, role, isOwner]);
  return id;
}

export async function seed(admin: Client): Promise<Seed> {
  const users = {
    owner: await createUser(admin, 'owner@test.tj', 'admin', true),
    admin: await createUser(admin, 'admin@test.tj', 'admin'),
    subjAdmin: await createUser(admin, 'subjadmin@test.tj', 'subject_admin'),
    subjTeacher: await createUser(admin, 'subjteacher@test.tj', 'subject_teacher'),
    teacher: await createUser(admin, 'teacher@test.tj', 'user'),
  };
  const subject = async (name: string) => (await one(admin, 'insert into public.subjects (name) values ($1) returning id', [name])).id as string;
  const subjects = { chem: await subject('Химия'), law: await subject('Право') };
  const chapter = async (sid: string) =>
    (await one(admin, "insert into public.chapters (subject_id, name, order_index) values ($1, 'Глава 1', 1) returning id", [sid])).id as string;
  const chapters = { chem: await chapter(subjects.chem), law: await chapter(subjects.law) };
  const topic = async (cid: string) =>
    (await one(admin, "insert into public.topics (chapter_id, name, order_index) values ($1, 'Тема 1', 1) returning id", [cid])).id as string;
  const topics = { chem: await topic(chapters.chem), law: await topic(chapters.law) };
  const question = async (key: 'chem' | 'law', content: string, deleted = false) =>
    (await one(
      admin,
      `insert into public.questions (subject_id, chapter_id, topic_id, type, content, is_deleted, created_by, version)
       values ($1, $2, $3, 'test', $4, $5, $6, 1) returning id`,
      [subjects[key], chapters[key], topics[key], content, deleted, users.owner],
    )).id as string;
  const questions = {
    chem: await question('chem', 'Формула воды'),
    chemDeleted: await question('chem', 'Удалённый вопрос по химии', true),
    law: await question('law', 'Что такое право'),
    lawDeleted: await question('law', 'Удалённый вопрос по праву', true),
  };
  for (const qid of Object.values(questions)) {
    await admin.query(
      `insert into public.question_options (question_id, text, is_correct, order_index)
       values ($1, 'A', true, 1), ($1, 'B', false, 2), ($1, 'C', false, 3), ($1, 'D', false, 4)`,
      [qid],
    );
  }
  // Предмет «Химия» назначен обеим ролям «по предметам»
  await admin.query('insert into public.user_subjects (user_id, subject_id) values ($1, $3), ($2, $3)', [users.subjAdmin, users.subjTeacher, subjects.chem]);
  return { users, subjects, chapters, topics, questions };
}

/**
 * Выполняет запросы так, как их видит PostgREST: роль authenticated (или anon без userId) и claims вошедшего.
 * Всё идёт в транзакции, которая в конце откатывается, — тесты не влияют друг на друга.
 */
export async function as<T>(admin: Client, userId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
  await admin.query('begin');
  try {
    if (userId) {
      await admin.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
      await admin.query('set local role authenticated');
    } else {
      await admin.query("select set_config('request.jwt.claims', '', true)");
      await admin.query('set local role anon');
    }
    return await fn(async (sql, params = []) => (await admin.query(sql, params)).rows);
  } finally {
    await admin.query('rollback');
  }
}

/** Внутри as(): дальше запросы идут от имени другого пользователя (в той же транзакции) */
export async function switchUser(q: Q, userId: string): Promise<void> {
  await q('reset role');
  await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  await q('set local role authenticated');
}

/** Запрос, который должен быть отклонён: возвращает текст ошибки (или null, если прошёл). Транзакция остаётся рабочей. */
export async function rejected(q: Q, sql: string, params: unknown[] = []): Promise<string | null> {
  await q('savepoint attempt');
  try {
    await q(sql, params);
    await q('release savepoint attempt');
    return null;
  } catch (e: any) {
    await q('rollback to savepoint attempt');
    return String(e?.message ?? e);
  }
}

/** Снимок вопроса для билета — как его кладёт генератор */
export const snapshot = (id: string) => ({ id, type: 'test', content: 'Вопрос', options: [] });
