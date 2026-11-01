# Схема проекта

Сверено с кодом и живой базой на версии 0.28.3 (1 ноября 2026).
Как пользоваться: найдите нужный раздел, откройте только указанные в нём файлы. Весь код перечитывать не нужно.
Меняете структуру (таблица, функция БД, модуль, экспорт, ключ кэша, поток данных, правило деплоя) — обновите этот файл в том же коммите.

Содержание: 1 Обзор · 2 Каталоги · 3 Роли · 4 База данных · 5 SQL-файлы · 6 Сайт: вход и вкладки · 7 Модули src/lib · 8 Edge Functions · 9 Общий код _shared · 10 Потоки · 11 Кэш · 12 Лимиты · 13 Разработка и выпуск · 14 Тесты · 15 Ловушки

---

## 1. Обзор

Сайт для преподавателей. Ведёт банк вопросов по предметам: тест, соответствие, открытый, на русском и таджикском. Собирает из банка параллельные экзаменационные билеты и выдаёт их в Word вместе с ключами ответов. Те же билеты делают Telegram-бот и Telegram Mini App. Для главного админа есть экзамен-кластер (книжка из 4 предметов) и «Своя игра».

| Часть | Технологии | Где живёт |
|---|---|---|
| Сайт | React 19, TypeScript, Vite 6, Tailwind 3, TanStack Query 5, supabase-js 2 | Vercel, автодеплой при пуше в `main` |
| База, вход, файлы | Supabase: Postgres 17, Auth, Storage, Realtime | проект `ovxrgkyexuudgtqglegk`, регион ap-northeast-2 (Сеул) |
| Сервер | Supabase Edge Functions (Deno) | `supabase/functions/*` |
| Word | `docx` 9, `jszip`, `file-saver` | браузер и Edge Functions |
| Excel | `read-excel-file`, `write-excel-file` | импорт, выгрузка итогов игры |

Репозиторий: github.com/nodir2511/testgenerator. В `main` пушат параллельно, в том числе другие сессии ИИ.

## 2. Каталоги

```
index.html              <head>: favicon.svg, preconnect к Google Fonts, /font-loader.js (defer), noscript-шрифт; точка входа /src/main.tsx
vite.config.ts          alias @ → src; manualChunks: vendor (react), supabase, query
vercel.json             rewrites /tg /game /play → index.html; заголовки безопасности (CSP, X-Frame-Options; для /tg — frame-ancestors web.telegram.org); Cache-Control для /assets, /key-templates, /cluster-assets
public/                 favicon.svg, font-loader.js, key-templates/{bio,chem,phys,taj,taj-cluster}.docx, cluster-assets/{ru,tj}_*.png
src/main.tsx            QueryClient; маршрутизация по пути (раздел 6.1); prefetchOnStartup
src/App.tsx             Шапка, вкладки, мобильная навигация, форма вопроса, окно «Что нового», ChangePasswordScreen
src/components/         Экраны и элементы интерфейса (раздел 6.3)
src/lib/                Логика без интерфейса (раздел 7)
src/hooks/              useAuth.tsx, useReleases.ts
src/game/               «Своя игра»: GameHost, GamePlay, GameScreen, api.ts, ui.tsx, content.ts, review.ts, game.css
src/tg/                 TgApp.tsx + tg.css — Telegram Mini App (/tg)
src/types/database.ts   Типы таблиц и ролей
supabase/functions/     Edge Functions + _shared (разделы 8, 9)
supabase/sql/           SQL базы (раздел 5); releases/ — записи «Что нового», по файлу на версию
templates/key/*.docx    Исходники шаблонов ключей
scripts/                sync-docx-shared.mjs, build-key-templates.mjs
tests/                  vitest (раздел 14)
docs/ARCHITECTURE.md    Этот файл
.github/workflows/      backup.yml — копия базы на Google Диск (запуск вручную, ночной cron выключен)
scratch/, temp_docs/    Рабочие материалы, в git нет
```

## 3. Роли и права

`profiles.role` ∈ `user` | `subject_teacher` | `subject_admin` | `admin`; флаг `profiles.is_owner` (главный админ, только вместе с `admin`).

| Роль | Подпись | Ранг `my_rank()` | Вопросы | Вкладки сверх общих |
|---|---|---|---|---|
| user | Преподаватель | 1 | читает все неудалённые | — |
| subject_teacher | Преподаватель по предметам | 1 | только свои предметы | — |
| subject_admin | Администратор по предметам | 2 | свои предметы, правит их, видит удалённые | Предметы и темы, Массовый импорт |
| admin | Администратор | 3 | все, включая удалённые | + Пользователи, Статистика, Корзина |
| admin + is_owner | Главный админ | 4 | все | + Экзамен-кластер, Своя игра |

Общие вкладки: Банк вопросов, Генератор, Сохранённые билеты, Что нового.

- В коде (`useAuth`): `isAdmin` (role=admin), `isOwner`, `isStaff` (admin или subject_admin), `subjectIds` (назначенные предметы для ролей «по предметам», иначе `null`), `canManage(subjectId)`.
- Предметы назначает и снимает только главный админ (`user_subjects`).
- Роль меняет только админ; триггеры `prevent_role_escalation`, `prevent_owner_escalation`, `protect_profile_fields` не дают поднять себе права.
- Регистрация закрыта: `guard_signup` на `auth.users` пропускает только email из `account_invites`, приглашение пишет `admin-create-user`.
- Пароль, заданный админом, ставит `must_change_password = true`. `App` показывает `ChangePasswordScreen`, пока пользователь не сменит пароль; флаг снимает триггер `password_changed`.
- Интерфейс только прячет вкладки. Настоящая защита в RLS (раздел 4.4).

