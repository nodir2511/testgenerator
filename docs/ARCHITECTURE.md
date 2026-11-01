# Схема проекта (для быстрой ориентации)

Актуально на версию 0.28.3. Цель файла: не перечитывать весь код. Перед работой прочитайте нужный раздел, затем открывайте только указанные файлы.
Если вы меняете структуру (новая таблица, новый модуль, новый поток данных), обновите этот файл в том же коммите.

## 1. Что это
Сайт для преподавателей: банк вопросов по предметам (тест, соответствие, открытый; русский и таджикский), сборка экзаменационных билетов, выдача в Word + ключи ответов. Те же билеты собираются через Telegram-бота и Mini App. Для главного админа: экзамен-кластер (книжка из 4 предметов) и «Своя игра».

Стек: React 19 + TypeScript + Vite + Tailwind, TanStack Query, Supabase (Postgres + Auth + Edge Functions на Deno). Хостинг сайта: Vercel (автодеплой при пуше в `main`). Репозиторий: github.com/nodir2511/testgenerator.
Supabase-проект: ref `ovxrgkyexuudgtqglegk` (регион ap-northeast-2, Сеул: каждый последовательный запрос заметен, избегайте цепочек).

## 2. Карта каталогов
```
index.html, vite.config.ts, vercel.json   Вход, сборка (manualChunks), заголовки (CSP, кэш), rewrites для /tg /game /play
public/                  favicon, font-loader.js, key-templates/*.docx (шаблоны ключей), cluster-assets/*.png (обложка кластера)
src/main.tsx             Выбор режима по адресу: сайт / /tg (Mini App) / /game, /play (игра); QueryClient; предзагрузка
src/App.tsx              Шапка, вкладки (lazy), навигация, окно «Что нового»; вкладка хранится в localStorage examiner_active_tab
src/components/          Экраны (раздел 5)
src/lib/                 Логика без UI: Word, ключи, разбор docx, ошибки, кэш-хелперы (раздел 6)
src/hooks/               useAuth (сессия, профиль, роли), useReleases
src/game/                «Своя игра» (ведущий /game, экран /game/screen/КОД, команда /play/КОД)
src/tg/                  Telegram Mini App (/tg), данные только через Edge Function tg-app
src/types/database.ts    Типы таблиц, роли (ROLE_LABELS)
supabase/functions/      Edge Functions + _shared (раздел 7)
supabase/sql/            SQL базы: схема, политики, функции; releases/ — записи «Что нового»
templates/key/           Исходники шаблонов ключей (.docx), собираются скриптом в public/ и _shared
scripts/                 sync-docx-shared.mjs, build-key-templates.mjs
tests/                   vitest (ticketing, pool, answerKey, cluster, game, releases, errors, …)
scratch/                 Рабочие скрипты и подборки вопросов, в git не попадает
.github/workflows/       backup.yml — копия базы на Google Диск (запуск вручную)
```

## 3. Роли и доступ
`profiles.role`: `user` (преподаватель), `subject_teacher`, `subject_admin`, `admin`; `profiles.is_owner` = главный админ (admin + owner).
Ранг для «Что нового» (`my_rank()`): 1 все, 2 админ по предметам и выше, 3 админы и выше, 4 только главный.
В `useAuth`: `isAdmin` (role=admin), `isOwner`, `isStaff` (admin или subject_admin), `subjectIds` (назначенные предметы для ролей «по предметам», таблица `user_subjects`), `canManage(subjectId)`.
Доступ к вкладкам: `taxonomy`, `bulk_import` — staff; `users`, `stats` — admin; `cluster`, игра — owner. Реальная защита всегда в RLS, не в интерфейсе.
Регистрация закрыта; пользователей создают админы (Edge Functions admin-*). `must_change_password`: после выдачи пароля админом экран `ChangePasswordScreen` блокирует сайт до смены.

