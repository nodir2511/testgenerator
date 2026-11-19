# Английский язык (этап 1) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** предмет «Английский язык» с текстами (чтение и пропуски) работает в банке, генераторе, Word, ключах, бланках и правке набора; три сборника English File импортированы без клонов.

**Architecture:** текст — строка таблицы `passages`; вопрос к тексту — обычный `test` со ссылкой `questions.passage_id`. Подбор берёт текст блоком из 8 вопросов (`_shared/ticketing.ts`), снимок вопроса несёт текст, Word печатает его один раз перед блоком. Остальные предметы не затрагиваются: у них `passage_id` пуст.

**Tech Stack:** Postgres (Supabase, RLS), TypeScript, React 19, vitest, `docx` 9; скрипты импорта — Node (`scratch/english`, в git не идут).

**Spec:** `docs/superpowers/specs/2026-11-19-english-subject-design.md`

## Global Constraints

- Перед работой прочитать `docs/ARCHITECTURE.md` и `CLAUDE.md`; открывать только файлы, названные в задаче.
- **Коммитов по задачам нет.** По `CLAUDE.md` правки копятся в рабочей папке и уходят одним релизом; шаг «Commit» в задачах заменён на «`npx tsc -b` и `npx vitest run` проходят».
- В рабочей папке лежат незакоммиченные правки режима НЦТ (право, история) в тех же файлах (`TicketGenerator.tsx`, `QuestionForm.tsx`, `QuestionList.tsx`, `BatchEditor.tsx`, `questionSwap.ts`, `nct.ts`). Их не откатывать и не переписывать.
- `ticketing.ts` и `pool.ts` — без импортов (их подключают и сайт, и Deno).
- `_shared/docxExport.ts`, `answerKey.ts`, `fractions.ts` руками не править: `node scripts/sync-docx-shared.mjs`.
- Английский предмет определяется по названию: `/англ|инглис|english/i` (как в `ClusterExam.tsx`). Проверять **до** таджикского: «Забони англисӣ» содержит «забони».
- Размер блока текста: `PASSAGE_SIZE = 8`. Текст с меньшим числом вопросов в билет не берётся.
- Термины интерфейса из `CLAUDE.md` (билет, набор, партия, банк вопросов) не заменять синонимами. Текст с вопросами в интерфейсе называется «текст».
- Новые цветовые классы Tailwind → `npm run theme:dark`.
- SQL идемпотентен; применение SQL, деплой функций и пуш — только с подтверждения пользователя.

## Review Focus

1. Предмет без текстов (химия и др.) после изменений подбирает и печатает билеты байт-в-байт как раньше — тест в задаче 2 (`pickTickets` без `readingCount`) и задаче 4 (снимок без `passage`).
2. В выбранных темах текстов меньше, чем вариантов — тексты повторяются, билет всё равно полный, пользователь видит заметку — тест в задаче 2.
3. В теме есть вопросы к текстам, но состав задан без текстов (старые настройки, бот) — вопросы к тексту в билет не попадают — тест в задаче 2.
4. Старый набор без `passage` в снимке и набор с «пустым местом» (`snapshot.empty`) внутри блока открываются, печатаются и правятся — тест в задаче 4 и 7.
5. Текст пропусков, где номеров-меток меньше или больше восьми — Word не падает, метки без вопроса остаются как есть — тест в задаче 4.

---

### Task 1: База — тексты и ссылка у вопроса

**Files:**
- Create: `supabase/sql/passages.sql`
- Modify: `src/types/database.ts`

**Interfaces:**
- Produces: таблица `public.passages(id uuid pk, subject_id, chapter_id, topic_id, source_id, batch_id, kind text check in ('reading','cloze'), title text, content text not null, is_deleted bool default false, created_by, created_at, updated_at)`; `questions.passage_id uuid references passages(id)`, `questions.passage_order smallint`; RPC `passage_counts(p_subject_id uuid)` → строки `{chapter_id, topic_id, kind, passages int, questions int}` (только неудалённые тексты, у которых ≥ 8 неудалённых вопросов; security invoker). Типы `Passage`, `PassageKind` в `database.ts`.

