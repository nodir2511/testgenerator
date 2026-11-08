#!/usr/bin/env bash
# Резервная копия базы Supabase -> личный чат в Telegram (запускается из .github/workflows/backup.yml).
# Нужны переменные: SUPABASE_DB_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_BACKUP_CHAT_ID, BACKUP_PASSPHRASE.
# Файл всегда шифруется (в дампе почты и хэши паролей, а Telegram не шифрует чаты сквозным способом).
# Бот отправляет файлы до 50 МБ, поэтому большой дамп режется на части по PART_MB (по умолчанию 45).
set -euo pipefail

: "${SUPABASE_DB_URL:?}" "${TELEGRAM_BOT_TOKEN:?}" "${TELEGRAM_BACKUP_CHAT_ID:?}" "${BACKUP_PASSPHRASE:?}"
PART_MB="${PART_MB:-45}"
MIN_BYTES=$((2 * 1024 * 1024)) # меньше 2 МБ — что-то не так (база сейчас ~73 МБ, дамп ~10+ МБ)

stamp="$(date -u +%Y-%m-%d_%H%M)"
dump="examiner_${stamp}.dump"
enc="$dump.gpg"

echo "Выгружаю базу…"
# Схемы приложения и аккаунтов; формат custom сжимает и позволяет восстанавливать выборочно
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges -Fc -n public -n auth -f "$dump"

size=$(stat -c %s "$dump")
echo "Размер дампа: $size байт"
if [ "$size" -lt "$MIN_BYTES" ]; then
  echo "Дамп подозрительно маленький (< 2 МБ), копия не отправляется" >&2
  exit 1
fi
# Дамп должен читаться обратно: проверяем оглавление
pg_restore --list "$dump" > /dev/null

gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$enc" "$dump"
rm "$dump"

# Части: examiner_..._.dump.gpg.part01, .part02 … (склеиваются командой cat)
if [ "$(stat -c %s "$enc")" -gt $((PART_MB * 1024 * 1024)) ]; then
  split -b "${PART_MB}M" -d "$enc" "$enc.part"
  rm "$enc"
  files=("$enc".part*)
else
  files=("$enc")
fi
echo "Файлов к отправке: ${#files[@]}"

api="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
n=0
for f in "${files[@]}"; do
  n=$((n + 1))
  caption="Резервная копия экзаменатора ${stamp} UTC (${n}/${#files[@]})"
  for attempt in 1 2 3; do
    resp=$(curl -sS -X POST "$api/sendDocument" -F "chat_id=${TELEGRAM_BACKUP_CHAT_ID}" -F "caption=${caption}" -F "document=@${f}" || true)
    if echo "$resp" | python3 -c 'import sys,json; sys.exit(0 if json.load(sys.stdin).get("ok") else 1)' 2>/dev/null; then
      echo "Отправлено: $f"
      break
    fi
    echo "Попытка $attempt не удалась" >&2
    [ "$attempt" -lt 3 ] && sleep $((attempt * 5))
    if [ "$attempt" -eq 3 ]; then
      # Токен в ответ не попадает; описание ошибки Telegram безопасно показать
      echo "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("description","нет ответа"))' >&2 || true
      exit 1
    fi
  done
done
echo "Готово."