## 4. Модель данных (таблицы public)
- Справочники: `subjects`, `chapters(subject_id, order_index)`, `topics(chapter_id, order_index)`, `sources`; у всех `is_deleted` (мягкое удаление).
- Вопросы: `questions` (subject_id, chapter_id, topic_id, type test|matching|open, content/content_ru/content_tg, image_url, correct_numeric_answer, num — номер в теме, seq — порядок вставки, linked_ids uuid[] — связанные вопросы, is_deleted/deleted_by, batch_id импорта), `question_options` (is_correct, text_ru/text_tg), `matching_items` (side left|right, correct_match_id).
- Билеты: `ticket_batches` (title, subject_id, created_by, generation_params jsonb: chapter_ids, topic_ids, test/matching/open_count, ticket_count, shuffle_*, requested, source site|telegram|telegram-app|cluster, auto_title), `tickets` (batch_id, ticket_number), `ticket_questions` (order_index, question_snapshot jsonb — снимок вопроса на момент генерации, не зависит от правок банка).
- Лимиты и учёт: `generation_settings` (одна строка: per_day, cooldown_seconds, max_tickets, max_per_ticket), `generation_usage`, `generation_locks`, `audit_logs`, `import_batches`.
- Обновления: `site_releases`, `site_release_items(min_rank, kind new|fixed|improved, subject_id)`, `site_release_reads`.
- Telegram: `telegram_links(chat_id, user_id)`, `telegram_link_codes`, `telegram_sessions`. Прочее: `user_prefs`, `account_invites`.
- Игра: `game_sessions`, `game_secrets`, `game_bids`, `game_packs`, `game_results` (+ функции `game_*`).
Ключевые функции БД: `question_counts(subject_id)` (счётчики по главам/темам/видам одним запросом), `save_ticket_batch(batch, tickets)` (партия + билеты + вопросы одной транзакцией; триггеры проверяют лимиты), `admin_usage_stats_v3`, `add_site_release`, `acquire_generation_lock`, `is_admin/is_owner/is_staff/my_rank`, `can_view_subject/can_manage_subject`, `auth_role/auth_subject_ids` (быстрые проверки для RLS).
RLS включён везде; политики используют `(select auth.uid())`. SQL лежит в `supabase/sql/*.sql` (схема: supabase_schema.sql, дальше по темам; применяется вручную, см. раздел 9).

## 5. Экраны (src/components)
| Файл | Назначение |
|---|---|
| TicketGenerator | Генератор билетов: предмет, главы/темы, состав, лимиты, генерация, скачивание, «повторить набор» |
| QuestionList / QuestionForm | Банк вопросов (поиск, фильтры, постранично) / создание и правка вопроса |
| BulkImport | Массовый импорт из Word/Excel (разбор — lib/docxParse, docxPair, docxImport) |
| SavedTicketsView | Архив наборов, повтор, скачивание, удаление с отменой |
| TaxonomyManager | Предметы, главы, темы, источники |
| ClusterExam | Экзамен-кластер (owner) |
| UserManagementView, StatsView | Пользователи и аудит; статистика и лимиты (admin) |
| TrashView | Корзина вопросов |
| ReleasesView, ReleaseCard, WhatsNewModal | История обновлений и окно новинок |
| AuthModal, ChangePasswordScreen, TelegramLink, SendToTelegramButton, DownloadButton, ErrorToaster, FormulaEditor | Вход, смена пароля, привязка Telegram, отправка файла, кнопка скачивания, уведомления, формулы |

## 6. Библиотеки (src/lib)
- `docxExport.ts` — Word с билетами (docx). Копируется в `supabase/functions/_shared/docxExport.ts` скриптом (см. раздел 8).
- `answerKey.ts` / `answerKeyExport.ts` — ключи ответов по шаблонам; export: загрузка шаблона, `describeSelection` (шапка «какие главы вошли»), `enrich` (допогрузка верных ответов для старых снимков).
- `exportLazy.ts` — ленивые обёртки (docx и jszip грузятся только при скачивании); `warmKeyModule` прогревает модуль.
- `clusterExport/clusterSlots/clusterStore` — книжка кластера (4 предмета, `cluster_slot` в снимках, source='cluster').
- `fractions.ts` — вертикальные дроби и sub/sup (экран и Word). `questionIssues.ts` — проверка качества вопроса. `batchTitle.ts` — автоназвание набора.
- `errors.ts` — понятные тексты ошибок, `notifyError/notifySuccess/notifyInfo`. `generationLimits.ts` — лимиты для обычных пользователей.
- `startupPrefetch.ts` — `fetchSubjects`, предзагрузка первой вкладки и предметов при старте. `fetchAllPages.ts` — постраничное чтение (1000 строк).
- `releases.ts` — ранги и сравнение версий. `imageCompression.ts`, `passwordRules.ts`, `supabase.ts` (клиент), `utils.ts`.

## 7. Серверная часть (supabase/functions)
- `telegram-bot` — бот: меню выбора предмета/глав/тем, настройки, генерация, привязка аккаунта. `tg-app` — бэкенд Mini App (подпись initData, действия через `body.action`). `send-to-telegram` — кнопка «В Telegram» на сайте (отправляет готовый файл). `admin-create-user/-update-user/-delete-user` — управление аккаунтами.
- `_shared/`: `ticketing.ts` (чистая логика подбора: `pickParallel`, `pickTickets`, `snapshotTickets`, `buildTickets`, `separateLinked`, `fitSettings`, `toSnapshot`, лимиты; используется и сайтом), `pool.ts` (`loadLightPool` + `hydrateTickets`; используется и сайтом), `generate.ts` (генерация и отправка в Telegram: лимиты, блокировка, сборка Word/ZIP, ключи), `docxExport.ts`/`answerKey.ts`/`fractions.ts` (АВТОГЕНЕРАЦИЯ, не править), `keyTemplates.ts` (автогенерация из templates/key).
Сайт импортирует `supabase/functions/_shared/ticketing` и `pool` напрямую (в них нет импортов, работают и в браузере, и в Deno). В `_shared` для Deno импорты пишутся с `.ts`.