## 4. База данных (schema public)

### 4.1 Таблицы

**Справочники** (мягкое удаление через `is_deleted`):
- `subjects(id, name, is_deleted, created_by, created_at, updated_at)`
- `chapters(id, subject_id, name, order_index, is_deleted, …)`
- `topics(id, chapter_id, name, order_index, is_deleted, …)` — предмета у темы нет, только через главу.
- `sources(id, name, is_deleted)` — источник вопроса (сборник).

**Вопросы**:
- `questions`:
  - привязка: `id`, `subject_id`, `chapter_id`, `topic_id`, `source_id`, `batch_id` (партия импорта);
  - содержание: `type` (test|matching|open), `content`, `content_ru`, `content_tg`, `image_url`, `correct_numeric_answer`;
  - `version` — оптимистическая блокировка;
  - удаление: `is_deleted`, `deleted_at`, `deleted_by`;
  - автор и даты: `created_by`, `updated_by`, `created_at`, `updated_at`;
  - порядок: `seq` (порядок вставки), `num` (номер в теме, ставит триггер `questions_assign_num`);
  - `linked_ids uuid[]` — тесты, из которых сделан этот вопрос.
- `question_options(id, question_id, text, text_ru, text_tg, image_url, is_correct, order_index)`
- `matching_items(id, question_id, side left|right, text, text_ru, text_tg, image_url, order_index, correct_match_id)` — ответ хранится у левого элемента.

**Билеты**:
- `ticket_batches(id, title, subject_id, created_by, generation_params jsonb, created_at)`. Поля `generation_params`:
  - выбор: `chapter_ids`, `topic_ids`;
  - состав: `test_count`, `matching_count`, `open_count`, `ticket_count`, `requested{test,matching,open}`;
  - перемешивание: `shuffle_options`, `shuffle_matching`;
  - откуда: `source` (site|telegram|telegram-app|cluster), `lang`;
  - `auto_title`, у кластера — свои поля.
- `tickets(id, batch_id, ticket_number)`.
- `ticket_questions(id, ticket_id, question_id, order_index, question_snapshot jsonb)`. Снимок самодостаточен: `id`, `type`, `content*`, `image_url`, `correct_numeric_answer`, `chapter_name`, `topic_name`, `options[]` (с `is_correct`), `matching_items[]` (с `correct_match_id`); у кластера ещё `cluster_slot`.

**Лимиты и учёт**:
- `generation_settings` — одна строка, `id = true`: `per_day`, `cooldown_seconds`, `max_tickets`, `max_per_ticket`.
- `generation_usage(user_id, batch_id, source, subject_id, params, created_at)` — пишет триггер; удалённые наборы тоже считаются.
- `generation_locks(user_id, locked_at)` — одна генерация бота на пользователя.
- `audit_logs(user_id, action, entity_type, entity_id, details)`.
- `import_batches(id, created_by, filename, items_count, is_reverted)`.

**Обновления сайта**:
- `site_releases(id, version, title, released_at)`
- `site_release_items(release_id, kind new|fixed|improved, text, min_rank 1–4, order_index, subject_id)`
- `site_release_reads(user_id, release_id, read_at)`

**Пользователи**:
- `profiles(id = auth.users.id, email, full_name, role, is_owner, must_change_password)`
- `user_subjects(user_id, subject_id)`
- `user_prefs(user_id, key, value jsonb)` — сейчас там параметры кластера.
- `account_invites(email, expires_at)`

**Telegram**:
- `telegram_links(chat_id, user_id)`
- `telegram_link_codes(code, user_id, expires_at)`
- `telegram_sessions(chat_id, state jsonb)` — состояние диалога бота.

**Своя игра**:
- `game_sessions(code, host_id, teams, board, buzz, input)` — живое состояние, Realtime.
- `game_secrets(code, n, secret, pin, fails)` — ключи команд.
- `game_bids(code, n, amount, t)`
- `game_net(code, n, rtt, err, updated_at)` — задержка и погрешность часов телефонов команд; доступ только через RPC
- `game_packs(id, title, content)` — вопросы с ответами, видит только ведущий.
- `game_results(host_id, code, round, title, teams, review, finished_at)`

**Storage**: бакет `question-images` (public). Загрузка и удаление только у админов, чтение для вошедших. Загружает `uploadQuestionImage` в `src/lib/imageCompression.ts`.

### 4.2 Функции БД (RPC)

