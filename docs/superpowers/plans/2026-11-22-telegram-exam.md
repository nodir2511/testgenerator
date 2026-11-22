# Прохождение билета в Telegram — план реализации

> **Для исполнителя:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans. Шаги — чекбоксы (`- [ ]`).

**Цель:** преподаватель запускает обычный набор билетов классу из раздела сайта «Билеты классу», ученики проходят случайный вариант внутри Telegram за 30 минут, преподаватель видит обновляющуюся таблицу, разбор по вопросам и отправляет ученикам разбор.

**Архитектура:** чистая логика экзамена (очистка снимка от ответов, баллы, сроки, текст разбора) лежит в `supabase/functions/_shared/exam.ts` без импортов — её используют и сервер, и сайт, и тесты. Ученик работает со страницей `/tg/exam` только через новую Edge Function `tg-exam` (личность — из подписи Telegram, ключи на телефон не уходят). Преподаватель создаёт и закрывает запуск функциями базы под своим входом, результаты читает напрямую из таблиц по RLS.

**Стек:** React 19, TypeScript, TanStack Query 5, Tailwind 3, Supabase (Postgres 17, Edge Functions на Deno), Telegram Bot API и Mini Apps, vitest 5, встроенный Postgres для тестов прав доступа (`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-11-22-telegram-exam-design.md` (согласован владельцем).

## Global Constraints

- **Ключи не покидают сервер до конца экзамена.** Ни `is_correct`, ни `correct_match_id`, ни `correct_numeric_answer` не попадают в ответ `tg-exam`, пока попытка не сдана и преподаватель не отправил разбор. Баллы считает только сервер.
- **Только обычные наборы.** Кластерный набор (`generation_params.source = 'cluster'`) запустить нельзя: отказ и в базе, и в интерфейсе.
- **Ученикам недоступно мини-приложение преподавателя:** страница `/tg/exam` — отдельный экран; действия `tg-exam` не дают доступа к данным `tg-app`.
- Вариант ученику — **случайный** из билетов набора. На прохождение — **30 минут** по серверным часам. Ссылка живёт до закрытия преподавателем, но **не дольше 24 часов**. Одна попытка на аккаунт Telegram по одной ссылке.
- Баллы: тест **1**, верный пункт соответствия **1**, открытый **2** (как `POINTS` в `_shared/omrScore.ts`).
- Сразу после сдачи ученик видит **только баллы**; верные ответы — после отправки разбора.
- Термины интерфейса из `CLAUDE.md`: билет (вариант), набор, мини-приложение. Раздел называется «Билеты классу», действие — «Запустить классу».
- `_shared/exam.ts` — **без импортов** (как `ticketing.ts`), сайт подключает его напрямую.
- Новая функция: по `CLAUDE.md` копится **без коммита**, черновики пунктов — в `scratch/pending-release/`. Деплой функций и применение SQL — только с явного согласия владельца.
- В папке могут работать другие сессии: не делать `git stash/checkout/reset`, чужие незакоммиченные правки не трогать.
- Проверка каждой задачи: `npx tsc -b`, `npx vitest run`, для SQL — `npm run test:db`; новые цветовые классы → `npm run theme:dark`.
- Структурные изменения → `docs/ARCHITECTURE.md` (Task 9).

## Review Focus

1. **Ключ в ответе сервера.** Ответ действий `open`/`start`/`save`/`submit` ученика не содержит верных ответов ни в каком поле (в том числе во вложенном `passage` и в «лишних» ключах снимка).
2. **Вторая попытка и гонка.** Два одновременных `start` от одного аккаунта дают одну попытку (уникальность в базе), а не две с разными вариантами.
3. **Сдача после срока.** `save` и `submit` после `deadline_at` не меняют ответы: работа сдаётся с тем, что было сохранено вовремя.
4. **Набор удалили или вопрос заменили во время экзамена.** Попытка хранит свой билет; удаление набора удаляет запуск и попытки каскадом, страница ученика показывает понятное сообщение, а не падает.
5. **Чужой преподаватель.** Не видит чужие запуски и попытки, не может закрыть чужой запуск и разослать по нему разбор; главный админ видит все.

---

### Task 1: Чистая логика экзамена — `_shared/exam.ts`

**Files:**
- Create: `supabase/functions/_shared/exam.ts`, `tests/exam.test.ts`

**Interfaces (Produces):**
```ts
export const EXAM_MINUTES = 30;
export const EXAM_LINK_HOURS = 24;
export type ExamAnswer = string | Record<string, string> | null; // тест: id варианта; соответствие: { idЛевого: idПравого }; открытый: строка числа
export type ExamAnswers = Record<string, ExamAnswer>;            // ключ — id строки ticket_questions
export interface ExamQuestion { tqId: string; snapshot: any }
export function publicSnapshot(snap: any): any;                   // снимок без ответов
export function parseOpen(raw: string | null | undefined): number | null; // «12,5» → 12.5
export function scoreAttempt(questions: ExamQuestion[], answers: ExamAnswers):
  { score: number; max: number; items: Array<{ tqId: string; points: number; max: number; answered: boolean }> };
export function pickVariant<T>(tickets: T[], rnd?: () => number): T;
export function examCode(rnd?: () => number): string;            // 6 знаков из 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function parseStartPayload(text: string): string | null;   // '/start exam_K7M2QX' → 'K7M2QX'
export function deadlineOf(startedAt: Date, linkClosesAt: Date, minutes?: number): Date; // min(старт + 30 мин, закрытие ссылки)
export function attemptState(a: { finished_at: string | null; deadline_at: string }, now: Date): 'running' | 'expired' | 'finished';
export function tgPlain(text: string): string;                    // разметка сайта → текст для чата
export function reviewLines(questions: ExamQuestion[], answers: ExamAnswers, lang: 'ru' | 'tg'): string[]; // только вопросы с ошибкой
export function chunkLines(lines: string[], limit?: number): string[]; // сообщения до 3800 знаков
```

- [ ] **Step 1: Тесты (сначала падают — модуля нет).** Проверить:
  - `publicSnapshot`: у вариантов нет `is_correct`, у пунктов нет `correct_match_id`, нет `correct_numeric_answer`; остаются `id`, `type`, тексты, `image_url`, `order_index`, `passage`, `passage_order`; `JSON.stringify(result)` не содержит подстрок `is_correct`, `correct_match_id`, `correct_numeric_answer`; исходный снимок не изменён; пустое место (`{empty: true}`) возвращается как есть.
  - `scoreAttempt`: тест верно → 1 из 1, неверно или без ответа → 0; соответствие из 4 левых пунктов, 3 верных → 3 из 4; открытый `'16'` при `correct_numeric_answer: 16` → 2 из 2, `'16,0'` → 2, `'17'` → 0, `correct_numeric_answer: null` → 0 из 2; пустое место — 0 из 0; сумма `max` билета 18+2+7 равна 40.
  - `parseOpen('12,5') === 12.5`, `parseOpen(' -3 ') === -3`, `parseOpen('abc') === null`, `parseOpen('') === null`.
  - `pickVariant([a, b, c], () => 0) === a`, `() => 0.99 → c`; пустой список — исключение `'В наборе нет билетов'`.
  - `examCode(() => 0) === 'AAAAAA'`; код длиной 6 и только из заданного алфавита (нет `0`, `O`, `1`, `I`, `L`).
  - `parseStartPayload('/start exam_K7M2QX') === 'K7M2QX'`, `'/start K7M2QX'` → `null`, `'/start exam_k7m2qx'` → `'K7M2QX'`, `'/start exam_<script>'` → `null`.
  - `deadlineOf`: старт 12:00, закрытие ссылки 18:00 → 12:30; старт 17:50, закрытие 18:00 → 18:00.
  - `attemptState`: сдана → `finished`; не сдана и срок прошёл → `expired`; иначе `running`.
  - `tgPlain('H<sub>2</sub>SO<sub>4</sub>') === 'H₂SO₄'`, `tgPlain('x<sup>2</sup>') === 'x²'`, `tgPlain('<b>да</b> &lt;')` экранирует `<` для HTML Telegram и убирает теги, `tgPlain('a<sub>n</sub>') === 'a_n'` (нет знака Юникода — запись через подчёркивание, для степени — `^`).
  - `reviewLines`: в список попадают только вопросы с потерянными баллами; у каждого — номер, текст, «Ваш ответ: …», «Верный ответ: …»; у вопроса с картинкой — пометка `[рисунок]`; без ошибок → одна строка «Ошибок нет».
  - `chunkLines`: длинный список режется на части не длиннее 3800 знаков.
- [ ] **Step 2:** `npx vitest run tests/exam.test.ts` — FAIL.
- [ ] **Step 3:** Реализация. Дроби и разметку в `tgPlain` разбирать простыми регулярными выражениями внутри модуля (импортов нет); дробь записывать как `числитель/знаменатель`.
- [ ] **Step 4:** `npx vitest run tests/exam.test.ts` — PASS; `npx tsc -b`.

### Task 2: База — запуски и попытки

**Files:**
- Create: `supabase/sql/exam_links.sql`
- Modify: `tests-db/db.ts` (`SCHEMA_FILES` — дописать в конец), `tests-db/access.test.ts`

**Interfaces (Produces):**
- `public.exam_links(code text primary key, batch_id uuid not null references ticket_batches on delete cascade, created_by uuid not null references auth.users on delete cascade, created_at timestamptz default now(), closes_at timestamptz not null, closed_at timestamptz, duration_min int not null default 30, review_sent_at timestamptz)`
- `public.exam_attempts(id uuid primary key default gen_random_uuid(), code text not null references exam_links on delete cascade, tg_user_id bigint not null, tg_username text, tg_name text, student_name text not null, ticket_id uuid not null references tickets on delete cascade, started_at timestamptz not null default now(), deadline_at timestamptz not null, finished_at timestamptz, answers jsonb not null default '{}', score int, max_score int, unique (code, tg_user_id))`
- RPC `exam_link_create(p_batch_id uuid) returns public.exam_links` — security definer: набор существует, вызывающий — его автор или главный админ, набор не кластерный, иначе исключения «Набор билетов не найден», «Запустить набор может только его автор», «Кластерный набор запустить классу нельзя»; код генерируется в базе (6 знаков того же алфавита, повтор при совпадении), `closes_at = now() + interval '24 hours'`.
- RPC `exam_link_close(p_code text) returns void` — автор запуска или главный админ; ставит `closed_at = now()`.
- RLS: `exam_links` и `exam_attempts` — SELECT для `authenticated`, если запуск свой (`created_by = auth.uid()`) или `is_owner()`; INSERT/UPDATE/DELETE из приложения нет (пишут RPC и сервисный ключ); у `anon` прав нет.

- [ ] **Step 1: Тесты прав доступа (сначала падают).** В `tests-db/access.test.ts`, блок «билеты классу»: автор создаёт запуск своего набора и видит его; другой преподаватель не видит ни запуск, ни попытки и получает отказ на `exam_link_close`; главный админ видит; кластерный набор — отказ с текстом «Кластерный набор»; прямой `insert into exam_attempts` от преподавателя отклоняется; без входа обе таблицы — `permission denied`; удаление набора удаляет запуск и попытки; вторая строка с тем же `(code, tg_user_id)` (вставка суперпользователем) нарушает уникальность.
- [ ] **Step 2:** `npm run test:db` — FAIL.
- [ ] **Step 3:** Написать `exam_links.sql` идемпотентно (`create table if not exists`, `drop policy if exists`, `create or replace function`, `revoke`/`grant` как в `cluster_batches.sql` и `update_batch_questions.sql`).
- [ ] **Step 4:** `npm run test:db` — PASS.

### Task 3: Сервер — Edge Function `tg-exam`

**Files:**
- Create: `supabase/functions/_shared/tgInitData.ts`, `supabase/functions/tg-exam/index.ts`
- Modify: `supabase/functions/tg-app/index.ts` (только замена локальной `verifyInitData` на импорт из `_shared/tgInitData.ts`)

**Interfaces:**
- Consumes: всё из Task 1; таблицы и RPC из Task 2.
- Produces:
  - `verifyInitData(raw: string, botToken: string, maxAgeSec: number): Promise<{ id: number; first_name?: string; last_name?: string; username?: string } | null>` — тело перенесено из `tg-app` без изменения проверки подписи; возвращает ещё имя и ник.
  - `POST /functions/v1/tg-exam`, тело `{ action, … }`.
    Действия ученика (заголовок `X-Tg-Init-Data`):
    - `open {code}` → `{ title, subject, minutes, state: 'new' | 'running' | 'finished' | 'closed', attempt? }`; `attempt` при `running`: `{ ticketNumber, deadline, questions: [{ tqId, snapshot: publicSnapshot }], answers }`; при `finished`: `{ score, max, review: boolean }`.
    - `start {code, name}` → как `open` в состоянии `running`. Имя: 2–80 знаков после обрезки пробелов. Вариант — `pickVariant`. Повторный `start` возвращает уже существующую попытку (вставка с `on conflict (code, tg_user_id) do nothing`, затем чтение).
    - `save {code, tqId, answer}` → `{ ok: true }`; после срока или сдачи — `{ ok: false, state }` без записи.
    - `submit {code}` → `{ score, max }`; считает `scoreAttempt`, пишет `finished_at`, `score`, `max_score`. После срока тоже сдаёт — с сохранёнными ответами.
    - `review {code}` → только если попытка сдана и у запуска `review_sent_at` не пуст: `{ questions: [{ tqId, snapshot (полный), answer, points, max }] }`; иначе отказ.
    Действия преподавателя (заголовок `Authorization: Bearer <JWT сайта>`, проверка — автор запуска или главный админ):
    - `review_send {code}` → рассылает каждому сдавшему `chunkLines(reviewLines(…))` и кнопку `web_app` «Открыть с формулами и рисунками» (`EXAM_URL?c=<code>&review=1`), ставит `review_sent_at`; пауза 50 мс между сообщениями; ответ `{ sent, failed }`.
    - `link_send {code}` → если у преподавателя привязан Telegram, бот присылает ему сообщение со ссылкой `https://t.me/<бот>?start=exam_<code>`, готовое к пересылке классу; иначе отказ «Привяжите Telegram».
    - `notify_closed {code}` → если у преподавателя привязан Telegram, одно итоговое сообщение: название набора, сколько сдали, средний балл.
  - Просроченные несданные попытки при любом обращении к запуску сдаются автоматически (балл по сохранённым ответам).

- [ ] **Step 1:** Вынести проверку подписи в `_shared/tgInitData.ts`, подключить в `tg-app` (поведение `tg-app` не меняется: он берёт только `id`).
- [ ] **Step 2:** Написать `tg-exam/index.ts` в стиле `tg-app` (CORS, `json()`, сервисный клиент). В шапке — команда деплоя `supabase functions deploy tg-exam --no-verify-jwt` и секреты (`TELEGRAM_BOT_TOKEN`, необязательно `EXAM_URL`, по умолчанию `https://testgenerator-3s51.vercel.app/tg/exam`).
- [ ] **Step 3:** `npx tsc -b` (папка функций в сборку не входит — проверить глазами импорты `.ts`); `npx vitest run` зелёный. Запуск на сервере — в Task 10.

### Task 4: Бот — ссылка для учеников

**Files:**
- Modify: `supabase/functions/telegram-bot/index.ts`

**Interfaces:** Consumes `parseStartPayload`, `EXAM_MINUTES` из Task 1.

- [ ] **Step 1:** В обработке `/start` **до** проверки привязки и кода привязки: если `parseStartPayload(text)` вернул код — найти запуск; нет или закрыт (`closed_at` или `closes_at` в прошлом) → «Экзамен по этой ссылке закрыт. Спросите новую ссылку у преподавателя.»; иначе сообщение «📝 Билет: <название набора>. На прохождение 30 минут, попытка одна.» с одной кнопкой `web_app` «Начать билет» (`EXAM_URL?c=<код>`). Других кнопок и главного меню ученику не показывать.
- [ ] **Step 2:** Проверить, что обычный `/start` и `/start КОД` привязки работают как раньше (ветка стоит выше и срабатывает только на `exam_`).
- [ ] **Step 3:** `npx vitest run` зелёный.

### Task 5: Страница ученика `/tg/exam`

**Files:**
- Create: `src/exam/ExamApp.tsx`, `src/exam/api.ts`, `src/exam/ExamQuestion.tsx`, `src/exam/exam.css`, `src/tg/telegramScript.ts` (вынести `loadTelegramScript` из `TgApp.tsx`)
- Modify: `src/main.tsx` (маршрут `/tg/exam` — **до** общего `/tg`), `src/tg/TgApp.tsx` (импорт вынесенной функции)

**Interfaces:** Consumes действия `tg-exam` из Task 3.

- [ ] **Step 1:** `api.ts`: `examApi(action, body)` → `fetch` на `/functions/v1/tg-exam` с заголовком `X-Tg-Init-Data` (образец — `api()` в `TgApp.tsx`).
- [ ] **Step 2:** Экраны: загрузка → ввод фамилии и имени (`state: 'new'`) → билет (вопросы подряд, таймер сверху по `deadline`, счётчик «отвечено N из M», кнопка «Сдать» с подтверждением) → «Вы набрали X из Y» → режим разбора (`?review=1`). Вне Telegram (нет `initData`) — сообщение «Откройте ссылку в Telegram».
- [ ] **Step 3:** `ExamQuestion`: тест — выбор одного варианта; соответствие — для каждого левого пункта выбор цифры 1–5; открытый — поле числа; тексты английского показываются один раз перед своими вопросами (как в `TicketPreview.tsx`). Формулы — `FormattedText`. Каждый ответ сразу уходит в `save`; при ошибке сети — пометка «не сохранено» и повтор.
- [ ] **Step 4:** По истечении таймера — автоматический `submit`. Если ученик закрыл и открыл снова — `open` возвращает его попытку с ответами.
- [ ] **Step 5:** `npx tsc -b`, `npm run theme:dark` (страница со своей темой: если каталог не участвует в генерации — исключить его в `scripts/gen-dark-css.mjs` так же, как `src/tg`).

### Task 6: Раздел сайта «Билеты классу» — запуск и таблица

**Files:**
- Create: `src/components/ExamsView.tsx`, `src/components/exams/LaunchDialog.tsx`, `src/components/exams/ExamBoard.tsx`, `src/lib/examLinks.ts`
- Modify: `src/App.tsx` (`TabType` + `'exams'`, `TAB_HASH.exams = 'exams'`, ленивая загрузка), `src/components/SideNav.tsx` (пункт «Билеты классу» в группе «Билеты», виден всем ролям с общими вкладками), `src/components/SavedTicketsView.tsx` и `src/components/generator/GeneratedBatchPanel.tsx` (кнопка «Запустить классу» у обычного набора)

**Interfaces:**
- Consumes: RPC и таблицы Task 2.
- Produces (`examLinks.ts`): `createExamLink(batchId): Promise<ExamLink>`, `closeExamLink(code): Promise<void>`, `fetchExamLinks(): Promise<ExamLinkRow[]>` (свои запуски, новые сверху, с названием набора и предметом), `fetchAttempts(code): Promise<Attempt[]>`, `examUrl(code): string` (`https://t.me/<VITE_TELEGRAM_BOT_USERNAME>?start=exam_<code>`). Ключи кэша: `['exam_links']`, `['exam_attempts', code]`.

- [ ] **Step 1:** `ExamsView`: список запусков (открытые сверху), у каждого — название, срок, «сдали N, идут M»; кнопка «Запустить классу» открывает `LaunchDialog`. Пусто — `EmptyState` с пояснением, как это работает.
- [ ] **Step 2:** `LaunchDialog`: выбор набора из своих последних (без кластерных; поиск по названию) → `createExamLink` → ссылка, «Копировать», QR (`qrcode` уже в зависимостях), «Отправить мне в Telegram» (действие `link_send` функции `tg-exam`; кнопка неактивна с подсказкой, если Telegram у преподавателя не привязан).
- [ ] **Step 3:** `ExamBoard`: таблица попыток (имя, аккаунт, вариант, баллы, время сдачи; у идущих — «идёт, осталось N мин»), `refetchInterval: 5000` пока запуск открыт; «Закрыть» с подтверждением (`confirmAction`) → `closeExamLink` + `tg-exam notify_closed`.
- [ ] **Step 4:** Кнопки «Запустить классу» у набора ведут в раздел с выбранным набором (`#exams/<id набора>`).
- [ ] **Step 5:** `npx tsc -b`, `npx vitest run`, `npm run theme:dark`.

### Task 7: Разбор по вопросам и Excel

**Files:**
- Create: `src/lib/examStats.ts`, `tests/examStats.test.ts`, `src/components/exams/QuestionStats.tsx`
- Modify: `src/components/exams/ExamBoard.tsx`

**Interfaces (Produces):**
```ts
export interface QuestionStat { questionId: string | null; label: string; type: string; answered: number; total: number; avgShare: number; wrongTop?: { text: string; count: number } }
export function questionStats(tickets: Array<{ id: string; questions: Array<{ id: string; question_id: string | null; question_snapshot: any }> }>, attempts: Array<{ ticket_id: string; answers: Record<string, unknown>; finished_at: string | null }>): QuestionStat[];
export function attemptsSheet(attempts, tickets): Array<Array<{ value: string | number }>>; // строки для write-excel-file
```
Группировка — по `question_id` (вопрос мог стоять в разных вариантах); `avgShare` — средняя доля набранных баллов; сортировка от самых проваленных; считаются только сданные попытки.

- [ ] **Step 1: Тесты (сначала падают):** один вопрос в двух вариантах суммируется; несданные попытки не считаются; `wrongTop` — самый частый неверный вариант теста; пустое место пропускается; `attemptsSheet` даёт заголовок и по строке на попытку.
- [ ] **Step 2:** `npx vitest run tests/examStats.test.ts` — FAIL → реализация (баллы — через `scoreAttempt` из Task 1) → PASS.
- [ ] **Step 3:** `QuestionStats`: список вопросов с полосой «верно N %», открывается из `ExamBoard` кнопкой «Разбор по вопросам». Кнопка «Excel» — `write-excel-file` (образец — `src/lib/omr/exportExcel.ts`).

### Task 8: Рассылка разбора ученикам

**Files:**
- Modify: `src/components/exams/ExamBoard.tsx`, `src/lib/examLinks.ts`

**Interfaces:** Consumes действие `review_send` из Task 3. Produces `sendReview(code): Promise<{ sent: number; failed: number }>` (вызов `tg-exam` с JWT сайта).

- [ ] **Step 1:** Кнопка «Отправить разбор ученикам» доступна, когда есть сданные попытки; подтверждение: «Ученики увидят свои ошибки и верные ответы. Отправить N ученикам?»; после — уведомление «Отправлено: N, не доставлено: M» и пометка у запуска «разбор отправлен».
- [ ] **Step 2:** Повторное нажатие отправляет снова только после подтверждения «Разбор уже отправляли».

### Task 9: Документация и черновики релиза

**Files:**
- Modify: `docs/ARCHITECTURE.md` (4.1 — таблицы; 4.2 — RPC; 5 — `exam_links.sql`; 6.1 — маршрут `/tg/exam`; 6.3 — `ExamsView`; 7 — `examLinks.ts`, `examStats.ts`; 8 — `tg-exam`; 9 — `exam.ts`, `tgInitData.ts`; 10 — поток «Билеты классу»; 13 — деплой; 14 — тесты; 15 — ловушка «ключи не отдавать ученику»)
- Create: `scratch/pending-release/exam-launch.txt` (`kind new`, `scope site`, `min_rank 1`), `exam-telegram.txt` (`scope bot`, `min_rank 1`)

### Task 10: Выкладка на проверку и сквозной проход

Только с согласия владельца (деплой и SQL — продакшен).

- [ ] **Step 1:** `npm run build`, `npm run test:db`, `node scripts/sync-docx-shared.mjs` без изменений.
- [ ] **Step 2:** Применить `exam_links.sql`; задеплоить `tg-exam`, `telegram-bot`, `tg-app` (последний — из-за вынесенной проверки подписи); перед деплоем `git pull`.
- [ ] **Step 3:** Сквозной проход на пробном наборе: владелец как преподаватель запускает набор; второй аккаунт Telegram (не привязанный к сайту) проходит билет; проверить по списку Review Focus: в ответах сервера нет ключей (вкладка «Сеть»), вторая попытка не создаётся, сдача по таймеру, таблица обновляется, разбор приходит текстом и открывается кнопкой; нынешнее мини-приложение у ученика не открывается.
- [ ] **Step 4:** Удалить пробный набор (запуск и попытки удалятся каскадом).

---

## Самопроверка

- **Покрытие дизайна:** запуск из раздела сайта — Task 6; ссылка и кнопка в боте — Task 4; прохождение, случайный вариант, 30 минут, одна попытка, баллы сразу — Tasks 1, 3, 5; срок ссылки 24 часа — Task 2; обновляющаяся таблица — Task 6; разбор по вопросам и Excel — Task 7; разбор ученикам текстом с кнопкой — Tasks 1, 3, 8; запрет кластерных — Tasks 2, 6; мини-приложение преподавателя недоступно — Tasks 3–5, проверка в Task 10.
- **Review Focus → тесты:** №1 — Task 1 (`publicSnapshot`) и Task 10; №2 — Task 2 (уникальность) и Task 3 (`on conflict`); №3 — Task 1 (`attemptState`) и Task 3; №4 — Task 2 (каскад); №5 — Task 2.
- **Что остаётся без автотеста:** сама Edge Function и страница ученика (в проекте нет запуска Deno и тестов интерфейса) — они проверяются сквозным проходом в Task 10. Поэтому вся логика, где возможна ошибка в баллах или утечка ключа, вынесена в `_shared/exam.ts`.
- **Вне плана:** кластерные наборы, страница без Telegram, живая таблица в чате бота, оценка качества вопросов по результатам (отдельные этапы из дизайна).
