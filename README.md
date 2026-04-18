# free-tg-mtproxy

Панель развёртывания **Telemt** по SSH и блоки «Облако · VDSina» и **Cloudflare DNS** (сводка A и синхронизация с серверами панели).

Сценарий по умолчанию: **доступ по `http://IP:порт` без домена и SSL**. В `.env` должны быть **`PANEL_COOKIE_SECURE=false`** и **`PANEL_TRUST_FORWARDED_PROTO=false`**, иначе вход по cookie не заработает в браузере.

## Запуск (uv)

```bash
uv sync
# Поднимите PostgreSQL (например: docker compose up -d postgres) и задайте в .env:
#   DATABASE_URL=postgresql+asyncpg://panel:panel@127.0.0.1:5432/panel
uv run alembic upgrade head
# Слушает 0.0.0.0:8765 — откройте http://<IP_сервера>:8765 (ограничьте доступ файрволом / VPN).
uv run python -m uvicorn app.main:app --host "${PANEL_BIND_HOST:-0.0.0.0}" --port "${PANEL_BIND_PORT:-8765}"
```

Ручное слияние JSON в БД (upsert): `uv run python scripts/migrate_json_to_postgres.py`

**Docker:** том **`panel_data`** → `/app/data` (rw). У сервиса **panel** в compose **`cap_drop: ALL`** без **`CAP_DAC_OVERRIDE`**, поэтому процесс **root** в контейнере **не обходит** Unix‑права и **не читает** чужие файлы **`0600`** (старые JSON на томе принадлежат **uid 1000**). **`alembic`** и **`legacy_data_import`** в entrypoint запускаются от пользователя **panel (1000)** — как и **uvicorn**. Каталог legacy: **`LEGACY_DATA_DIR`**.

Обёртки: **`run_panel.sh`**, **`run_panel.cmd`** (те же переменные `PANEL_BIND_HOST` / `PANEL_BIND_PORT`).

Проверка auth: `uv run python scripts/verify_auth_integration.py --base http://127.0.0.1:8765`  
(если в `.env` случайно **`PANEL_COOKIE_SECURE=true`** при проверке по `http://`, скрипт подскажет отключить флаг.)

## Структура

| Путь | Назначение |
|------|------------|
| `src/app/` | код FastAPI-приложения |
| `static/` | веб-интерфейс панели |
| `data/` | опционально: старые JSON до миграции; приложение хранит состояние в PostgreSQL |
| `deploy/` | `Dockerfile`, `docker-entrypoint.sh`, `init_docker_secrets.sh` |
| `scripts/` | утилиты и проверка auth |
### Cloudflare DNS

В `.env`: `CLOUDFLARE_API_TOKEN` и зона — `CLOUDFLARE_ZONE_ID` или `CLOUDFLARE_ZONE_NAME`.

- **Панель:** **Провайдеры** → Cloudflare — сводка A только для IP из панели; группы «поддомен → отмеченные серверы» (сервер можно выбрать в нескольких группах); **dry-run** с логом и применение.
- API: `GET /api/cloud/cloudflare/overview`, `POST /api/cloud/cloudflare/sync-panel-servers`, `POST /api/cloud/cloudflare/delete-dns-records`.
- CLI (одна группа A): `uv run python scripts/cloudflare_sync_dns.py --dry-run --name mt --ips 1.2.3.4,5.6.7.8`.

## Docker

```bash
bash deploy/init_docker_secrets.sh '<пароль_панели>'
docker compose up -d --build
```

Сервис **postgres** и контейнер **panel** подключают **`deploy/postgres.default.env`**, затем ваш **`.env`** (значения из `.env` перекрывают дефолты). Подстановка **`${VAR}` в самом YAML compose** берётся только из окружения shell и из файла **`.env`** при запуске `docker compose` — поэтому для Postgres используется цепочка **env_file**, а не `${POSTGRES_USER:-…}` в YAML.

Если **`DATABASE_URL`** в `.env` не задан, **`deploy/docker-entrypoint.sh`** собирает его из **`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`** и хоста **`postgres`**. Для локального `uvicorn` задайте в `.env` свой **`DATABASE_URL`** (часто `@127.0.0.1`).

Перед `uvicorn` entrypoint выполняет **`alembic upgrade head`** (повтор при недоступной БД).

Порт **8765** публикуется на **всех интерфейсах** хоста (`8765:8765`). Ограничьте доступ на уровне ОС/облака.

Секреты в `/run/secrets/` монтируются как root-only; `deploy/docker-entrypoint.sh` копирует их в `/tmp` с `0444`, затем процесс идёт от пользователя **panel** через `setpriv` (в compose: `SETUID`/`SETGID`).

## Позже HTTPS за прокси

Тогда выставьте **`PANEL_COOKIE_SECURE=true`**, **`PANEL_TRUST_FORWARDED_PROTO=true`** и прокси с корректными заголовками `X-Forwarded-Proto: https`.
