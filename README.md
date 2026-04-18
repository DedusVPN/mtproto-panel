# free-tg-mtproxy

Панель развёртывания **Telemt** по SSH и блоки «Облако · VDSina» и **Cloudflare DNS** (синхронизация нескольких A на один поддомен).

Сценарий по умолчанию: **доступ по `http://IP:порт` без домена и SSL**. В `.env` должны быть **`PANEL_COOKIE_SECURE=false`** и **`PANEL_TRUST_FORWARDED_PROTO=false`**, иначе вход по cookie не заработает в браузере.

## Запуск (uv)

```bash
uv sync
# Слушает 0.0.0.0:8765 — откройте http://<IP_сервера>:8765 (ограничьте доступ файрволом / VPN).
uv run python -m uvicorn app.main:app --host "${PANEL_BIND_HOST:-0.0.0.0}" --port "${PANEL_BIND_PORT:-8765}"
```

Обёртки: **`run_panel.sh`**, **`run_panel.cmd`** (те же переменные `PANEL_BIND_HOST` / `PANEL_BIND_PORT`).

Проверка auth: `uv run python scripts/verify_auth_integration.py --base http://127.0.0.1:8765`  
(если в `.env` случайно **`PANEL_COOKIE_SECURE=true`** при проверке по `http://`, скрипт подскажет отключить флаг.)

## Структура

| Путь | Назначение |
|------|------------|
| `src/app/` | код FastAPI-приложения |
| `static/` | веб-интерфейс панели |
| `data/` | локальные данные (`servers.json`, не в git) |
| `deploy/` | `Dockerfile`, `docker-entrypoint.sh`, `init_docker_secrets.sh` |
| `scripts/` | утилиты и проверка auth |
| `config/cloudflare_dns_targets.example.json` | пример целей DNS для Cloudflare |

### Cloudflare DNS

В `.env`: `CLOUDFLARE_API_TOKEN` и зона — `CLOUDFLARE_ZONE_ID` или `CLOUDFLARE_ZONE_NAME`.

- **Панель (основной сценарий):** раздел **Провайдеры** → Cloudflare → таблица серверов из `data/servers.json`: отметьте строки, при необходимости поправьте поддомен (по умолчанию подсказка из имени сервера), **«Выбранные → DNS»**. Для каждого IPv4 в поле «хост» создаётся/обновляется набор A-записей под указанным поддоменом. Несколько серверов с **одинаковым** поддоменом дают **несколько A** на одно имя. Отдельно: **«Все IP → одно имя»** — все отмеченные серверы в одну группу A под одним поддоменом.
- **`.env` JSON/файл** (`CLOUDFLARE_DNS_TARGETS_*`) — только если нужна синхронизация без UI (cron, скрипты).
- CLI: `uv run python scripts/cloudflare_sync_dns.py --dry-run` или `--name mt --ips 1.2.3.4,5.6.7.8`.
- API: `GET /api/cloud/cloudflare/panel-servers-preview`, `POST /api/cloud/cloudflare/sync-panel-servers`, плюс ручной `sync-a` и `sync-config`.

## Docker

```bash
bash deploy/init_docker_secrets.sh '<пароль_панели>'
docker compose up -d --build
```

Порт **8765** публикуется на **всех интерфейсах** хоста (`8765:8765`). Ограничьте доступ на уровне ОС/облака.

Секреты в `/run/secrets/` монтируются как root-only; `deploy/docker-entrypoint.sh` копирует их в `/tmp` с `0444`, затем процесс идёт от пользователя **panel** через `setpriv` (в compose: `SETUID`/`SETGID`).

## Позже HTTPS за прокси

Тогда выставьте **`PANEL_COOKIE_SECURE=true`**, **`PANEL_TRUST_FORWARDED_PROTO=true`** и прокси с корректными заголовками `X-Forwarded-Proto: https`.