## 8. Главные потоки
**Создание билетов (сайт, TicketGenerator.handleGenerate):** лёгкий пул `loadLightPool` (только поля для подбора) параллельно со счётчиками `question_counts` (из кэша react-query до минуты) → `fitSettings` → `pickTickets` (темы поровну, соседние вопросы сборника в одной позиции всех билетов, без повторов, развод связанных) → `hydrateTickets` (полные вопросы только выбранные) → `snapshotTickets` → RPC `save_ticket_batch` → описание выбора глав/тем из уже загруженной структуры → показ. Бот и Mini App идут тем же путём в `_shared/generate.ts`.
**Скачивание:** `exportLazy` → `docxExport` (билеты) + `answerKeyExport` (ключи), ZIP через jszip. Старые снимки без верных ответов дополняются из банка.
**Старт сайта:** `main.tsx` → `prefetchOnStartup` (код первой вкладки + предметы) параллельно с `useAuth` (профиль и user_subjects одновременно) → `App`.
**Кэш запросов (react-query):** ключи `subjects`, `topics_for_generation:<subject>` (главы + темы одним запросом, 1 мин), `question_counts:<subject>` (30 с), `questions`, `recent_batches`, `saved_ticket_batches`, `site-releases`. При правке вопросов инвалидируются `questions` и `question_counts`; при правке предметов/глав/тем — `topics_for_generation`, `chapters`, `topics`. Добавляя запись данных, добавьте и сброс кэша.
**Автогенерация общего кода:** после правок `src/lib/docxExport.ts`, `answerKey.ts`, `fractions.ts` запустите `node scripts/sync-docx-shared.mjs`; после правок шаблонов ключей — `node scripts/build-key-templates.mjs`.

## 9. Разработка, проверки, выпуск
- `npm run dev` (порт 5173), `npm test` (vitest), `npm run build` (тесты + `tsc -b` + vite build). Перед коммитом: `npx tsc -b` и `npx vitest run`.
- `.env` (в git нет): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TELEGRAM_BOT_USERNAME`; секреты бота и импорта хранятся в Supabase.
- Правила «Что нового» и версии: `CLAUDE.md`. Версию в `package.json` и `package-lock.json` (две строки) поднимать вместе с файлом `supabase/sql/releases/ГГГГ-ММ-ДД_<версия>.sql`. Перед выбором номера сделайте `git fetch` и посмотрите последние файлы в `releases/` и версию на `origin/main`: в `main` пушат параллельно, номера легко занять.
- SQL применяется вручную: `npx supabase db query --linked -f supabase/sql/<файл>.sql` (проект уже привязан). Политики и функции в SQL-файлах должны быть идемпотентны.
- Edge Functions: `npx supabase functions deploy <имя> --project-ref ovxrgkyexuudgtqglegk` (`telegram-bot` и `tg-app` с `--no-verify-jwt`). **Любая правка `_shared/*` требует передеплоя `telegram-bot` и `tg-app`**, иначе бот работает на старом коде. Перед деплоем сделайте `git pull`, чтобы не затереть чужие правки старой копией. Деплой в продакшен, применение SQL и пуш выполняет пользователь (или подтверждает явно).
- Сайт: `git push` в `main` → Vercel. CSP в `vercel.json` запрещает встроенные скрипты и обработчики (`onload=` и т. п.): внешние скрипты только из `public/` или с telegram.org; шрифты Google Fonts подключаются через `public/font-loader.js`.
- Тесты не ходят в базу: клиенты Supabase подменяются заглушками (пример: `tests/pool.test.ts`).

## 10. Известные особенности и ловушки
- Supabase отдаёт максимум 1000 строк за запрос: любое чтение большого набора идёт страницами (`fetchAllPages`, `loadLightPool`).
- Вопросы мягко удаляются (`is_deleted`), фильтруйте `.eq('is_deleted', false)`; RLS по ролям показывает удалённые только админам.
- Снимок вопроса в билете самодостаточен: правка банка не меняет уже созданные билеты.
- Билеты кластера (`source='cluster'`) видит только главный админ; обычные списки их скрывают (`is_cluster_batch` в RLS).
- Сборка Word идёт в основном потоке браузера: 20 билетов RU+TJ около 2 с, 50 около 4,5 с.
- Кириллица в путях: каталог проекта называется «генератор тестов»; в командах берите путь в кавычки.
