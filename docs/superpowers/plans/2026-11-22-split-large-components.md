# Разрезание тяжёлых компонентов — план реализации

> **Для исполнителя:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans. Шаги — чекбоксы (`- [ ]`).

**Цель:** уменьшить `TicketGenerator.tsx` (1467 строк), `QuestionForm.tsx` (1407) и `BulkImport.tsx` (1320) до ~400–600 строк каждый, не меняя поведения и внешнего вида.

**Архитектура:** сначала выносим чистую логику в `src/lib/*` и закрываем её тестами, затем режем JSX на презентационные подкомпоненты с явными props (состояние остаётся в родителе), в конце — тяжёлые мутации/обработчики в хуки. Каждый компонент превращается из одной функции на 1200+ строк в «сборщик» из блоков.

**Стек:** React 19, TypeScript, TanStack Query 5, Tailwind 3, vitest 5 (без jsdom и testing-library — тестов компонентов нет и не добавляем).

**Spec:** отдельной спеки нет. Основание — раздел «Технический долг» разговора от 2026-11-22 и `docs/ARCHITECTURE.md` (разделы 6.3, 7, 15). Публичные props и экспорты трёх компонентов не меняются.

## Global Constraints

- Рефакторинг без изменения поведения: тексты, классы Tailwind, порядок элементов, `id`-якоря (`qf-taxonomy`, `qf-text`), ключи `localStorage` (`examiner_*`, `examiner_qf_draft`, `examiner_import_*`, `examiner_tg_*`) и ключи react-query остаются **байт в байт**.
- Экспорты `TicketGenerator`, `QuestionForm`, `BulkImport` и их props (`QuestionFormProps`, `{ onSuccess }`) не меняются: `App.tsx` и другие вызывающие файлы не правятся.
- Проверка каждой задачи: `npx tsc -b` без ошибок, `npx vitest run` зелёный, `npm run theme:dark` не меняет `src/dark.css` (`git diff --exit-code src/dark.css`).
- Новые файлы называются по-английски (`PascalCase.tsx` для компонентов, `camelCase.ts` для логики), комментарии — по-русски, как в проекте.
- Термины интерфейса не менять (`билет`, `набор`, `партия`, `банк вопросов`).
- Это не изменение для пользователей: записи «Что нового», подъёма версии и релиза **нет** (CLAUDE.md: рефакторинг без пункта в счёт не идёт). Правка `docs/ARCHITECTURE.md` (раздел 6.3 и 7) — в коммите той задачи, что меняет структуру.
- Работать в отдельной ветке/worktree, по одному компоненту за раз, каждую задачу — отдельным коммитом, ветку заливать в `main` быстро: в `main` пушат параллельно, а эти три файла правятся чаще всего (`git fetch` перед началом и перед пушем).

## Review Focus

1. Несохранённый черновик нового вопроса: после выноса `readDraft`/`DRAFT_KEY` старый черновик из `localStorage` (`examiner_qf_draft`) должен восстанавливаться как раньше.
2. Закрытие формы вопроса с несохранёнными изменениями: `App` по-прежнему спрашивает подтверждение (признак `dirty` не потерян при разбиении).
3. Оптимистическая блокировка `version` при правке вопроса: порядок «вставить варианты → обновить с `.eq('version', …)` → удалить старые» при переносе `saveMutation` не меняется.
4. Импорт: дубли в теме пропускаются, откат партии скрывает вопросы, картинки грузятся только на этапе сохранения.
5. Тёмная тема и закреплённые панели (`xl:sticky`, `sticky bottom-0`) после переноса JSX в подкомпоненты выглядят так же; новых цветовых классов нет.

---

### Task 1: BulkImport — чистая логика в `src/lib/importParse.ts`

**Files:**
- Create: `src/lib/importParse.ts`, `tests/importParse.test.ts`
- Modify: `src/components/BulkImport.tsx:37-107` (удалить перенесённое, добавить импорт)