| Группа | Функции |
|---|---|
| Права (используют RLS и код) | `is_admin()`, `is_owner()`, `is_staff()`, `my_rank()`, `auth_role()`, `auth_subject_ids()`, `auth_question_ids()`, `can_view_subject(sid)`, `can_manage_subject(sid)`, `can_manage_chapter(cid)`, `can_view_question(qid)`, `can_manage_question(qid)`, `is_cluster_batch(params)` |
| Билеты | `question_counts(p_subject_id)` → строки `{chapter_id, topic_id, type, cnt}` по неудалённым вопросам (security invoker) |
| | `save_ticket_batch(p_batch, p_tickets)` → `{batch, tickets[]}`, одна транзакция (invoker; автор — `auth.uid()` или `p_batch.created_by` у сервисного ключа) |
| | `acquire_generation_lock(p_user, p_ttl_seconds)` → `bool` |
| Статистика | `admin_usage_stats_v3(p_days, p_no_admins)` (используется), `admin_usage_stats(p_days)` (старая, запасной вариант), `usage_scope(p_no_admins)` |
| Что нового | `add_site_release(p_version, p_title, p_items jsonb, p_released_at)` — повторный вызов с той же версией безопасен |
| Telegram | `create_telegram_link_code()` → код для `/start КОД` |
| Игра | `game_create`, `game_join`, `game_rejoin`, `game_rename`, `game_remove_team`, `game_team_pins`, `game_is_host`, `game_buzz`, `game_buzz_clear`, `game_buzz_drop`, `game_check`, `game_team_act`, `game_bids_get`, `game_sync_seq`, `game_time`, `game_now_ms`, `game_has_n`, `game_net_report`, `game_net_get` (связь телефонов, видит ведущий). `game_buzz(p_code, p_n, p_secret, p_t, p_seq, p_err)` строит очередь по времени касания по серверным часам |

### 4.3 Триггеры

| Таблица | Триггер → функция | Что делает |
|---|---|---|
| auth.users | `on_auth_user_created` → `handle_new_user` | создаёт `profiles` |
| auth.users | `guard_signup` → `guard_signup` | регистрация только по приглашению |
| auth.users | `on_auth_password_changed` → `password_changed` | снимает `must_change_password` |
| profiles | `prevent_role_escalation`, `prevent_owner_escalation`, `prevent_owner_on_insert`, `protect_profile_fields` | защита ролей и полей |
| profiles | `audit_role_change` | смена роли пишется в `audit_logs` |
| user_subjects | `audit_user_subjects` (after insert) | журнал назначений |
| questions | `trg_questions_assign_num` (insert/update) | номер `num` в теме |
| questions | `questions_track_delete` | ставит `deleted_at` и `deleted_by` |
| ticket_batches | `trg_enforce_generation_limits` (after insert) | лимиты (раздел 12) и запись в `generation_usage` |
| tickets, ticket_questions | `guard_ticket_insert` | не-админ дописывает билеты только в партию моложе 2 минут и в пределах `generation_settings` |
| generation_settings | `trg_generation_settings_stamp` | `updated_at` и `updated_by` |
| subjects, chapters, topics, questions, profiles | `set_*_updated_at` → `handle_updated_at` | `updated_at` |

### 4.4 RLS (кратко; точный текст — `select * from pg_policies`)

- RLS включён на всех таблицах. Во всех политиках `(select auth.uid())`: вычисляется один раз на запрос (`rls_initplan_indexes.sql`).
- **questions**:
  - SELECT: admin — всё; user — неудалённые; subject_teacher — неудалённые своих предметов; subject_admin — все своих предметов.
  - DELETE — только админ.
  - INSERT и UPDATE — по `can_manage_*`.
- **question_options, matching_items**: SELECT — admin и user всё, остальные через `auth_question_ids()`.
- **chapters, topics, subjects**: SELECT для вошедших, DELETE только админ, INSERT и UPDATE для управляющих предметом.
- **ticket_batches, tickets, ticket_questions**: свои наборы; owner видит все. Кластерные (`is_cluster_batch`) видит и создаёт только owner.
- **profiles**:
  - SELECT — себя или админ.
  - UPDATE — себя; owner — всех; админ — не-админов.
- **user_subjects**: SELECT — своё или админ; INSERT и DELETE — только owner.
- **site_releases, site_release_items**: SELECT по `my_rank()` и предмету; запись — owner.
- **audit_logs**: SELECT — админ.
- **generation_usage**: SELECT — своё или админ.
- **generation_settings**: SELECT — все, UPDATE — админ.
- **game_\***: ведущий через `host_id`. Команды ходят только через RPC с секретом.

## 5. SQL-файлы (`supabase/sql`)

Применяются вручную (раздел 13), почти все идемпотентны. Порядок появления:

| Файл | Что делает |
|---|---|
| `supabase_schema.sql` | базовая схема, индексы, `handle_new_user` |
| `security_hardening.sql` | первая волна защиты |
| `security_round2.sql` | вторая волна защиты |
| `security_round3.sql` | закрытая регистрация, `account_invites`, `must_change_password` |
| `fix_role_escalation.sql`, `close_public_read.sql`, `step2_lock.sql` | точечные исправления доступа |
| `subject_roles.sql`, `subject_roles_options.sql` | роли «по предметам» |
| `questions_rls_fast.sql` | быстрые политики вопросов: `auth_role`, `auth_subject_ids` |
| `rls_initplan_indexes.sql` | `(select auth.uid())` в 25 политиках, индексы билетов |
| `question_order.sql` | `num` и `seq`, индексы по теме |
| `question_links.sql` | `linked_ids` |
| `question_counts.sql` | RPC `question_counts` |
| `trash.sql` | корзина, `questions_track_delete` |
| `save_ticket_batch.sql` | RPC сохранения набора |
| `generation_limits.sql` | `generation_settings`, `generation_usage`, `enforce_generation_limits` |
| `usage_limits_stats.sql`, `usage_stats_v2.sql`, `usage_stats_v3.sql` | блокировка генерации и статистика |
| `owner_history.sql` | главный админ, история партий |
| `cluster_batches.sql` | кластерные партии видит только owner |
| `site_releases.sql` | «Что нового», `my_rank`, `add_site_release` |
| `fix_release_dates_and_missing.sql` | исправление дат и пропущенных релизов |
| `telegram_bot.sql` | привязка Telegram, сессии бота |
| `user_prefs.sql` | `user_prefs` |
| `game.sql`, `game_v2.sql` … `game_v6.sql` | «Своя игра» по версиям; все применены (v6 — 1 ноября 2026) |