- [ ] **Step 1:** написать `passages.sql`: таблица, индексы (`passages(topic_id)`, `questions(passage_id)`), триггер `handle_updated_at`, RLS по образцу `questions` (SELECT — `can_view_subject(subject_id)` и неудалённые либо управляющий; INSERT/UPDATE — `can_manage_subject`; DELETE — `is_admin()`), `passage_counts`. Права анонимам не выдавать.
- [ ] **Step 2:** в пометке текста пропусков место пропуска записывается как `{{1}}` … `{{8}}` (номер = `passage_order`) — записать это комментарием в SQL (`comment on column passages.content`).
- [ ] **Step 3:** добавить типы в `database.ts`; `npx tsc -b` проходит.
- [ ] **Step 4:** показать SQL пользователю и применить после подтверждения: `npx supabase db query --linked -f supabase/sql/passages.sql`; проверка — `select * from passage_counts('<id любого предмета>')` возвращает 0 строк без ошибки.

### Task 2: Подбор блоков (`ticketing.ts`)

**Files:**
- Modify: `supabase/functions/_shared/ticketing.ts`
- Test: `tests/passages.test.ts` (новый)

**Interfaces:**
- Consumes: поля пула `passage_id`, `passage_order`, `passage: { kind }` (задача 3).
- Produces:
  - `PASSAGE_SIZE = 8`;
  - `Settings` + необязательные `readingCount?: number`, `clozeCount?: number` (число текстов; `testCount` — все тесты билета, включая вопросы текстов);
  - `interface PassageBlock { id: string; kind: 'reading' | 'cloze'; topic_id: string; chapter_id: string; questions: any[] }`;
  - `passageBlocks(pool: any[]): { reading: PassageBlock[]; cloze: PassageBlock[] }` — группировка по `passage_id`, вопросы по `passage_order`, берутся первые 8, блоки короче 8 отбрасываются;
  - `pickBlocks(blocks: PassageBlock[], count: number, T: number, rnd?: Rnd): PassageBlock[][]` — `[билет][место]`; место j во всех билетах — из одной темы, пока хватает; внутри билета и между билетами блоки не повторяются, пока хватает; среди равных — с меньшим суммарным `usageOf`;
  - `poolStats` дополнительно возвращает `reading`, `cloze` (число блоков), а `test` считает только вопросы без `passage_id`;
  - `singleTests(s: Settings): number` = `testCount − PASSAGE_SIZE × (readingCount + clozeCount)`;
  - `pickTickets`: тесты билета = блоки чтения, блоки пропусков, затем `pickParallel` по вопросам без `passage_id` в количестве `singleTests(s)`; вопросы с `passage_id` в обычный подбор не попадают никогда;
  - `checkSettings`: ошибка «Тестов в билете меньше, чем вопросов в текстах», если `singleTests(s) < 0`;
  - `fitSettings`: урезает `readingCount` / `clozeCount` до наличия с заметкой «Тексты для чтения: в билете N из M»; заметка о повторах, если блоков меньше `count × ticketCount`.

- [ ] **Step 1: тесты (падают).** В `tests/passages.test.ts`, пул строится помощником `mkPool({ reading: 3, cloze: 3, single: 12, matching: 8, open: 4 })`:
  - `pickTickets` c `{testCount: 20, readingCount: 1, clozeCount: 1, matchingCount: 4, openCount: 2, ticketCount: 2}`: в каждом билете `kinds[0][k].length === 20`; вопросы 0–7 имеют один `passage_id` вида `reading`, 8–15 — один `passage_id` вида `cloze`, `passage_order` идёт 1…8; вопросы 16–19 без `passage_id`;
  - два билета получают разные тексты;
  - **Review Focus 1:** пул без текстов и настройки без `readingCount` → результат `pickTickets` с тем же `rnd` (детерминированный генератор из `tests/ticketing.test.ts`) равен результату до изменений (снять эталон `JSON.stringify` id до правки кода и вписать в тест);
  - **Review Focus 2:** `reading: 1`, `ticketCount: 3` → все три билета полные, `fitSettings(...).notes` содержит строку про повтор текстов;
  - **Review Focus 3:** пул с текстами, настройки `{testCount: 10}` без `readingCount` → ни у одного выбранного вопроса нет `passage_id`; `poolStats(pool).test === 12`;
  - блок из 7 вопросов не возвращается `passageBlocks`; блок из 9 даёт первые 8 по `passage_order`;
  - `checkSettings({testCount: 10, readingCount: 1, clozeCount: 1, …})` возвращает ошибку.
