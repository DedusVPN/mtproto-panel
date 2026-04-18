#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "" ]]; then
  echo "Использование: $0 <пароль_администратора_панели>" >&2
  echo "Создаёт каталог secrets/ с panel_jwt_secret и panel_admin_password_hash (chmod 600)." >&2
  exit 2
fi
mkdir -p secrets
if command -v openssl >/dev/null 2>&1; then
  openssl rand -hex 32 | tr -d '\n' > secrets/panel_jwt_secret
else
  python - <<'PY' > secrets/panel_jwt_secret
import secrets
print(secrets.token_hex(32), end="")
PY
fi
python scripts/gen_panel_password_hash.py "$1" > secrets/panel_admin_password_hash
chmod 600 secrets/panel_jwt_secret secrets/panel_admin_password_hash
echo "Готово: secrets/panel_jwt_secret и secrets/panel_admin_password_hash"
