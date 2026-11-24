# «Билеты классу»: предупреждение об уходе со страницы — план

**Цель:** преподаватель сразу видит в таблице запуска, кто из учеников ушёл со страницы билета, сколько раз и на сколько.

**Устройство:** страница ученика шлёт `tg-exam: focus` при уходе и возвращении; база атомарно ведёт счётчики в `exam_attempts`; таблица преподавателя читает их в обычном опросе.

**Проект:** `docs/superpowers/specs/2026-11-24-exam-away-warning-design.md`

## Общие правила
- Без коммитов: изменение копится до пяти (CLAUDE.md), черновик пункта — в `scratch/pending-release/`.
- Время решает сервер. Ученику новые поля не отдаются. Ответ `focus` не содержит `now` (ответ, полученный после «заморозки» страницы, сбил бы таймер).
- Термины: «билет», «запуск», «страница билета».

## На что смотреть при проверке
1. Сообщение об уходе не дошло (нет связи) → возвращение несёт `ms`, сервер считает уход по нему.
2. Возвращение отправлено, пока уход ещё в пути → сообщения идут строго по очереди.
3. Сессия кончилась, пока ученик не на странице → `exam_attempt_close` закрывает уход, «сейчас не на странице» не висит.
4. Сайт выложен раньше `tg-exam` → `focus` получает 400, страница молча перестаёт слать.
5. Telegram Web (страница во фрейме без фокуса при открытии) → ложного ухода нет: считаем события, а не состояние.

## Задача 1. База и сервер
- `supabase/sql/exam_links.sql`: столбцы `away_count int not null default 0`, `away_ms bigint not null default 0`, `away_since timestamptz`; RPC `exam_attempt_focus(p_attempt_id uuid, p_away boolean, p_ms bigint default null) returns boolean` (только `service_role`); `exam_attempt_close` закрывает незавершённый уход.
  - уход: только идущая попытка и `away_since is null` → `away_since = now()`, `away_count + 1`;
  - возвращение: `away_since` есть → `away_ms += now() - away_since`; нет и `p_ms > 0` → `away_count + 1`, `away_ms += least(p_ms, время от старта сессии)`.
- `supabase/functions/_shared/exam.ts`: `awayMs(v: unknown): number | null` (целое > 0, не больше суток).
- `supabase/functions/tg-exam/index.ts`: действие `focus {code, away, ms?}` → `{ok}`; без `finishExpired`; `Access-Control-Max-Age: 600`.
- Тесты: `tests/exam.test.ts` (`awayMs`), `tests-db/access.test.ts` (уход/возвращение/сдача, отказ `authenticated`).

## Задача 2. Страница ученика
- `src/exam/awayReporter.ts`:
  - `applyFocusSignal(flags, signal)`, `isAway(flags)`; сигналы `hidden | visible | blur | focus | inactive | active | touch` (`touch` снимает все флаги);
  - `createAwayReporter(send, opts)` → `{ leave(now?), back(now?), arrive(), stop(), count }`: очередь по одному, повтор при сбое связи (4 с, до 5 раз), недошедший уход отбрасывается, если за ним уже стоит возвращение; `arrive()` — при открытии страницы одно «вернулся» без длительности (закрывает уход того, кто закрыл страницу и открыл снова).
- `src/exam/api.ts`: `examApi(..., { keepalive })`, `apiFocus(code, away, ms?)`; `TgWebApp.offEvent`.
- `src/exam/ExamTicket.tsx`: подписки и строка «Преподаватель видит, что вы уходили со страницы билета».
- Тест: `tests/awayReporter.test.ts`.

## Задача 3. Таблица преподавателя и Excel
- `src/lib/examView.ts`: `timesRu(n)`, `formatAwayMs(ms)`, `awayView(a, status, now) → {text, now, count}`, `newAwayNames(prev, attempts)`; `AttemptRowView.away`, `.awayNow`.
- `src/lib/examLinks.ts`: поля `away_*` в `fetchAttempts` и `fetchAttemptsWithAnswers`.
- `src/components/exams/ExamBoard.tsx`: столбец «Уходил», всплывающее предупреждение, опрос 3 с, секундный тик, пока кто-то не на странице.
- `src/lib/examStats.ts`, `examExport.ts`: столбцы «Уходил, раз» и «Вне страницы, с».
- Тесты: `tests/examView.test.ts`, `tests/examStats.test.ts`.

## Задача 4. Проверка и документы
- `npm test`, `npx tsc -b`, `npm run test:db`, `npm run theme:dark`.
- `docs/ARCHITECTURE.md` (модель данных, RPC, поток, тесты), черновик пункта и подсказки в `scratch/pending-release/`.
