#!/bin/sh
set -e
# Compose кладёт файлы в /run/secrets как root:root mode 0400 — пользователь panel не может их читать.
# Копируем во writable /tmp с владельцем panel (uid 1000), затем сбрасываем привилегии.
if [ -f /run/secrets/panel_jwt_secret ]; then
  install -o 1000 -g 1000 -m 0400 /run/secrets/panel_jwt_secret /tmp/panel_jwt_secret
  export PANEL_JWT_SECRET_FILE=/tmp/panel_jwt_secret
fi
if [ -f /run/secrets/panel_admin_password_hash ]; then
  install -o 1000 -g 1000 -m 0400 /run/secrets/panel_admin_password_hash /tmp/panel_admin_password_hash
  export PANEL_ADMIN_PASSWORD_HASH_FILE=/tmp/panel_admin_password_hash
fi
exec setpriv --reuid=1000 --regid=1000 --init-groups -- \
  /app/.venv/bin/python -m uvicorn app.main:app \
  --host "${UVICORN_HOST:-0.0.0.0}" --port "${UVICORN_PORT:-8765}"