**Interfaces:**
- Produces (экспорты `importParse.ts`, сигнатуры как сейчас в файле): `type ImportLang = 'ru' | 'tg'`, `interface ParsedRow`, `interface ImportReport`, `parseNumericAnswer(raw?: string): number | null`, `answerWarning(type: QuestionType, answer?: string): string[]`, `langFields(lang: ImportLang | undefined, text: string, textTg?: string)`, `normText(x: string | null | undefined): string`, `isCorrectLetter(answer: string | undefined, optionIndex: number): boolean`.

- [ ] **Step 1: Failing tests в `tests/importParse.test.ts`** (импорт из `../src/lib/importParse`): `parseNumericAnswer('12,5') === 12.5`, `parseNumericAnswer('abc') === null`, `parseNumericAnswer('')` не бросает; `isCorrectLetter('B', 1) === true`, кириллическая `'В'` для индекса 1 тоже `true` (кириллические А/В/С/Е считаются латинскими — правило из CLAUDE.md), `isCorrectLetter('A', 1) === false`; `normText('<b>Да</b>  Нет ')` без тегов, одиночные пробелы, нижний регистр; `answerWarning('open', undefined).length > 0`.
- [ ] **Step 2:** `npx vitest run tests/importParse.test.ts` — FAIL (модуля нет).
- [ ] **Step 3:** Перенести функции и типы из `BulkImport.tsx` как есть (`export`), в компоненте заменить на `import … from '../lib/importParse'`. Если часть значений ожиданий в Step 1 отличается от реального поведения — подогнать тест под **текущее** поведение (код не менять).
- [ ] **Step 4:** `npx vitest run tests/importParse.test.ts` и `npx tsc -b` — PASS.
- [ ] **Step 5:** Commit `refactor: BulkImport — чистая логика разбора в lib/importParse`.

### Task 2: BulkImport — подкомпоненты в `src/components/bulk-import/`

**Files:**
- Create: `src/components/bulk-import/DefaultTaxonomyBar.tsx` (JSX 886–947), `FileTab.tsx` (948–1047), `TextTab.tsx` (1048–1063), `HistoryTab.tsx` (1064–1107), `ImportReportCard.tsx` (1108–1131), `PreviewTable.tsx` (1134–1312), `ImageLightbox.tsx` (1315–конец)
- Modify: `src/components/BulkImport.tsx`

**Interfaces:**
- Consumes: типы `ParsedRow`, `ImportReport` из Task 1.
- Produces: каждый подкомпонент — `React.FC<Props>`, где `Props` — ровно значения и колбэки, которые блок сейчас берёт из замыкания (состояние, `setX`, обработчики `handleFileUpload`, `handleParsePair`, `handleParseText`, …). Состояние `useState` остаётся в `BulkImport`; подкомпонент состояния данных не создаёт (локальные `useState` UI-мелочей допустимы только если они уже были локальными по смыслу).

- [ ] **Step 1:** Блоки выносить по одному, начиная с самого независимого (`ImageLightbox`), после каждого — `npx tsc -b`. Типы props выводить из ошибок `tsc` (сначала `any`-ничего не использовать: перечислять явные типы).
- [ ] **Step 2:** После всех блоков `BulkImport.tsx` содержит состояние, обработчики и сборку блоков; цель ≤ 700 строк (мутации — Task 3).
- [ ] **Step 3:** Проверка: `npx tsc -b`, `npx vitest run`, `git diff --exit-code src/dark.css` после `npm run theme:dark`. Вручную в `npm run dev` (раздел «Массовый импорт»): загрузка .docx-пары, вставка текста, предпросмотр, вкладка «История партий» (под админом), открытие картинки — без ошибок в консоли.
- [ ] **Step 4:** Commit `refactor: BulkImport — вкладки, предпросмотр и итог импорта в подкомпоненты`.

### Task 3: BulkImport — мутации в хук `useBulkImport`

**Files:**
- Create: `src/components/bulk-import/useImportMutations.ts`
- Modify: `src/components/BulkImport.tsx` (`importMutation` 527–790, `revertBatchMutation` 792–808)