- [ ] **Step 2:** `npx vitest run tests/passages.test.ts` — падает (нет экспортов).
- [ ] **Step 3:** реализовать по блоку Interfaces.
- [ ] **Step 4:** `npx vitest run` — все тесты проходят, включая `ticketing.test.ts`, `pool.test.ts`, `nct*.test.ts`.

### Task 3: Пул и снимок

**Files:**
- Modify: `supabase/functions/_shared/pool.ts`, `supabase/functions/_shared/ticketing.ts` (`toSnapshot`)
- Test: `tests/passages.test.ts`, `tests/pool.test.ts`

**Interfaces:**
- Produces: `POOL_SELECT` + `passage_id, passage_order, passage:passages(kind)`; `QUESTION_FULL_SELECT` + `passage:passages(id, kind, title, content)`; снимок вопроса текста получает `passage: { id, kind, title, content }` и `passage_order`; у вопроса без текста этих ключей в снимке нет.

- [ ] **Step 1: тесты.** `toSnapshot` вопроса с `passage` возвращает `passage.content` и `passage_order`; `Object.keys(toSnapshot(обычный вопрос))` не содержит `passage` (**Review Focus 1**); в `pool.test.ts` — запрос лёгкого пула содержит `passage_id`.
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3:** реализовать. Запасной запрос в `loadLightPool` (как для `question_usage`): при ошибке, упоминающей `passages` или `passage_id`, повторить без этих полей — база без миграции не ломает остальные предметы.
- [ ] **Step 4:** `npx vitest run` проходит.

### Task 4: Word — текст перед блоком, английские подписи, пять клеток

**Files:**
- Modify: `src/lib/docxExport.ts`
- Regenerate: `supabase/functions/_shared/docxExport.ts` (`node scripts/sync-docx-shared.mjs`)
- Test: `tests/passages.test.ts`

**Interfaces:**
- Consumes: снимок с `passage` (задача 3).
- Produces:
  - `isEnglishSubject(name: string): boolean`;
  - `passageRuns(questions: Array<{ question_snapshot: any }>): Array<{ start: number; end: number; passage: { id; kind; title; content } }>` — подряд идущие вопросы с одним `passage.id` (номера с 1);
  - `passageText(content: string, firstNo: number): string` — `{{n}}` → `__(firstNo + n − 1)__`, метки без пары остаются как есть;
  - `openBoxesFor('Английский язык') === 5`;
  - для английского: шапка `Variant N`, имя файла `Variant N.docx`, подпись открытого ответа `Answer:`, перед блоком — «Read the text and choose the correct answer 1 – 8.» (номера из `start`–`end`), заголовок жирным, текст по ширине, шрифт как у вопросов; у вопроса-пропуска (пустое условие) в таблице — только номер и варианты;
  - `buildTicketsFile(…, lang)` для английского предмета игнорирует `lang`: один язык, без папок, суффикс `EN`.

- [ ] **Step 1: тесты.** `passageRuns` на билете 8 чтение + 8 пропуски + 4 одиночных → два отрезка `1–8` и `9–16`; на старом билете без `passage` → `[]` (**Review Focus 4**); на билете, где внутри блока стоит `{ empty: true }`, отрезок разрывается, ошибки нет (**Review Focus 4**). `passageText('A {{1}} B {{2}}', 9)` → `'A __9__ B __10__'`; `passageText('A {{9}}', 9)` не бросает (**Review Focus 5**). `openBoxesFor('Забони англисӣ') === 5`, `openBoxesFor('Забони тоҷикӣ') === 5`, `openBoxesFor('Химия') === 4`. `buildSingleTicketBlob` для английского билета возвращает непустой Blob; распаковка `word/document.xml` содержит текст ровно один раз и строку `Variant 1`.
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3:** реализовать; высоту блока учесть в `estimateQuestionHeightPt` не требуется — текст идёт обычными абзацами вне таблицы вопроса.
- [ ] **Step 4:** `node scripts/sync-docx-shared.mjs`; `npx vitest run` и `npx tsc -b` проходят.

### Task 5: Генератор, бот и мини-приложение

