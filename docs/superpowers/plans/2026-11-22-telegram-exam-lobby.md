# Билеты классу: зал ожидания и общий старт — план реализации

> **Для исполнителя:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans. Шаги — чекбоксы (`- [ ]`).

**Цель:** ученики заходят в зал ожидания и видят крупную цифру своего варианта; преподаватель видит варианты, меняет их, выбирает время (5–45 минут) и нажимает «Начать»; у всех идёт отсчёт 3-2-1, затем билет с общим временем окончания; опоздавшие заходят и получают остаток.

**Архитектура:** единый источник истины — запуск: `exam_links.session_start_at` (пусто = ожидание) и `duration_min`; конец сессии = `session_start_at + duration_min` для всех (срок на попытке больше не используется). «Начать» и смена варианта — функции базы под входом преподавателя (как `exam_link_create`/`exam_link_close`). Ученик получает фазу (`waiting` / `countdown` / `running`) от `tg-exam` опросом раз в 3 секунды; вопросы отдаются только в фазе `running`.

**Стек:** как в `2026-11-22-telegram-exam.md` (React 19, TypeScript, TanStack Query 5, Tailwind 3, Supabase, Edge Functions на Deno, vitest, встроенный Postgres `npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-11-22-telegram-exam-lobby-design.md` (одобрен владельцем); базовый дизайн — `2026-11-22-telegram-exam-design.md`. Это правка уже построенного в ветке `feat/telegram-exam` (задачи 1–9 прошлого плана выполнены, на сервер ничего не выкладывалось).

## Global Constraints

- **Ключи по-прежнему не покидают сервер.** В фазах `waiting` и `countdown` ученику отдаётся **только номер варианта** — ни вопросов, ни снимков. Вопросы (через `publicSnapshot`) — только когда серверные часы дошли до `session_start_at`.
- Время: **5–45 минут**, целое, выбирает преподаватель при «Начать» (в базе `check (duration_min between 5 and 45)`); по умолчанию в интерфейсе 30, шаг 5; после старта не меняется.
- Отсчёт: `session_start_at = now() + 3 секунды` (константа `EXAM_COUNTDOWN_SEC = 3`), все телефоны считают по серверному времени (смещение по `now` в ответах уже есть в `src/exam/api.ts`).
- Конец сессии для всех попыток — `session_start_at + duration_min`; ещё раньше — `closed_at` запуска; `exam_attempts.deadline_at` больше не используется (колонка остаётся, пустая).
- Опоздавшие: заходят, пока ссылка открыта и сессия не кончилась; время окончания общее. Смена варианта — **только до старта**. «Начать» — только если в зале есть хотя бы один ученик; повторное «Начать» ничего не меняет.
- Одна попытка на аккаунт Telegram по ссылке — как раньше. Режима «ученик стартует сам» нет.
- Опрос ученика — `EXAM_POLL_MS = 3000` (константа в `_shared/exam.ts`).
- Тексты: нет слов «30 минут» в сообщении бота, `link_send` и на странице ученика — «время назначит преподаватель»; слово «экзамен» не использовать (оно только для экзамен-кластера); термины из `CLAUDE.md`.
- Файлы `_shared/exam.ts` — **без импортов**. Права записи только через функции базы; у `anon` прав нет; функции для `tg-exam` — только `service_role`.
- Деплой функций и применение SQL — только с явного согласия владельца (Task 6). В папке могут работать другие сессии: не делать `git stash/reset`, чужие правки не трогать. Работа в ветке `feat/telegram-exam`, без push.
- Проверка каждой задачи: `npx tsc -b`, `npx vitest run`, для SQL `npm run test:db`; новые цветовые классы → `npm run theme:dark` (страница ученика исключена из генерации).

## Review Focus

1. **Вопросы до старта.** В `waiting`/`countdown` ответ `open`/`start` не содержит `questions`/снимков даже при опросе в момент старта; ученик не может получить вопросы раньше серверного `session_start_at` (подмена часов телефона не помогает).
2. **Гонка «Начать» и входа.** Ученик, вошедший в ту же секунду, что и «Начать», получает тот же общий конец сессии и не остаётся без срока; конец не зависит от того, когда создана попытка.
3. **Часы телефона.** Отсчёт 3-2-1 и таймер при сильно спешащих/отстающих часах показывают то же, что у остальных (расчёт по смещению к серверу); запись ответов до `session_start_at` и после конца сессии отклоняется базой.
4. **Права и границы.** Смена варианта/«Начать» чужим преподавателем, после старта, билетом из другого набора, длительность вне 5..45, «Начать» при пустом зале, закрытие запуска в ожидании (попытки закрываются с нулём, ученик видит «закрыто»).
5. **Опоздавший и конец сессии.** Вход в последнюю секунду/после конца, повторный вход во время отсчёта и во время работы (продолжает с того же места), 24-часовой срок ссылки при долгом ожидании.

---

### Task 1: Чистая логика сессии — `_shared/exam.ts`

**Files:**
- Modify: `supabase/functions/_shared/exam.ts`, `tests/exam.test.ts`

**Interfaces (Produces):**
```ts
export const EXAM_MIN_MINUTES = 5;
export const EXAM_MAX_MINUTES = 45;
export const EXAM_COUNTDOWN_SEC = 3;
export const EXAM_POLL_MS = 3000;
export type SessionPhase = 'waiting' | 'countdown' | 'running' | 'ended';
export interface SessionLink { session_start_at: string | null; duration_min: number }
export function sessionEnd(link: SessionLink): Date | null;                 // старт + минуты; null, если сессия не начата
export function sessionPhase(link: SessionLink, now: Date): SessionPhase;   // waiting | countdown (до старта) | running | ended
export function clampMinutes(v: unknown): number | null;                     // целое 5..45 или null
export function countdownDigit(startsAtMs: number, nowMs: number): number;  // 3,2,1; 0 — отсчёт закончен
```

- [ ] **Step 1: Тесты (сначала падают).** `sessionPhase`: нет старта → `waiting`; старт через 2 с → `countdown`; старт 10 с назад, 30 мин → `running`; старт 31 мин назад, 30 мин → `ended`; ровно на `session_start_at` → `running`; ровно на конце → `ended`. `sessionEnd`: null без старта; 12:00:00 + 30 → 12:30:00. `clampMinutes`: `30`→30, `'30'`→30, `5`→5, `45`→45, `4`/`46`/`30.5`/`'abc'`/`null`→null. `countdownDigit`: за 2500 мс до старта → 3; 1500 → 2; 500 → 1; в момент старта и позже → 0; больше 3000 мс → 3.
- [ ] **Step 2:** `npx vitest run tests/exam.test.ts` — FAIL.
- [ ] **Step 3:** Реализация в `exam.ts` (без импортов); `countdownDigit = ceil(ms/1000)` с ограничением 0..3. Существующие экспорты не менять.
- [ ] **Step 4:** тот же запуск — PASS; `npx tsc -b`.

### Task 2: База — сессия, смена варианта, срок на уровне запуска

**Files:**
- Modify: `supabase/sql/exam_links.sql`, `tests-db/access.test.ts`

**Interfaces (Produces):**
- `exam_links.session_start_at timestamptz` (пусто = ожидание); `check (duration_min between 5 and 45)` (идемпотентно, через `pg_constraint`, как `exam_attempts_lang_check`).
- `exam_attempts.deadline_at` — `drop not null`.
- `exam_session_start(p_code text, p_minutes int) returns public.exam_links` — security definer, `set search_path = public`, автор запуска или `is_owner()`. Исключения: «Запуск не найден», «Начать сессию может только автор запуска», «Запуск закрыт» (закрыт или истёк), «Длительность от 5 до 45 минут», «Пока никто не зашёл — начинать некому». Если `session_start_at` уже стоит — вернуть строку без изменений (идемпотентно). Иначе `session_start_at = now() + interval '3 seconds'`, `duration_min = p_minutes`.
- `exam_attempt_set_variant(p_attempt_id uuid, p_ticket_id uuid) returns void` — автор запуска или `is_owner()`; исключения: «Попытка не найдена», «Сменить вариант можно только до начала сессии» (если `session_start_at` не пуст или попытка сдана), «Этого билета нет в наборе».
- `exam_attempt_save` — условие записи теперь: попытка не сдана, `l.session_start_at is not null`, `now() >= l.session_start_at`, `now() < l.session_start_at + make_interval(mins => l.duration_min)`, запуск не закрыт и не истёк. Подпись и права прежние (только `service_role`).
- `exam_attempt_close` — `finished_at = least(now(), session_end, coalesce(closed_at, 'infinity'))`, где `session_end = session_start_at + duration` (если сессии нет — `least(now(), closed_at)`); остальное поведение прежнее.
- Гранты: `exam_session_start` и `exam_attempt_set_variant` — `revoke ... from public, anon; grant execute ... to authenticated`.

- [ ] **Step 1: Тесты прав доступа (сначала падают).** В блоке «билеты классу»: автор нажимает «Начать» при ≥1 попытке — `session_start_at` ≈ now+3 c, `duration_min` равен выбранному; повторный вызов не меняет строку; 4 и 46 минут — отказ; пустой зал — отказ «начинать некому»; чужой преподаватель — отказ; главный админ — можно; закрытый запуск — отказ. `exam_attempt_set_variant`: автор до старта меняет на билет своего набора; после старта, чужим преподавателем и билетом из другого набора — отказ; сданная попытка — отказ. `exam_attempt_save`: до `session_start_at` (старт через 3 c) возвращает `false`, ответы не меняются; в окне работы — `true` и ответ записан; после конца сессии (старт 31 мин назад при 30) — `false`. `exam_attempt_close`: при незапущенной сессии и закрытом запуске ставит `finished_at` и возвращает ответы; в запущенной — `finished_at` не позже конца сессии. `anon` не может вызвать новые функции; `deadline_at` может быть `null` (вставка суперпользователем проходит).
- [ ] **Step 2:** `npm run test:db` — FAIL.
- [ ] **Step 3:** Реализовать в `exam_links.sql` идемпотентно (`add column if not exists`, `create or replace`, `do $$ ... pg_constraint`), права как у `exam_link_close`. Старые тесты сохранения/закрытия (где срок брался из `deadline_at`) переписать под сессию запуска — их проверки по смыслу те же.
- [ ] **Step 4:** `npm run test:db` — PASS (все старые тоже).

### Task 3: Сервер — `tg-exam`: фазы для ученика

**Files:**
- Modify: `supabase/functions/tg-exam/index.ts`

**Interfaces:**
- Consumes: Task 1 (`sessionEnd`, `sessionPhase`, `EXAM_COUNTDOWN_SEC`), Task 2 (колонка `session_start_at`, функции `exam_attempt_save/close`).
- Produces: ответ `open`/`start` (поле `state`):
  - `'new'` — попытки нет, запуск открыт и сессия не кончилась; плюс `session: 'waiting' | 'running'` и (если идёт) `remainingMs` — для текста на странице;
  - `'waiting'` — `{ ticketNumber, minutes? : null }` (минуты ещё не выбраны), без вопросов;
  - `'countdown'` — `{ ticketNumber, startsAt: ISO, minutes }`, без вопросов;
  - `'running'` — как сейчас, но `attempt.deadline` = конец сессии (с учётом `closed_at`);
  - `'finished'`, `'closed'` — как сейчас.
  Все ответы по-прежнему содержат `now` (мс сервера).

- [ ] **Step 1:** `LINK_COLS` + `session_start_at`; ввести `effEnd(l)` = минимум из `sessionEnd(l)`, `closed_at`, `closes_at` (если сессии нет — только закрытие); `stateOf`/`finishExpired` переписать от `effEnd(l)` (а не от `a.deadline_at`): незавершённые попытки сдаются, когда `now >= effEnd`; при закрытом запуске без старта попытки сдаются (нулевой балл).
- [ ] **Step 2:** `start`: вход в зал (вариант `pickVariant`, имя, язык) **без** срока; пускает, пока запуск открыт и сессия не кончилась (`phase !== 'ended'`); повторный `start` возвращает ту же попытку. `studentView`: по `sessionPhase` отдаёт `waiting`/`countdown`/`running`; вопросы — только в `running` (через `publicSnapshot` как сейчас); номер варианта — всегда.
- [ ] **Step 3:** `save`: проверка состояния по `effEnd`/`sessionPhase` (до старта отвечает `{ ok:false, state:'waiting' }`), запись — как сейчас через `exam_attempt_save`. `link_send` и текст бота: без «N минут» («Время назначит преподаватель»).
- [ ] **Step 4:** `npx tsc -b`, `npx vitest run`, строгая проверка Deno-заглушкой (см. `.superpowers/sdd/2026-11-22-telegram-exam/task-3-report.md`, если папка есть; иначе описать в отчёте, как проверено). Запуск на сервере — Task 6.

### Task 3b: Свой порядок вариантов ответа у каждого ученика

Решение владельца (после одобрения дизайна): у разных учеников варианты ответов тестовых заданий стоят в разном порядке. Делается после Task 3 (правит тот же `tg-exam/index.ts`).

**Files:**
- Modify: `supabase/functions/_shared/exam.ts`, `tests/exam.test.ts`, `supabase/functions/tg-exam/index.ts`

**Interfaces (Produces):**
```ts
export function shuffleOptions(snap: any, seed: string): any; // копия снимка с перемешанными options; порядок определяется только seed (id попытки) и id вопроса
```

- [ ] **Step 1: Тесты (сначала падают).** Один и тот же `seed` даёт один и тот же порядок (повторный вызов, повторное открытие); разные `seed` в среднем дают разный порядок (на 200 разных seed встречаются минимум 3 разных порядка для 4 вариантов); множество вариантов и их `id` не меняются, `order_index` переписан 0..n-1 по новому порядку; исходный снимок не изменён; вопросы типа `matching`/`open`, пустое место и вопрос с одним вариантом возвращаются как есть; если среди вариантов есть «все перечисленные», «ни один из перечисленных», «оба», «всё перечисленное», «ҳама», «ҳеҷ яке» (без учёта регистра) — порядок не меняется вовсе (смысл варианта зависит от места); результат не содержит `is_correct`, если на входе его не было (функцию применяют к `publicSnapshot` и к `reviewSnapshot`).
- [ ] **Step 2:** `npx vitest run tests/exam.test.ts` — FAIL.
- [ ] **Step 3:** Реализация: детерминированный генератор от хеша `seed + ':' + snap.id`, перестановка Фишера — Йетса; `tg-exam`: применять `shuffleOptions(publicSnapshot(...), attempt.id)` для `running`, и `shuffleOptions(reviewSnapshot(...), attempt.id)` в `review`; в `review_send` (текст в чат) буквы вариантов в «Ваш ответ / Верный ответ» должны соответствовать порядку ученика: `reviewLines` получает необязательный параметр `seed` и применяет ту же перестановку (тест: буква в тексте совпадает с буквой на экране ученика).
- [ ] **Step 4:** `npx vitest run`, `npx tsc -b`, строгая проверка Deno-заглушкой.

Review Focus (дополнение): перестановка не должна менять оценку (баллы считаются по `id` варианта), ответ после перезахода и разбор показывают тот же порядок, что видел ученик; соответствия и открытые вопросы не затронуты.

### Task 4: Страница ученика — зал ожидания, отсчёт

**Files:**
- Create: `src/exam/ExamLobby.tsx`
- Modify: `src/exam/ExamApp.tsx`, `src/exam/api.ts`, `src/exam/examLogic.ts`, `src/exam/exam.css`

**Interfaces:** Consumes ответ `open`/`start` из Task 3 и `countdownDigit`, `EXAM_POLL_MS` из Task 1 (импорт из `_shared/exam.ts`, как делает `src/lib/examStats.ts`). Produces: `OpenResponse` с вариантами `'waiting'` и `'countdown'` в `api.ts`.

- [ ] **Step 1 (чистая логика, тесты первыми в `tests/examLogic.test.ts`):** `lobbyView(res, offsetMs, clientNow)` → `{ kind: 'waiting' } | { kind: 'countdown'; digit: number } | { kind: 'run' }` (по `startsAt` и смещению часов сервера; при `digit === 0` → `run`); `waitText(res)` — текст ожидания; расчёт с телефоном, спешащим/отстающим на минуту, даёт те же цифры.
- [ ] **Step 2:** `ExamLobby`: заголовок набора, «Ваш вариант» и **очень крупная цифра** (номер билета), подпись «Ждите, преподаватель начнёт сессию»; опрос `apiOpen` каждые `EXAM_POLL_MS` (остановка при размонтировании, повтор при сетевой ошибке без сброса экрана); в `countdown` — крупные цифры 3, 2, 1 (по серверному времени), затем переход в `ExamTicket` с ответом `running`. Если ответ `running` пришёл сразу (опоздавший) — отсчёта нет.
- [ ] **Step 3:** `NameForm`: убрать «30 минут/таймер пойдёт после нажатия»; если `session: 'running'` — «Сессия уже идёт, осталось N мин»; кнопка «Войти». Состояния `closed` — «Приём ответов закрыт».
- [ ] **Step 4:** `npx tsc -b`, `npx vitest run`, `npm run build`; проверить в предпросмотре с подставным `fetch` (ожидание → отсчёт → билет; опоздавший; потеря связи при опросе) и честно написать в отчёте, что проверено.

### Task 5: Сайт — таблица преподавателя в режиме ожидания

**Files:**
- Modify: `src/lib/examLinks.ts`, `src/lib/examView.ts`, `src/components/exams/ExamBoard.tsx`, `src/components/ExamsView.tsx`, `tests/examView.test.ts`
- Create: `src/components/exams/SessionLobby.tsx`

**Interfaces:**
- Produces (`examLinks.ts`): `ExamLink`/`ExamLinkRow` + `session_start_at: string | null`; `startSession(code: string, minutes: number): Promise<ExamLink>` (RPC `exam_session_start`); `setAttemptVariant(attemptId: string, ticketId: string): Promise<void>` (RPC `exam_attempt_set_variant`); `fetchAttempts` дополнить `ticket_id`.
- Produces (`examView.ts`): `LinkState` + `'waiting'`; `sessionEndOf(link): string | null`; `mapAttemptRow(a, now, link)` считает «идёт/осталось N мин» и «время вышло» от конца сессии запуска, а не от `deadline_at` попытки.

- [ ] **Step 1: Тесты (сначала падают):** `linkState`: открыт без старта → `waiting`, со стартом → `open`; `mapAttemptRow` — остаток от конца сессии; попытка с `deadline_at: null`; «осталось» не отрицательное; `canStartSession(link, attemptsCount)` (запуск открыт, старта нет, ≥1 попытка).
- [ ] **Step 2:** `SessionLobby` (показывается вместо таблицы, пока `waiting`): «Пришло N», список (имя, аккаунт, язык, **вариант — выпадающий список номеров билетов набора** → `setAttemptVariant`), выбор времени (5–45, шаг 5, по умолчанию 30), кнопка «Начать для N учеников» с подтверждением (`confirmAction`: «Время: X минут. Ученики сразу получат отсчёт 3-2-1. Начать?»). Опрос списка каждые 3 с, пока запуск в ожидании. Список билетов набора — `fetchExamTickets(batchId)` (ключ `['exam_tickets', batchId]`, уже есть).
- [ ] **Step 3:** `ExamBoard`: при `waiting` рисует `SessionLobby`, иначе таблицу как сейчас (опоздавшие добавляются сами); «Закрыть» работает и в ожидании. `ExamsView`: у строки запуска вместо «сдали N, идут M» в ожидании — «ждут: N». Сообщения об ошибках RPC — через обычный `notifyError`.
- [ ] **Step 4:** `npx tsc -b`, `npx vitest run`, `npm run theme:dark`, `npm run build`; в отчёте честно указать, что проверено в браузере.

### Task 6: Документация, тексты, выкладка на проверку

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `supabase/functions/_shared/examStart.ts` и `tests/examStart.test.ts` (сообщение бота без минут), `supabase/functions/telegram-bot/index.ts` (если там минуты), `scratch/pending-release/exam-launch.txt`, `scratch/pending-release/exam-telegram.txt` (в git не идут)

- [ ] **Step 1:** `examStartText(title, minutes?)`: без «30 минут» — «📝 Билет: <название>. Время назначит преподаватель, попытка одна.» + кнопка «Войти в билет» (текст кнопки — как в тесте); бот передаёт больше не `duration_min`. Тесты первыми.
- [ ] **Step 2:** `docs/ARCHITECTURE.md`: колонка `session_start_at`, новые RPC, фазы в `tg-exam`, опрос `EXAM_POLL_MS`, зал ожидания на странице ученика и на сайте, поток «Билеты классу» (зал → старт → отсчёт → работа → закрытие → разбор), порядок деплоя (SQL → `tg-exam` → бот/`tg-app` → сайт), ловушка «срок попытки больше не `deadline_at`», «вопросы только в фазе `running`».
- [ ] **Step 3:** Черновики пунктов «Что нового» обновить: преподаватель запускает сессию классу (зал ожидания, смена варианта, время 5–45 минут, общий старт с отсчётом); ученик заходит по ссылке в зал и проходит билет вместе с классом. `min_rank`/`scope` как были.
- [ ] **Step 4:** Проверить `npx tsc -b`, `npx vitest run`, `npm run test:db`, `npm run build`.

### Task 7: Выкладка на проверку и сквозной проход

Только с согласия владельца (деплой и SQL — продакшен). Объединяет Task 10 прошлого плана.

- [ ] **Step 1:** `git fetch`; применить `exam_links.sql`, затем `security_round5.sql` (только он, не `update_batch_questions.sql` после него); задеплоить `tg-exam` (`--no-verify-jwt`), `telegram-bot`, `tg-app`; затем выложить сайт.
- [ ] **Step 2:** Сквозной проход на пробном наборе: два аккаунта Telegram (один привязан к сайту — преподаватель; второй и третий — ученики): зал ожидания с крупной цифрой, смена варианта, «Начать» с выбором времени, отсчёт 3-2-1 одновременно, опоздавший, запись ответов, сдача, таймер, закрытие, разбор. По списку Review Focus: в ответах сервера до старта нет вопросов (вкладка «Сеть»), часы телефона не влияют, вторая попытка не создаётся, мини-приложение преподавателя ученику не открывается, проверка `exam_attempt_save` с jsonb на сервере.
- [ ] **Step 3:** Удалить пробный набор (запуск и попытки удалятся каскадом).

---

## Самопроверка

- **Покрытие дизайна:** зал ожидания и цифра варианта — Tasks 3, 4; таблица преподавателя, смена варианта — Tasks 2, 5; «Начать», время 5–45, отсчёт 3-2-1 — Tasks 1, 2, 4, 5; общий конец и опоздавшие — Tasks 2, 3; убрать «30 минут» — Tasks 3, 4, 6; опрос раз в 3 с — Tasks 1, 4, 5.
- **Review Focus → тесты:** №1 — Task 3 (чтение кода + сквозной проход) и Task 2 (`save` до старта отклоняется); №2 — Task 2 (конец сессии на уровне запуска, `deadline_at` пуст); №3 — Tasks 1, 4 (расчёт по смещению); №4 — Task 2; №5 — Tasks 2, 3.
- **Без автотеста:** функция `tg-exam` и экраны (нет запуска Deno и тестов интерфейса) — поэтому расчёты вынесены в `_shared/exam.ts` и `examLogic.ts`, а ограничения вынесены в базу; остальное — сквозной проход (Task 7).
- **Вне плана:** пауза сессии, экран для проектора, живая таблица в чате бота, кластерные наборы.
