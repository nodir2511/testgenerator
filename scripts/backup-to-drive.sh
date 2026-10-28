#!/usr/bin/env bash
# Резервная копия базы Supabase -> Google Диск (запускается из .github/workflows/backup.yml).
# Нужны переменные: SUPABASE_DB_URL, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, GDRIVE_FOLDER_ID.
# Необязательно: BACKUP_PASSPHRASE (шифровать файл), KEEP_DAYS (сколько дней хранить, по умолчанию 30).
set -euo pipefail

: "${SUPABASE_DB_URL:?}" "${GDRIVE_CLIENT_ID:?}" "${GDRIVE_CLIENT_SECRET:?}" "${GDRIVE_REFRESH_TOKEN:?}" "${GDRIVE_FOLDER_ID:?}"
KEEP_DAYS="${KEEP_DAYS:-30}"
MIN_BYTES=$((2 * 1024 * 1024)) # меньше 2 МБ — что-то не так (база сейчас ~68 МБ, дамп ~10+ МБ)

stamp="$(date -u +%Y-%m-%d_%H%M)"
dump="examiner_${stamp}.dump"
file="$dump"

echo "Выгружаю базу…"
# Схемы приложения и аккаунтов; формат custom сжимает и позволяет восстанавливать выборочно
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges -Fc -n public -n auth -f "$dump"

size=$(stat -c %s "$dump")
echo "Размер дампа: $size байт"
if [ "$size" -lt "$MIN_BYTES" ]; then
  echo "Дамп подозрительно маленький (< 2 МБ), копия не сохраняется" >&2
  exit 1
fi
# Дамп должен читаться обратно: проверяем оглавление
pg_restore --list "$dump" > /dev/null

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$dump.gpg" "$dump"
  rm "$dump"
  file="$dump.gpg"
fi

echo "Получаю доступ к Google Диску…"
token=$(curl -fsS https://oauth2.googleapis.com/token \
  -d client_id="$GDRIVE_CLIENT_ID" -d client_secret="$GDRIVE_CLIENT_SECRET" \
  -d refresh_token="$GDRIVE_REFRESH_TOKEN" -d grant_type=refresh_token | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
auth="Authorization: Bearer $token"

echo "Загружаю $file на Диск…"
meta=$(printf '{"name":"%s","parents":["%s"]}' "$file" "$GDRIVE_FOLDER_ID")
resp=$(curl -fsS -X POST -H "$auth" \
  -F "metadata=$meta;type=application/json;charset=UTF-8" \
  -F "file=@$file;type=application/octet-stream" \
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size")
echo "Загружено: $resp"
id=$(echo "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
[ -n "$id" ]

echo "Удаляю копии старше $KEEP_DAYS дней…"
cutoff=$(date -u -d "-$KEEP_DAYS days" +%Y-%m-%dT%H:%M:%S)
q=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "'$GDRIVE_FOLDER_ID' in parents and trashed=false and createdTime < '$cutoff'")
old=$(curl -fsS -H "$auth" "https://www.googleapis.com/drive/v3/files?q=$q&fields=files(id,name)&pageSize=100")
echo "$old" | python3 -c 'import sys,json; [print(f["id"]) for f in json.load(sys.stdin).get("files",[])]' | while read -r fid; do
  [ -n "$fid" ] && curl -fsS -X DELETE -H "$auth" "https://www.googleapis.com/drive/v3/files/$fid" && echo "удалён $fid"
done
echo "Готово."
