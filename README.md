# free-tg-mtproxy

Панель развёртывания **Telemt** по SSH и блок «Облако · VDSina».

## Запуск (uv)

Из корня репозитория:

```bash
uv sync
uv run python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Скрипты-обёртки: `run_panel.sh`, `run_panel.cmd`.

## Структура

| Путь | Назначение |
|------|------------|
| `src/app/` | код FastAPI-приложения |
| `static/` | веб-интерфейс панели |
| `data/` | локальные данные (`servers.json`, не в git) |
| `deploy/` | `Dockerfile`, `init_docker_secrets.sh` |
| `scripts/` | утилиты (хэш пароля панели) |

Конфигурация: `.env` (шаблон — `.env.example`). Секреты для Docker Compose: каталог `secrets/`.

## Docker

```bash
bash deploy/init_docker_secrets.sh '<пароль_панели>'
docker compose up -d --build
```

Секреты в `/run/secrets/` — **root:root 0400**; `deploy/docker-entrypoint.sh` копирует их в `/tmp` с режимом **0444** (без `chown`: при `cap_drop: ALL` нет `CAP_CHOWN`), затем запускает uvicorn от **panel** через `setpriv` (в compose нужны `SETUID`/`SETGID`).