**Interfaces:**
- Produces: `useImportMutations(params: { parsedRows: ParsedRow[]; …то, что мутации читают из замыкания; onSuccess: () => void }): { importMutation; revertBatchMutation }` — те же объекты `useMutation`, что были в компоненте, с теми же `meta.action`/`meta.success` и теми же сбросами кэша (`questions`, `question_counts`, …).

- [ ] **Step 1:** Перенести тела мутаций без изменений; ключи кэша и тексты уведомлений не трогать (Review Focus №4).
- [ ] **Step 2:** `npx tsc -b`, `npx vitest run`; вручную: импорт 2–3 тестовых вопросов в тестовую тему, повторный импорт того же (дубли пропускаются), «Откатить партию».
- [ ] **Step 3:** Обновить `docs/ARCHITECTURE.md` (6.3, строка `BulkImport.tsx`: «подкомпоненты в `bulk-import/`, разбор — `lib/importParse.ts`»), commit `refactor: BulkImport — мутации импорта в хук`.

### Task 4: QuestionForm — черновик и пустые структуры в `src/lib/questionDraft.ts`

**Files:**
- Create: `src/lib/questionDraft.ts`, `tests/questionDraft.test.ts`
- Modify: `src/components/QuestionForm.tsx:36-81`

**Interfaces:**
- Produces: `DRAFT_KEY = 'examiner_qf_draft'`, `interface Draft`, `readDraft(): Draft | null`, `ruOf(ru?: string | null, base?: string | null, tg?: string | null): string`, `emptyOptions(): TestOptionState[]`, `emptySide(side: 'left' | 'right', n: number): MatchingItemState[]`, типы `TestOptionState`, `MatchingItemState`.

- [ ] **Step 1: Failing tests:** `DRAFT_KEY === 'examiner_qf_draft'`; `emptyOptions().length === 4` и ровно ноль верных; `emptySide('left', 4).length === 4`, `emptySide('right', 5).length === 5`; `readDraft()` без `localStorage`/с битым JSON возвращает `null` и не бросает (подменить `globalThis.localStorage` заглушкой — vitest в node-среде).
- [ ] **Step 2:** `npx vitest run tests/questionDraft.test.ts` — FAIL.
- [ ] **Step 3:** Перенести код как есть; импорты в `QuestionForm.tsx`.
- [ ] **Step 4:** `npx vitest run` и `npx tsc -b` — PASS.
- [ ] **Step 5:** Commit `refactor: QuestionForm — черновик и пустые структуры в lib/questionDraft`.

### Task 5: QuestionForm — блоки формы в `src/components/question-form/`

**Files:**
- Create: `TaxonomyFields.tsx` (655–763), `TypeAndLangBar.tsx` (777–854), `QuestionTextFields.tsx` (857–940), `TestOptionsEditor.tsx` (943–1101), `MatchingEditor.tsx` (1103–1365, самый большой — резать последним), `OpenAnswerEditor.tsx` (1367–1380), `FormActions.tsx` (1384–1416), `DraftBanner.tsx` (629–641)
- Modify: `src/components/QuestionForm.tsx`

**Interfaces:**
- Consumes: типы из Task 4.
- Produces: презентационные `React.FC<Props>`; все `useState` формы, `dirty`, `saveMutation` и загрузчики картинок (`handleMainImageUpload`, `handlePaste`, `handleOptionImageUpload`) остаются в `QuestionForm` и приходят как props. Якоря `id="qf-taxonomy"`, `id="qf-text"` сохраняются на тех же элементах (на них ссылается `QuestionProgress`).

- [ ] **Step 1:** Выносить по одному блоку, после каждого `npx tsc -b`; `MatchingEditor` — последним, с отдельной ручной проверкой.
- [ ] **Step 2:** Правая колонка `<aside>` (sticky) и раскладка `xl:grid` остаются в `QuestionForm.tsx`.
- [ ] **Step 3:** Вручную в `npm run dev`: новый вопрос каждого типа (тест, соответствие, открытый), RU↔TG переключатель, вставка картинки из буфера, черновик (закрыть форму не сохраняя, открыть снова — баннер восстановления), правка существующего вопроса. `npm run theme:dark` — без изменений `dark.css`.
- [ ] **Step 4:** Commit `refactor: QuestionForm — блоки формы в подкомпоненты`.

