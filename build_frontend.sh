#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Синхронизируем лого из корня проекта в frontend/public/
if [ -f logo.svg ]; then
  mkdir -p frontend/public
  cp -f logo.svg frontend/public/logo.svg
fi

cd frontend
if [ ! -d node_modules ]; then
  echo "→ npm install…"
  npm install
fi
echo "→ npm run build…"
npm run build
echo "✓ Frontend собран в static/"