## 6. Сайт

### 6.1 Вход и маршруты (`src/main.tsx`)

| Путь | Что рендерится | Обёртки |
|---|---|---|
| `/game` | `GameHost` (ведущий) | AuthProvider, lazy |
| `/game/screen/КОД` | `GameScreen` (проектор, без входа) | lazy |
| `/play`, `/play/КОД` | `GamePlay` (команда; без кода — ввод кода) | lazy |
| `/tg`, `/tg/*` | `TgApp` (Mini App, без Supabase Auth) | lazy |
| остальное | `App` + `ErrorToaster` | QueryClientProvider, AuthProvider |

- У `QueryClient` по умолчанию: `staleTime` 5 мин, `retry` 2, без повторной загрузки при фокусе окна.
- Ошибки запросов и мутаций идут в `notifyError`. Текст берётся из `meta.action`; `meta.success` даёт уведомление об успехе.
- Перед рендером `App` вызывается `prefetchOnStartup(queryClient)`. Если в браузере есть сессия, он сразу загружает код последней вкладки и список предметов.

### 6.2 `App.tsx`

- Состояния до вкладок:
  - пока идёт `isLoading` — спиннер;
  - без пользователя — `AuthModal`;
  - при `profile.must_change_password` — `ChangePasswordScreen`.
- `TabType` = questions | taxonomy | generator | saved_tickets | bulk_import | users | stats | trash | cluster | releases.
- Ограничения вкладок: admin — users, stats, trash; staff — taxonomy, bulk_import; owner — cluster. При недоступной вкладке открывается generator.
- Вкладки грузятся через `React.lazy`. Последняя вкладка хранится в `localStorage.examiner_active_tab`.
- Форма вопроса (`QuestionForm`) открывается поверх вкладки. Перед закрытием `App` спрашивает о несохранённых изменениях.
- «Своя игра» открывается в новом окне `/game`.

### 6.3 Компоненты: данные и состояние

Сокращения: Т — таблицы, RPC — функции БД, EF — Edge Functions, QK — ключи react-query, LS — localStorage.

| Файл | Что делает | Данные |
|---|---|---|
| `TicketGenerator.tsx` | Генератор: предмет, главы и темы (режим «весь предмет» или «выбор»), состав со стандартом по предмету, число вариантов, перемешивание, название (авто или своё), лимиты и обратный отсчёт, генерация, скачивание (`DownloadButton`), «В Telegram», последние наборы | Т chapters, generation_usage, ticket_batches · RPC question_counts, save_ticket_batch · QK subjects, topics_for_generation, question_counts, generation_usage_today, recent_batches, chapters · LS `examiner_tg_*` (выбор и состав), `examiner_intro_done` |
| `QuestionList.tsx` | Банк вопросов: фильтры (предмет, глава, тема, тип, поиск, проблемы), страницы на сервере (`range`), сортировка по `num` в теме, мягкое удаление с отменой (`withUndo`), связи вопросов | Т questions, subjects, chapters, topics · QK questions, question-links, question_counts · LS `examiner_ql_*` |
| `QuestionForm.tsx` | Создание и правка вопроса RU/TG, картинки (в том числе вставка из буфера), черновик нового вопроса, оптимистическая блокировка по `version` | Т questions, question_options, matching_items, справочники · Storage question-images · LS `examiner_last_new_*` |
| `BulkImport.tsx` | Импорт из .docx (картинки внутри), пары файлов RU+TG, .xlsx/.xls, .csv, текста; предпросмотр, защита от дублей в теме, шаблон Excel, откат партии | Т questions, question_options, matching_items, import_batches, справочники · LS `examiner_import_*` |
| `SavedTicketsView.tsx` | Архив наборов: страницы, фильтр по предмету, поиск, повтор, скачивание, удаление с отменой; кластерные книжки (owner) | Т ticket_batches, tickets, subjects · QK saved_ticket_batches, recent_batches · LS `examiner_archive_subject` |
| `TaxonomyManager.tsx` | Предметы, главы, темы, источники: добавление, удаление (каскадно мягко удаляет вопросы) | Т subjects, chapters, topics, sources, questions · сбрасывает QK chapters, topics, topics_for_generation, question_counts, questions |
| `ClusterExam.tsx` | Экзамен-кластер (owner): 4 предмета, лёгкий пул и догрузка выбранных, режим без повторов прошлых экзаменов, сохранение партией `source='cluster'`, ZIP книжек RU и TJ с ключами | Т questions, subjects, chapters, topics, user_prefs · QK cluster_topics, saved_ticket_batches |
| `UserManagementView.tsx` | Пользователи: создание, правка, удаление, роль, предметы; журнал аудита | Т profiles, user_subjects, subjects, audit_logs · EF admin-create-user, admin-update-user, admin-delete-user · QK admin_* |
| `StatsView.tsx` | Статистика за период (без админов), правка лимитов | RPC admin_usage_stats_v3 (запасной — admin_usage_stats) · Т generation_settings · LS `examiner_stats_*` |
| `TrashView.tsx` | Корзина: удалённые вопросы, кто удалил, восстановление | Т questions, profiles · QK trash |
| `ReleasesView.tsx` | История «Что нового»; owner добавляет и правит записи | Т site_releases, site_release_items, subjects |
| `WhatsNewModal.tsx`, `ReleaseCard.tsx` | Окно непрочитанных версий; карточка версии | через `useReleases` |
| `TelegramLink.tsx` | Привязка Telegram: код и ссылка `t.me/<бот>?start=КОД`, отвязка | RPC create_telegram_link_code · Т telegram_links · EF send-to-telegram (`action: 'bot'` — имя бота) |
| `SendToTelegramButton.tsx` | Отправка готового файла в свой Telegram | EF send-to-telegram |
| `DownloadButton.tsx` | Кнопка «Скачать · язык» (ru, tg, both); язык запоминается | LS |
| `AuthModal.tsx`, `ChangePasswordScreen.tsx` | Вход (email и пароль), обязательная смена пароля | Auth · LS `examiner_last_email` |
| `ErrorToaster.tsx` | Уведомления по событиям `app:error`, `app:success`, `app:info`, `app:undo` | `lib/errors.ts` |
| `FormulaEditor.tsx` | Показ и ввод текста с sub, sup и дробями (`FormattedText`) | `lib/fractions.ts` |

