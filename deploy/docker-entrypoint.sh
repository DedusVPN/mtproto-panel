#!/bin/sh
set -e
# /run/secrets/* — root:root 0400; panel не читает. Копируем в /tmp без chown (при cap_drop:ALL нет CAP_CHOWN):
# режим 0444 — только чтение, любой uid в контейнере может прочитать (секрет не покидает контейнер).
if [ -f /run/secrets/panel_jwt_secret ]; then
  install -m 0444 /run/secrets/panel_jwt_secret /tmp/panel_jwt_secret
  export PANEL_JWT_SECRET_FILE=/tmp/panel_jwt_secret
fi
if [ -f /run/secrets/panel_admin_password_hash ]; then
  install -m 0444 /run/secrets/panel_admin_password_hash /tmp/panel_admin_password_hash
  export PANEL_ADMIN_PASSWORD_HASH_FILE=/tmp/panel_admin_password_hash
fi
# Иначе у дочернего процесса остаётся HOME от root → expanduser("~") = /root/.ssh/…
export HOME=/home/panel
cd /app
if [ -n "${DATABASE_URL}" ]; then
  i=0
  ok=0
  while [ "$i" -lt 30 ]; do
    if /app/.venv/bin/alembic upgrade head; then
      ok=1
      break
    fi
    i=$((i + 1))
    sleep 2
  done
  if [ "$ok" != "1" ]; then
    echo "migrations: не удалось выполнить alembic upgrade head после $i попыток" >&2
    exit 1
  fi
  # Одноразовый перенос JSON из тома panel_data (/app/data) в PG, пока таблицы пусты
  /app/.venv/bin/python -m app.legacy_data_import
fi
exec setpriv --reuid=1000 --regid=1000 --init-groups -- \
  /app/.venv/bin/python -m uvicorn app.main:app \
  --host "${UVICORN_HOST:-0.0.0.0}" --port "${UVICORN_PORT:-8765}"