**Files:**
- Modify: `src/components/TicketGenerator.tsx`, `src/components/DownloadButton.tsx`, `supabase/functions/_shared/generate.ts`, `supabase/functions/telegram-bot/index.ts` (`QUICK`), `src/tg/TgApp.tsx` (только состав по умолчанию)

**Interfaces:**
- Consumes: `passage_counts` (задача 1), `Settings.readingCount/clozeCount`, `poolStats().reading/cloze`, `singleTests` (задача 2).
- Produces: `generation_params.reading_count`, `generation_params.cloze_count` (числа; нет полей — 0); запрос `['passage_counts', subjectId]` (staleTime 30 с; сбрасывается там же, где `question_counts`).

- [ ] **Step 1:** `STANDARDS`: строка для английского `{ match: ['англ', 'инглис', 'english'], test: 20, matching: 4, open: 2, reading: 1, cloze: 1 }` — **выше** строки с «тадж».
- [ ] **Step 2:** в «Составе билета» два поля «Текстов для чтения» и «Текстов с пропусками» показываются, только если `passage_counts` предмета не пуст; под полем тестов подпись «из них отдельных: N» (`singleTests`). Сохранение в LS рядом с остальным составом.
- [ ] **Step 3:** передать `readingCount`/`clozeCount` в `checkSettings`, `fitSettings`, `pickTickets`; записать в `generation_params`; «Повторить» набор читает их обратно.
- [ ] **Step 4:** `DownloadButton`: проп `singleLang?: boolean` — кнопка без выбора языка; генератор и архив передают его для английского предмета (`isEnglishSubject`).
- [ ] **Step 5:** `generate.ts`: если у пула есть блоки и `testCount ≥ 16`, подставить `readingCount = 1`, `clozeCount = 1`; иначе 0. `QUICK` в боте — английский 20/4/2.
- [ ] **Step 6:** проверить в браузере (`preview_start` `dev`): на предмете без текстов поля не видны; `npx tsc -b`, `npx vitest run`.

### Task 6: Банк вопросов — тексты в списке и форме

**Files:**
- Create: `src/components/PassageEditor.tsx`, `src/lib/passages.ts`
- Modify: `src/components/QuestionList.tsx`, `src/components/QuestionForm.tsx`, `src/lib/questionIssues.ts`, `src/components/TaxonomyManager.tsx`, `src/components/BulkImport.tsx` (только откат партии)
- Test: `tests/questionChecks.test.ts` или новый `tests/passageIssues.test.ts`

**Interfaces:**
- Produces: `src/lib/passages.ts`: `fetchPassages(topicId: string): Promise<Passage[]>`, `savePassage(p: Partial<Passage> & { id?: string }): Promise<Passage>`, `passageLabel(p: Passage): string` («Чтение: <заголовок>» / «Пропуски: <заголовок>»); QK `['passages', topicId]`.

- [ ] **Step 1: тест.** `questionIssues` для теста с `passage_id` и пустым условием не выдаёт «пустой текст»; без `passage_id` — выдаёт как раньше.
- [ ] **Step 2:** реализовать исключение в `questionIssues.ts` (и в `questionChecks.ts`, если проверка пустого текста продублирована там).
- [ ] **Step 3:** `QuestionList`: бейдж текста у вопроса (`passageLabel` + «№ k»), фильтр «Текст» (появляется, когда в выбранной теме есть тексты), кнопка «Открыть текст» → `PassageEditor` (заголовок, содержание, вид; только для `canManage`).
- [ ] **Step 4:** `QuestionForm`: для вида «тест» необязательные поля «Текст» (список текстов темы) и «Место в тексте» (1–9); при выбранном тексте пропусков условие необязательно.
- [ ] **Step 5:** мягкое удаление темы/главы в `TaxonomyManager` и откат партии в `BulkImport` ставят `is_deleted = true` и текстам (`topic_id` / `batch_id`).
- [ ] **Step 6:** `npx tsc -b`, `npx vitest run`, `npm run theme:dark` при новых цветах.

### Task 7: Правка набора — замена блоком

**Files:**
- Modify: `src/lib/questionSwap.ts`, `src/lib/batchEdit.ts`, `src/components/BatchEditor.tsx`
- Test: `tests/questionSwap.test.ts`