Хуки:
- `useAuth()` возвращает `{user, profile, session, isLoading, isAdmin, isOwner, isStaff, subjectIds, canManage, signIn, signUp, signOut, refreshProfile}`. Профиль и `user_subjects` читаются одновременно. События `INITIAL_SESSION` и `TOKEN_REFRESHED` (для того же пользователя) профиль не перечитывают.
- `useReleases()` возвращает `{releases, unread, rank, isLoading, markRead}`.

## 7. Модули `src/lib`

| Модуль | Основные экспорты | Назначение |
|---|---|---|
| `supabase.ts` | `supabase`, `isSupabaseConfigured` | клиент |
| `docxExport.ts` | `buildTicketsFile(title, tickets, subject, lang, extraFiles?)`, `buildSingleTicketBlob`, `buildSingleTicketFile`, `exportTicketsToDocx`, `exportSingleTicketDocx`, `createQuestionTable`, `parseFormattedTextRuns`, `estimateQuestionHeightPt` | Word с билетами: шрифт 14 pt, вопрос не рвётся между страницами, RU, TG или оба языка (ZIP). **Копируется в `_shared`** |
| `answerKey.ts` | `keyKindOf`, `buildAnswerKeyDocx(template, tickets, info)`, `buildUniversalKeyDocx`, `testAnswer`, `matchingAnswer`, `openAnswer`, `selectionInfo`, `selectionChips`, `numberList` | Ключи по Word-шаблону; универсальная таблица, если состав не помещается. **Копируется в `_shared`** |
| `answerKeyExport.ts` | `buildAnswerKeyFile`, `exportAnswerKey`, `keyArchiveExtras`, `withSelectionInfo`, `describeSelection`, `makeSelectionInfoLoader`, `hasKeyTemplate` | Скачивание ключей: шаблон из `/key-templates`, `enrich` догружает верные ответы для старых снимков |
| `exportLazy.ts` | ленивые обёртки над двумя модулями выше, `warmKeyModule`, `hasKeyTemplate` (regex) | docx и jszip грузятся только при скачивании |
| `clusterExport.ts` | `buildClusterVariantBlob`, `buildClusterZip`, `instructionIntro` | книжка кластера по образцу, картинки из `cluster-assets` |
| `clusterSlots.ts` | `CLUSTER_SLOTS`, типы | предметы кластера и их состав (лёгкий модуль) |
| `clusterStore.ts` | `saveClusterBatch`, `clusterVariantsFromBatch`, `loadUsedQuestionIds`, `isClusterBatch` | хранение кластера как партии |
| `docxParse.ts` / `docxImport.ts` / `docxPair.ts` | `parseDocumentXml`, `cleanXmlRunsToFormattedText` / `parseDocxFile` / `pairBilingual`, `pairOptions` | разбор Word при импорте, пары RU+TG |
| `fractions.ts` | `splitFractions`, `tokenizeFormatted`, `hasFraction` | дроби и разметка b, i, u, sub, sup. **Копируется в `_shared`** |
| `errors.ts` | `explainError`, `notifyError`, `notifySuccess`, `notifyInfo`, `withUndo`, `must`, `assertRowsChanged`, `describeError`, `authErrorText`, `passwordErrorText` | понятные ошибки и уведомления |
| `generationLimits.ts` | `useGenerationSettings`, `useUserLimits`, `DEFAULT_GENERATION_SETTINGS`, `formatCooldown` | лимиты обычного пользователя |
| `startupPrefetch.ts` | `fetchSubjects`, `prefetchOnStartup` | предзагрузка при старте |
| `fetchAllPages.ts` | `fetchAllPages(build)` | чтение больше 1000 строк страницами, 4 параллельно |
| `batchTitle.ts` | `autoBatchTitle(subject, chapterNums)`, `compressRanges`, `DEFAULT_BATCH_TITLE` | «Химия — гл. 1–3, 5 — 26.10» |
| `questionIssues.ts` | `questionIssues`, `ISSUE_LABELS`, `matchesIssueFilter`, `STD` | проверка вопроса: тест — 4 варианта и 1 верный, соответствие — 4 слева и 5 справа |
| `releases.ts` | `rankOf`, `visibleReleases`, `unreadReleases`, `compareSemver` | логика «Что нового» |
| `imageCompression.ts` | `compressImage`, `uploadQuestionImage` | сжатие и загрузка в `question-images` |
| `passwordRules.ts` | `passwordChecks`, `passwordOk`, `PASSWORD_MIN` = 9 | требования к паролю |
| `utils.ts` | `cn` | классы Tailwind |