### Task 6: QuestionForm — `saveMutation` в хук `useSaveQuestion`

**Files:**
- Create: `src/components/question-form/useSaveQuestion.ts`
- Modify: `src/components/QuestionForm.tsx` (356–580)

**Interfaces:**
- Produces: `useSaveQuestion(deps): UseMutationResult<…>` — прежний `useMutation` с теми же `meta`, тем же порядком запросов «вставить варианты → `update … .eq('version', version)` → удалить старые» (Review Focus №3) и теми же сбросами кэша.

- [ ] **Step 1:** Перенести без изменений логики. Не «чистить» цепочку запросов.
- [ ] **Step 2:** Вручную: правка вопроса в двух вкладках браузера подряд — вторая должна получить ошибку блокировки по `version`, как раньше; создание нового — `version: 1`.
- [ ] **Step 3:** Обновить `docs/ARCHITECTURE.md` (6.3, `QuestionForm.tsx`; 7 — `questionDraft.ts`), commit `refactor: QuestionForm — сохранение вопроса в хук`.

### Task 7: TicketGenerator — чистая логика в `src/lib/generatorHelpers.ts`

**Files:**
- Create: `src/lib/generatorHelpers.ts`, `tests/generatorHelpers.test.ts`
- Modify: `src/components/TicketGenerator.tsx:58-158`

**Interfaces:**
- Produces: `STANDARDS`, `standardFor(name?: string)`, `isEnglishName(name?: string | null): boolean`, `plural(n: number, one: string, few: string, many: string): string`, `dushanbeDayStart(): Date | number` (тип — как сейчас), `formatWait(s: number): string`, `getStorageJSON<T>(key, fallback)`, `getStorageString`, `getStorageNumber`, `getStorageBool`, `ADMIN_SITE_LIMITS`. Если одна из `getStorage*` уже есть в другом модуле — использовать её, а не дублировать (DRY).

- [ ] **Step 1: Failing tests:** `formatWait(65) === '1:05'`; `plural(1,'билет','билета','билетов') === 'билет'`, `plural(2,…) === 'билета'`, `plural(5,…) === 'билетов'`, `plural(21,…) === 'билет'`; `isEnglishName('Английский язык') === true`, `isEnglishName('Химия') === false`; `standardFor('Право')` — `{test: 20, matching: 4, open: 2}` (стандарт из `docs/ARCHITECTURE.md`, раздел 16); `standardFor('Английский язык')` содержит `reading` и `cloze`; `getStorageNumber('нет такого', 7) === 7` при пустом `localStorage`.
- [ ] **Step 2:** `npx vitest run tests/generatorHelpers.test.ts` — FAIL.
- [ ] **Step 3:** Перенести как есть (ожидания в тесте подогнать под текущее поведение, код не менять).
- [ ] **Step 4:** `npx vitest run`, `npx tsc -b` — PASS.
- [ ] **Step 5:** Commit `refactor: TicketGenerator — вспомогательная логика в lib/generatorHelpers`.

### Task 8: TicketGenerator — блоки интерфейса в `src/components/generator/`

**Files:**
- Create: `Controls.tsx` (`TriCheckbox`, `Stepper`, 160–195), `GeneratedBatchPanel.tsx` (936–1038), `IntroCard.tsx` (1039–1067), `ScopeColumn.tsx` (левая колонка 1069–1207: предмет, главы, темы), `CompositionColumn.tsx` (правая колонка 1209–1500: состав, режим НЦТ, перемешивание, название, лимиты, кнопка «Создать»)
- Modify: `src/components/TicketGenerator.tsx`

**Interfaces:**
- Produces: презентационные `React.FC<Props>`; `useState`, `useQuery`, `useMemo` (`poolStats`, `health`) и все обработчики остаются в `TicketGenerator` и приходят как props. Для `ScopeColumn` и `CompositionColumn` props группировать в объекты (`scope: {…}`, `composition: {…}`), чтобы не получить компонент с 60 отдельными props.