**Interfaces:**
- Consumes: `passageBlocks`, `PassageBlock`, `PASSAGE_SIZE` (задача 2).
- Produces: `blockSlots(slots: Slot[], index: number): number[]` — индексы всех мест билета с тем же `snapshot.passage.id` (для обычного вопроса — `[index]`); `blockCandidates(pool: any[], kind: 'reading' | 'cloze', usedPassageIds: Set<string>): PassageBlock[]` — блоки того же вида, не занятые в наборе, реже использованные первыми.

- [ ] **Step 1: тесты.** Замена вопроса № 3 в билете меняет все 8 мест блока на вопросы одного нового текста в порядке `passage_order`; кандидаты не содержат текстов, уже стоящих в наборе; нет кандидатов → 8 «пустых мест» с `type: 'test'`; «Убрать тему», которой принадлежит текст, заменяет блок целиком; место с `snapshot.empty` внутри блока не роняет `blockSlots` (**Review Focus 4**); обычный вопрос заменяется как раньше (существующие тесты зелёные).
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3:** реализовать; `fetchTopicPool` и `fetchFullQuestions` берут поля текста; в `BatchEditor` у вопроса текста кнопка называется «Заменить текст».
- [ ] **Step 4:** `npx vitest run`, `npx tsc -b`.

### Task 8: Бланк и ключи с пятью клетками, кластер

**Files:**
- Modify: `src/lib/clusterSlots.ts`, `src/lib/answerKey.ts`, `src/lib/exportLazy.ts`, `scripts/omr-blanks.mjs`, `supabase/functions/_shared/omrScore.ts` (если раскладка выбирается там), `src/components/ClusterExam.tsx`
- Regenerate: `node scripts/sync-docx-shared.mjs`, `node scripts/omr-blanks.mjs`, `node scripts/build-key-templates.mjs` (если меняется состав шаблонов)
- Test: `tests/answerKey.test.ts`, `tests/omrScore.test.ts`, `tests/cluster.test.ts`

**Interfaces:**
- Решение пользователя: **английский во всём, что касается клеток, ключей и бланка, делается как таджикский.** На бумажном бланке у всех предметов 20 + 4 + 2 (в том числе у таджикского) четыре клетки на открытый вопрос — раскладку `k20` в `scripts/omr-blanks.mjs` не менять. Пять клеток — только в билете Word и в шаблоне ключей. Перед началом задачи сделать `git fetch` и посмотреть, не внесла ли эти правки другая сессия (пользователь давал это поручение в другом чате): если да — задача сводится к тестам.
- Produces: `keyKindOf('Английский язык') === 'eng'` (новое значение `KeyKind`), шаблон ключей для 20/4/2 — `taj-cluster` (пять клеток); `hasKeyTemplate('Английский язык') === true`; бланк `eng-26` — `like: 'taj'` вместо `bio` в `omr-blanks.mjs`; `CLUSTER_SUBJECTS.eng.openBoxes === 5`, `keyTemplate: 'taj-cluster'`. Проверка бланка по фото сравнивает столько первых цифр ответа, сколько клеток на бланке (для ответа из пяти цифр — первые четыре; пятая определяется однозначно).

- [ ] **Step 1: тесты.** `keyKindOf('Забони англисӣ') === 'eng'`, `keyKindOf('Забони тоҷикӣ') === 'taj'`; `keyTemplateName` для английского 20/4/2 → `taj-cluster`; ответ открытого вопроса `31425` целиком попадает в ключ Word (пять цифр); `scoreAnswers`: ключ `31425` и ответ с бланка `3142` — открытый вопрос засчитан (2 балла), ответ `3124` — нет.
- [ ] **Step 2:** тесты падают; реализовать; перегенерировать.
- [ ] **Step 3:** `ClusterExam`: пока книжка не умеет блоки, английский нельзя добавить в книжку — пункт выключен с подписью «Английский с текстами появится в книжке позже».
- [ ] **Step 4:** новый PDF `public/blanks/eng-26.pdf` печатает пользователь (Edge, масштаб 100 %) из `scratch/blanks/out` — сообщить ему; `npx vitest run`.

### Task 9: Импорт сборников

**Files (в git не идут):** `scratch/english/{parse,dedupe,keys,build_final,insert,verify}.mjs`, `scratch/english/NOTES.md`; образцы — `scratch/law4`, `scratch/ch5`.