## 8. Edge Functions

Все функции работают с `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`, их Supabase задаёт сам.

| Функция | Вход и проверка | Что делает | Секреты |
|---|---|---|---|
| `telegram-bot` | вебхук Telegram, `--no-verify-jwt`, заголовок `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET` | диалог бота (ниже) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` |
| `tg-app` | `POST {action, …}`, заголовок `X-Tg-Init-Data` (подпись по токену бота), `--no-verify-jwt` | действия `me` → `{name, subjects, limits}`, `history` (8 последних наборов без кластерных), `tree` (главы и темы со счётчиками; проверка назначенных предметов), `generate`, `resend`; файл присылает бот | `TELEGRAM_BOT_TOKEN` |
| `send-to-telegram` | JWT пользователя | принимает собранный браузером файл и шлёт его в `chat_id` из `telegram_links`; `{action:'bot'}` отдаёт имя бота | `TELEGRAM_BOT_TOKEN` |
| `admin-create-user` | JWT админа | пишет `account_invites`, создаёт пользователя с паролем, ставит `must_change_password` | — |
| `admin-update-user` | JWT админа | имя, email, пароль; owner правит всех, админ — себя и не-админов | — |
| `admin-delete-user` | JWT owner | удаляет аккаунт; вопросы и билеты остаются | — |

**Бот** (`telegram-bot/index.ts`):
- Состояние лежит в `telegram_sessions.state`. Шаги: `subject` → `chapters` → `topics` → `settings` → `lang`.
- Префиксы `callback_data`:
  - `ACT:QUICK`, `ACT:HISTORY`, `ACT:UNLINK` — действия;
  - `Q:PRE:<тип>:<предмет>`, `Q:RUN:<тип>:<предмет>:<n>`, `Q:REC:<набор>` — быстрый билет;
  - `RESEND:<набор>` — повторная отправка;
  - `S:<i>` — выбор предмета;
  - `C:<i>`, `CA`, `CR`, `CN` — главы;
  - `T:<i>`, `TX`, `TB`, `TN`, `BT` — темы;
  - `V:` — настройки;
  - `L:` — язык и запуск.
- Команда `/start КОД` привязывает аккаунт.
- Генерация идёт через `_shared/generate.ts` с живым прогрессом в сообщении (`runWithLiveProgress`).
- `countPool` считает вопросы тремя запросами `count: 'exact', head: true`.

**Mini App** (`src/tg/TgApp.tsx`):
- Скрипт Telegram подгружается динамически (`loadTelegramScript`).
- Все данные идут через `api(action)` → `/functions/v1/tg-app`.
- Дерево предмета кэшируется на сессию (`treeCache`).
- Настройки хранятся в CloudStorage Telegram, запасной вариант — localStorage.
- Навигация через MainButton и BackButton Telegram.

## 9. Общий код `supabase/functions/_shared`

Модули без импортов (`ticketing.ts`, `pool.ts`) сайт подключает напрямую: `import … from '../../supabase/functions/_shared/ticketing'`. В остальных модулях `_shared` импорты пишутся для Deno, с `.ts` и `npm:`.

- `ticketing.ts` — чистая логика подбора, без зависимостей:
  - типы и лимиты: `Settings`, `DEFAULT_SETTINGS`, `LIMITS {perType 100, tickets 20}`, `TG_LIMITS {perType 50, tickets 4, total 50, perDay 5}`;
  - проверки: `checkSettings`, `fitSettings` (урезает состав до наличия), `poolStats`;
  - подбор: `pickParallel` (основной и запасной режимы, `LARGE_CHAPTER` = 100), `separateLinked`, `pickTickets`;
  - снимки: `snapshotTickets`, `buildTickets`, `toSnapshot` (с перемешиванием);
  - охват глав: `chapterTotalsFromCounts`, `totalsOf`;
  - для кластера: `preferUnused`;
  - экраны бота: `kb*`, `*Text`, `parseCount`, `parseNumbers`, `toggle`, `safeFileName`.
- `pool.ts`: `loadLightPool(sb, {subjectId, chapterIds, topicIds})` (поля `POOL_SELECT`; фильтр — темы, иначе главы, иначе весь предмет), `hydrateTickets(sb, kinds)` (полные строки `QUESTION_FULL_SELECT` только выбранных, по 100 id, параллельно).
- `generate.ts` (бот и Mini App):
  - пользователь и лимиты: `linkedUser`, `allowedSubjectIds`, `limitsFor`, `userMessage`;
  - пул: `loadPool` (без выбора — пусто), `loadQuestionCounts`, `loadChapterTotals`;
  - генерация: `generateAndSend` (блокировка → лёгкий пул и счётчики → `pickTickets` → `hydrateTickets` → `save_ticket_batch` → `deliverBatch` вместе с `audit_logs`);
  - отправка: `deliverBatch` (Word по вариантам, ключи из `KEY_TEMPLATES`, ZIP или один файл, `sendDocument`), `resendBatch`.
- `docxExport.ts`, `answerKey.ts`, `fractions.ts` — **автогенерация** из `src/lib` (`node scripts/sync-docx-shared.mjs`), руками не править.
- `keyTemplates.ts` — **автогенерация** (`node scripts/build-key-templates.mjs`): base64 шаблонов из `templates/key`.

## 10. Потоки

**Создание билетов на сайте** (`TicketGenerator.handleGenerate`):
1. Проверка `checkSettings` по лимитам: обычный пользователь — `useUserLimits`, админ — `LIMITS` с 50 вариантами.
2. Параллельно: `loadLightPool` и `question_counts` (из кэша, если он моложе 60 с).
3. `fitSettings` по реальному пулу: если вопросов мало, показывается уведомление.
4. `chapterTotalsFromCounts`, затем `pickTickets`. Позиция j во всех билетах берётся из одной темы, соседними вопросами сборника. Главы делят позиции по охвату, вопросы не повторяются, пока хватает. Связанные вопросы разводятся по разным билетам.
5. `hydrateTickets` → `snapshotTickets` (перемешивание вариантов и правой колонки).
6. Название: своё или `autoBatchTitle`.
7. `rpc('save_ticket_batch')`. Триггер проверяет лимиты; при ошибке откатывается всё.
8. `withSelectionInfo` + `describeSelection` по уже загруженной структуре; набор сохраняется в `localStorage.examiner_tg_generated_batch`.
9. Сброс кэша `saved_ticket_batches`, `recent_batches`, `generation_usage_today`.

**Бот и Mini App:** тот же подбор в `_shared/generate.ts`. Добавляются `acquire_generation_lock` (180 с), проверка назначенных предметов, дневной лимит по `generation_usage`. Файл присылает бот.

**Скачивание:** `exportLazy.buildTicketsFile` (docx; для `both` — ZIP с папками «Русский» и «Тоҷикӣ»). Если у предмета есть шаблон, в ZIP добавляются ключи (`keyArchiveExtras`). Шаблоны: chem, phys, bio, taj (по названию предмета), taj-cluster.

**Правка вопроса** (`QuestionForm`):
1. Вставить новые варианты.
2. Обновить вопрос с условием `.eq('version', старая)`. Если строк 0, значит кто-то правил параллельно, будет ошибка.
3. Удалить старые варианты.

Новый вопрос вставляется с `version: 1`.

**Удаление:**
- Вопрос: `withUndo`. Строка сразу скрывается в интерфейсе, `update is_deleted = true` уходит через 5 с, если не нажали «Отменить». Триггер пишет `deleted_by`.
- Наборы удаляются так же, но физически.
- Глава или тема в `TaxonomyManager` мягко удаляет и свои вопросы.

**Импорт** (`BulkImport`):
1. Разбор файла в браузере.
2. Предпросмотр и назначение предмета, главы и темы.
3. Создаётся `import_batches`.
4. Каждая строка сохраняется отдельно, дубли в теме пропускаются.
5. Картинки загружаются в Storage только на этапе сохранения.

**Привязка Telegram:** `create_telegram_link_code()` → ссылка `t.me/<бот>?start=КОД` → бот записывает `telegram_links(chat_id, user_id)`.

**Новый пользователь:** `admin-create-user` → приглашение → `auth.users` → `handle_new_user` создаёт профиль → первый вход → `ChangePasswordScreen`.

**«Что нового»:**
1. Файл `releases/*.sql` → `add_site_release`.
2. `useReleases` читает версии, видимые по рангу.
3. Непрочитанные показывает `WhatsNewModal`.
4. Закрытие окна пишет `site_release_reads`.

**Своя игра:**
1. Ведущий (`GameHost`, только owner) вызывает `game_create`.
2. Пакет вопросов берётся из `game_packs`.
3. Ведущий пишет `game_sessions.board` (табло, таймер, счёт).
4. Все экраны подписаны на Realtime: канал `game-<код>-<случайный суффикс>`, `postgres_changes` по `game_sessions` с фильтром `code=eq.<код>` (`useGameSession` в `src/game/api.ts`).
5. Команды (`GamePlay`) входят через `game_join`, `game_rejoin` (ПИН) и отвечают через `game_buzz`, `game_team_act` с секретом из `game_secrets`.
6. Время синхронизируется через `game_time` (`useServerClock`).
7. Итоги и разбор попадают в `game_results`; выгрузка в Excel — `review.ts`.

## 11. Кэш react-query

| Ключ | Где читается | staleTime | Кто сбрасывает |
|---|---|---|---|
| `['subjects']` | Generator, QuestionList, BulkImport, предзагрузка | 5 мин | TaxonomyManager |
| `['topics_for_generation', subjectId]` | Generator (главы с темами одним запросом) | 60 с | TaxonomyManager (добавление и удаление глав и тем) |
| `['chapters', subjectId]`, `['topics', chapterId]` | QuestionList, QuestionForm, TaxonomyManager, Cluster | 5 мин | TaxonomyManager |
| `['question_counts', subjectId]` | Generator | 30 с (при генерации 60 с) | QuestionForm, QuestionList, BulkImport, TrashView, TaxonomyManager |
| `['questions', …]` | QuestionList | 5 мин | те же, что выше |
| `['recent_batches', userId]`, `['saved_ticket_batches', …]` | Generator, SavedTickets | 5 мин | после генерации и удаления |
| `['generation_usage_today', …]` | Generator | 0 | после генерации |
| `['generation_settings']` | лимиты | 60 с | StatsView |
| `['site-releases', userId]`, `['site-release-reads', userId]` | useReleases | 5 мин | ReleasesView, markRead |

Добавляете запись данных — добавьте сброс всех ключей, которые эти данные показывают.

## 12. Лимиты генерации

| Кто | Вариантов | Вопросов вида / всего | В сутки | Пауза |
|---|---|---|---|---|
| Админ на сайте | 50 | 100 / — | без лимита | нет |
| Админ в боте и Mini App | 20 | 100 / — | без лимита | нет |
| Остальные (сайт, бот, Mini App) | `generation_settings.max_tickets` (4) | 50 / `max_per_ticket` (50) | `per_day` (5) | `cooldown_seconds` (60 с) |

- Проверяют лимиты в трёх местах:
  - интерфейс: `checkSettings`, счётчик «осталось сегодня», таймер паузы;
  - Edge Functions: `limitsFor`, `dailyLimitError`;
  - база, окончательно: триггер `enforce_generation_limits` на `ticket_batches`.
- Сутки считаются по Душанбе (UTC+5). Удалённые наборы тоже входят в счёт.

## 13. Разработка, проверки, выпуск

- Запуск: `npm install`, `npm run dev` (порт 5173; конфиг `.claude/launch.json`, имя `dev`).
- Проверки:
  - `npx tsc -b` и `npx vitest run` — перед каждым коммитом;
  - `npm run build` — тесты, типы и сборка вместе.
- `.env` в git не хранится, переменные — в `.env.example`:
  - сайт: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TELEGRAM_BOT_USERNAME`, `VITE_SUPPORT_TELEGRAM` (необязательно);
  - скрипты импорта: `IMPORT_ADMIN_*`.
- **Версия и «Что нового»** (правила — в `CLAUDE.md`):
  1. `git fetch`.
  2. Взять следующий номер после последнего файла в `supabase/sql/releases/` на `origin/main`.
  3. Поднять версию в `package.json` и в двух первых `"version"` в `package-lock.json`.
  4. Создать `supabase/sql/releases/ГГГГ-ММ-ДД_<версия>.sql`.
  5. Пункты с `min_rank` и `kind` писать одной понятной фразой.
- **SQL:** `npx supabase db query --linked -f supabase/sql/<файл>.sql` (проект привязан), либо SQL Editor. Политики и функции пишите идемпотентно (`create or replace`, `drop policy if exists`).
- **Edge Functions:** `npx supabase functions deploy <имя> --project-ref ovxrgkyexuudgtqglegk` (`telegram-bot` и `tg-app` с `--no-verify-jwt`).
  - **Любая правка `_shared/*` требует передеплоя `telegram-bot` и `tg-app`.** `send-to-telegram` и `admin-*` от `_shared` не зависят.
  - Перед деплоем сделайте `git pull`: деплой из устаревшей копии затирает чужие правки в продакшене.
- **Сайт:** `git push` в `main` → Vercel.
- Деплой в продакшен, применение SQL и пуш делает пользователь или подтверждает явно.
- **CSP** (`vercel.json`) запрещает встроенные скрипты и обработчики вроде `onload=`. Скрипты разрешены только свои и с `telegram.org`, стили и шрифты — с Google Fonts, запросы — только к Supabase проекта. Новый внешний домен нужно добавить в CSP, иначе он не загрузится.

## 14. Тесты (`tests/`)

| Файл | Что проверяет |
|---|---|
| `ticketing.test.ts` | подбор (`pickParallel`, охват глав, запасной режим, связанные вопросы), `fitSettings`, `toSnapshot`, сборка Word, перенос строк, ленивые обёртки |
| `pool.test.ts` | лёгкий пул (страницы, только лёгкие поля), подбор по лёгкому пулу совпадает с подбором по полному, догрузка пачками, ошибка при пропавшем вопросе |
| `answerKey.test.ts` | ответы в ключах, шаблоны, универсальная таблица, `selectionInfo` |
| `cluster.test.ts` | книжка кластера |
| `game.test.ts` | очередь нажатий по номеру вопроса, действия команд («кот», ставки), места |
| `releases.test.ts`, `batchTitle.test.ts`, `errors.test.ts`, `passwordRules.test.ts`, `fetchAllPages.test.ts`, `spacing.test.ts` | соответствующие модули |

Тесты не обращаются к базе: клиент Supabase подменяется заглушкой (пример — `fakeClient` в `pool.test.ts`).

## 15. Ловушки

- Supabase отдаёт максимум 1000 строк за запрос: большие выборки читайте страницами (`fetchAllPages`, `loadLightPool`) с `.order('id')`.
- `.in('id', [...])` идёт в URL: держите не больше ~100 uuid за запрос.
- Мягкое удаление: почти везде нужен `.eq('is_deleted', false)`. Для вложенных тем — `.eq('topics.is_deleted', false)`.
- Снимок вопроса в билете не меняется при правке банка. Старые снимки без `is_correct` и `correct_match_id` дополняет `enrich`.
- Кластерные партии (`source='cluster'`) скрывает RLS; фильтровать их в коде отдельно не нужно.
- Порядок вопросов в теме: `num`, затем `seq`, `created_at`, `id` (`compareInTopic`). Не сортируйте только по дате.
- Каждый последовательный запрос к базе в Сеуле заметно задерживает отклик. Независимые запросы делайте через `Promise.all`; главы и темы читайте одним вложенным `select`.
- Сборка Word идёт в основном потоке: 4 варианта ≈ 0,3 с, 20 RU+TJ ≈ 2 с, 50 RU+TJ ≈ 4,5 с.
- Внутри `onAuthStateChange` не делайте долгих цепочек запросов: колбэк держит блокировку сессии supabase-js.
- Путь проекта на кириллице («генератор тестов»): в командах берите его в кавычки. Git предупреждает о CRLF, это нормально.