- [ ] **Step 1:** Порядок: `Controls` → `IntroCard` → `GeneratedBatchPanel` → `ScopeColumn` → `CompositionColumn`; после каждого `npx tsc -b`.
- [ ] **Step 2:** Вручную в `npm run dev`: выбор предмета, режим «весь предмет»/«выбор» с галочками глав и тем (трёхпозиционный чекбокс), счётчики лимитов и обратный отсчёт, генерация билета, скачивание, «В Telegram», открытие предпросмотра варианта, режим НЦТ (под главным админом), первый вход (сбросить `examiner_intro_done`). `npm run theme:dark` — без изменений.
- [ ] **Step 3:** Commit `refactor: TicketGenerator — колонки и панели в подкомпоненты`.

### Task 9: TicketGenerator — `handleGenerate` и скачивание в хук

**Files:**
- Create: `src/components/generator/useGenerate.ts`
- Modify: `src/components/TicketGenerator.tsx` (`handleGenerate` 599–790, `handleDownload` 831, `exportSingleWithKey` 852, `handleExportKey` 865, `handleShareTickets` 877)

**Interfaces:**
- Produces: `useGenerate(deps): { handleGenerate: (cfg?: GenCfg) => Promise<void>; handleDownload: (lang: Lang) => Promise<void>; handleExportKey: () => Promise<void>; handleShareTickets: () => Promise<void>; exportSingleWithKey: (t: any, lang: 'ru' | 'tg') => Promise<void> }` — прежнее поведение и порядок шагов потока «Создание билетов на сайте» (`docs/ARCHITECTURE.md`, раздел 10, шаги 1–9), включая сброс кэша `saved_ticket_batches`, `recent_batches`, `generation_usage_today`.

- [ ] **Step 1:** Перенести, не меняя порядка (`checkSettings` → `loadLightPool` ∥ `question_counts` → `fitSettings` → `pickTickets` → `hydrateTickets` → `save_ticket_batch`). Существующие тесты подбора (`ticketing.test.ts`, `pool.test.ts`, `nct*.test.ts`) должны остаться зелёными.
- [ ] **Step 2:** Вручную: обычная генерация 2 вариантов, генерация по формату НЦТ (химия, главный админ), превышение лимита (учётная запись без прав админа) — сообщения те же.
- [ ] **Step 3:** Обновить `docs/ARCHITECTURE.md` (6.3 `TicketGenerator.tsx`, 7 — `generatorHelpers.ts`), commit `refactor: TicketGenerator — генерация и скачивание в хук`.

### Task 10: Итоговая проверка

- [ ] **Step 1:** `wc -l` по трём файлам: каждый ≤ ~700 строк (цель из начала плана; если выше — записать причину в коммит, не дорезать насильно).
- [ ] **Step 2:** `npm run build` целиком, `git diff --exit-code src/dark.css` после `npm run theme:dark`.
- [ ] **Step 3:** Сквозной ручной проход: создать вопрос → импортировать пару вопросов → собрать билет → скачать Word → открыть предпросмотр (все три экрана).
- [ ] **Step 4:** `git fetch`, rebase на `main`, push; убедиться, что CI зелёный.

---

## Самопроверка

- Покрытие: все три файла имеют задачи на логику (1, 4, 7), JSX (2, 5, 8) и тяжёлые обработчики (3, 6, 9); итог — Task 10.
- Типы: `ParsedRow`/`ImportReport` (Task 1) используются в Tasks 2–3; `Draft`, `TestOptionState`, `MatchingItemState` (Task 4) — в Tasks 5–6; `GenCfg`, `Lang` остаются в `TicketGenerator` и приходят в хук Task 9.
- Ограничение честности плана: номера строк — на коммите `a6fd9c3`; перед началом сверить (`git blame` / поиск по комментариям `{/* … */}`), так как файлы активно правятся.
- Тестов компонентов нет и не добавляется (нет jsdom/testing-library): защита от регрессий — типы, существующие 45 тестов, тесты на вынесенную логику и ручной проход после каждого компонента. Если нужна автоматическая защита UI, это отдельная идея (Playwright-смоуки), в этот план не входит.