**Interfaces:**
- Consumes: таблица `passages`, поля `passage_id`, `passage_order` (задача 1); исходники — три docx из `English.zip`.
- Produces: `scratch/english/final.json`: `{ chapters: [{ name, order_index, topics: [{ name, order_index, passages: [{ id, kind, title, content, questions: [...] }], questions: [...] }] }] }` с заранее заданными uuid.

- [ ] **Step 1: разбор** (`parse.mjs`): тест = заголовок `ENGLISH LANGUAGE … Unit <юнит> … Variant <n>`; № 1–8 → текст `reading` + 8 тестов; № 9–16 → текст `cloze` (метки `__9__`…`__16__` → `{{1}}`…`{{8}}`) + 8 тестов с пустым условием; № 17–20 → тесты; № 21–23 → соответствия (4 левых, 5 правых); № 24–25 → `open`, условие — инструкция и строки `1.`…`4.`, ответ — цифры ключа подряд. Ключи — блок в конце файла (`Variant n`, строки `1 B 2 B …`, `21 A 3, B 2, …`, `24 3 1 4 2`). Проверка: 144 / 210 / 216 тестов, у каждого 25 заданий и ключ.
- [ ] **Step 2: клоны** (`dedupe.mjs`): внутри юнита тексты с долей общих трёхсловных сочетаний > 0,5 — один текст, остаётся первый по номеру варианта; одиночные задания с одинаковым нормализованным условием и тем же верным ответом — одно; соответствия — одинаковый набор левых пунктов и ключ. Ожидаемо разных текстов чтения: 112 / 210 / 36. Отчёт в `NOTES.md`: сколько осталось и удалено по видам.
- [ ] **Step 3: ключи** — прочитать и проверить по смыслу **все** оставшиеся ключи (три параллельных субагента, по одному на уровень, каждый получает свой кусок `final.json` и возвращает список сомнительных номеров с объяснением). Ошибки сборника не исправлять — перечислить пользователю.
- [ ] **Step 4: вставка** (`insert.mjs`): сухой прогон без `--go`, затем `--go` после подтверждения пользователя. Предмет «Английский язык» (создать, если нет), главы «Beginner», «Elementary», «Pre-Intermediate» (`order_index` 1–3), темы «<юнит> — <грамматика и лексика из оглавления сборника>» (`order_index` — порядок юнита), источники «English File Beginner (Test Bank)» и т. д., партия на уровень в `import_batches`; порядок: тексты → вопросы → варианты → правые пункты → левые пункты.
- [ ] **Step 5: сверка** (`verify.mjs`): база против `final.json`, ключи прямо в базе, 0 расхождений; `passage_counts` показывает тексты во всех темах, где они есть.

### Task 10: Документация, релиз, общая проверка

**Files:**
- Modify: `docs/ARCHITECTURE.md` (разделы 4.1, 4.2, 5, 6.3, 7, 9, 10, 14, 15, 16), `docs/NCT_SUBJECTS.md` (строка об английском: этап 2)
- Create: `scratch/pending-release/english-subject.txt`, `scratch/pending-release/english-import.txt`

- [ ] **Step 1:** обновить `ARCHITECTURE.md`: таблица `passages`, поля вопроса, RPC, `passages.sql`, новые экспорты `ticketing.ts`/`docxExport.ts`, ключ кэша `passage_counts`, тест `passages.test.ts`, ловушка «вопросы с `passage_id` не берутся поодиночке».
- [ ] **Step 2:** черновики пунктов релиза (по строке `jsonb_build_object`): `new`, `site`, `min_rank` 1 — «Новый предмет „Английский язык“: в билете текст для чтения и текст с пропусками печатаются вместе со своими вопросами»; `new`, `site`, `min_rank` 2 — импорт с числом тестов, соответствий и текстов по уровням (цифры из `NOTES.md`).
- [ ] **Step 3:** `npm run build` проходит; в браузере: создать набор по английскому (2 варианта), скачать Word и ключи, заменить текст в `BatchEditor`, создать набор по химии и убедиться, что он как прежде.
- [ ] **Step 4:** сообщить пользователю, что нужно передеплоить `telegram-bot` и `tg-app` (правка `_shared`), и сколько пунктов накопилось в `scratch/pending-release/`.
