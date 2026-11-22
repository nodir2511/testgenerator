// Встроенный Postgres для тестов прав доступа: поднимает пустую базу, ставит заглушки Supabase (bootstrap.sql)
// и применяет файлы supabase/sql в порядке их появления. Живая база не затрагивается.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

type Client = pg.Client;

const here = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(here, '../supabase/sql');

/** Порядок применения: как файлы появлялись в проекте (docs/ARCHITECTURE.md, раздел 5). Новый файл допишите в конец. */
export const SCHEMA_FILES = [
  'supabase_schema.sql',
  'security_hardening.sql',
  'security_round2.sql',
  'fix_role_escalation.sql',
  'close_public_read.sql',
  'step2_lock.sql',
  'question_order.sql',
  'usage_limits_stats.sql',
  'telegram_bot.sql',
  'owner_history.sql',
  'generation_limits.sql',
  'subject_roles.sql',
  'subject_roles_options.sql',
  'site_releases.sql',
  'cluster_batches.sql',
  'game.sql',
  'game_v2.sql',
  'game_v3.sql',
  'game_v4.sql',
  'save_ticket_batch.sql',
  'usage_stats_v2.sql',
  'user_prefs.sql',
  'game_v5.sql',
  'game_v6.sql',
  'question_links.sql',
  'question_counts.sql',
  'questions_rls_fast.sql',
  'usage_stats_v3.sql',
  'trash.sql',
  'rls_initplan_indexes.sql',
  'question_children_rls_fast.sql',
  'security_round3.sql',
  'client_errors.sql',
  'security_round4.sql',
  'owner_only_delete_batches.sql',
  'telegram_release_notify.sql',
  'question_usage.sql',
  'duplicate_dismissals.sql',
  'question_usage_counter.sql',
  'update_batch_questions.sql',
  'omr_checks.sql',
  'omr_digit_samples.sql',
  'clinic_class.sql',
  'clinic_class_v2.sql',
  'clinic_class_v3.sql',
  'question_nct_type.sql',
  'question_nct_difficulty.sql',
  'passages.sql',
  'security_round5.sql',
  'deleted_question_options.sql',
];

/** Файлы с данными, а не со схемой: в тестовую базу не применяются */
export const SKIPPED_FILES = ['game_pack_chemistry.sql', 'fix_release_dates_and_missing.sql'];

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });

/** pg_cron и pg_net во встроенном Postgres нет: их заменяют заглушки из bootstrap.sql */
const withoutMissingExtensions = (sql: string) =>
  sql.replace(/^[ \t]*create extension if not exists (pg_cron|pg_net)\b[^;]*;/gim, '-- $&');

export interface SchemaError { file: string; message: string }

export interface TestDb {
  /** Соединение суперпользователя (обходит RLS): для подготовки данных */
  admin: Client;
  /** Ошибки применения файлов схемы (пусто, если всё применилось) */
  schemaErrors: SchemaError[];
  stop: () => Promise<void>;
}

/**
 * Папка с исполняемыми файлами Postgres из пакета embedded-postgres (он нужен только как поставщик сборки).
 * Если путь проекта не латиницей («генератор тестов»), initdb на Windows падает на кодировке,
 * поэтому сборка один раз копируется во временную папку с латинским путём.
 */
function postgresHome(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const pkg = path.resolve(here, `../node_modules/@embedded-postgres/${platform}-${process.arch}`);
  const native = path.join(pkg, 'native');
  if (!fs.existsSync(native)) throw new Error(`Нет сборки Postgres для этой системы: ${pkg}. Выполните npm install.`);
  if (/^[\x00-\x7F]*$/.test(native)) return native;
  const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf-8')).version as string;
  const copy = path.join(os.tmpdir(), `examiner-pg-bin-${version}`);
  if (!fs.existsSync(path.join(copy, '.ready'))) {
    fs.rmSync(copy, { recursive: true, force: true });
    fs.cpSync(native, copy, { recursive: true });
    fs.writeFileSync(path.join(copy, '.ready'), '');
  }
  return copy;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startTestDb(): Promise<TestDb> {
  const home = postgresHome();
  const exe = (name: string) => path.join(home, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'examiner-pg-'));
  const port = await freePort();
  const env = { ...process.env, LC_ALL: 'C', LC_MESSAGES: 'C', LANG: 'C' };

  const init = spawnSync(exe('initdb'), ['-D', databaseDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { env, encoding: 'utf-8' });
  if (init.status !== 0) throw new Error(`initdb не отработал: ${init.stderr || init.stdout || init.error}`);

  let serverLog = '';
  const server: ChildProcess = spawn(exe('postgres'), ['-D', databaseDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off'], { env });
  server.stderr?.on('data', (d) => { serverLog = (serverLog + String(d)).slice(-4000); });

  const connect = async (database: string): Promise<Client> => {
    const c = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database });
    await c.connect();
    return c;
  };
  let boot: Client | null = null;
  for (let i = 0; i < 100 && !boot; i++) {
    try { boot = await connect('postgres'); } catch { await sleep(200); }
  }
  if (!boot) { server.kill(); throw new Error(`Postgres не запустился:\n${serverLog}`); }
  await boot.query('create database examiner');
  await boot.end();

  const admin = await connect('examiner');
  // Сообщения raise notice из миграций не нужны
  await admin.query('set client_min_messages = warning');

  await admin.query(fs.readFileSync(path.join(here, 'bootstrap.sql'), 'utf-8'));

  const schemaErrors: SchemaError[] = [];
  for (const file of SCHEMA_FILES) {
    const sql = withoutMissingExtensions(fs.readFileSync(path.join(SQL_DIR, file), 'utf-8'));
    try {
      await admin.query(sql);
    } catch (e: any) {
      schemaErrors.push({ file, message: String(e?.message ?? e) });
      await admin.query('rollback').catch(() => {});
    }
  }

  return {
    admin,
    schemaErrors,
    stop: async () => {
      await admin.end().catch(() => {});
      const exited = new Promise((r) => server.once('exit', r));
      server.kill();
      await Promise.race([exited, sleep(5000)]);
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(databaseDir, { recursive: true, force: true }); break; } catch { await sleep(300); }
      }
    },
  };
}
