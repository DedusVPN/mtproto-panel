from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING

from app.monitor_schemas import MonitorSettings, ServerCheckStatus
from app.monitor_store import load_monitor_settings
from app.proxy_checker import check_proxy_port
from app.server_store import get_server, list_servers
from app.telegram_notify import notify_proxy_down, notify_proxy_up

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# In-memory state: server_id → статус последней проверки
_status: dict[str, ServerCheckStatus] = {}
_task: asyncio.Task | None = None


def get_status_snapshot() -> dict[str, ServerCheckStatus]:
    return dict(_status)


def is_running() -> bool:
    return _task is not None and not _task.done()


async def _check_one(
    server_id: str,
    host: str,
    server_name: str,
    proxy_port: int,
    settings: MonitorSettings,
) -> None:
    now = time.time()
    prev = _status.get(server_id, ServerCheckStatus())

    ok, error_msg = await check_proxy_port(host, proxy_port, float(settings.connect_timeout_seconds))

    if ok:
        new_failures = 0
        new_status = "up"
        last_error = None
    else:
        new_failures = prev.consecutive_failures + 1
        new_status = "down" if new_failures >= settings.failure_threshold else prev.status
        last_error = error_msg

    status_changed = new_status != prev.status

    cur = ServerCheckStatus(
        status=new_status,
        last_check_ts=now,
        last_change_ts=now if status_changed else prev.last_change_ts,
        consecutive_failures=new_failures,
        last_error=last_error,
    )
    _status[server_id] = cur

    if not status_changed:
        return

    token = settings.telegram_bot_token
    chat = settings.telegram_chat_id
    if not token or not chat:
        return

    api_base = settings.telegram_api_base_url
    thread = settings.telegram_thread_id
    if new_status == "down":
        await notify_proxy_down(token, chat, server_name, host, proxy_port, error_msg or "", api_base, thread)
    elif new_status == "up":
        await notify_proxy_up(token, chat, server_name, host, proxy_port, api_base, thread)


async def _run_loop() -> None:
    logger.info("Планировщик мониторинга запущен")
    while True:
        try:
            settings = await load_monitor_settings()
        except Exception as e:
            logger.error("Ошибка загрузки настроек мониторинга: %s", e)
            await asyncio.sleep(30)
            continue

        if not settings.enabled:
            await asyncio.sleep(15)
            continue

        try:
            server_list = await list_servers()
        except Exception as e:
            logger.error("Ошибка получения списка серверов: %s", e)
            await asyncio.sleep(30)
            continue

        tasks: list[asyncio.Task] = []
        for srv_item in server_list:
            srv_cfg = settings.servers.get(srv_item.id)
            if srv_cfg is None or not srv_cfg.enabled:
                continue
            srv = await get_server(srv_item.id)
            if srv is None:
                continue
            t = asyncio.create_task(
                _check_one(
                    server_id=srv.id,
                    host=srv.host,
                    server_name=srv.name,
                    proxy_port=srv_cfg.proxy_port,
                    settings=settings,
                )
            )
            tasks.append(t)

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        await asyncio.sleep(settings.check_interval_seconds)


def start_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_run_loop())
    logger.info("Задача планировщика мониторинга создана")


async def stop_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None
    logger.info("Планировщик мониторинга остановлен")


async def run_check_now() -> dict[str, ServerCheckStatus]:
    """Немедленно проверить все включённые серверы и вернуть результат."""
    settings = await load_monitor_settings()
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        # Можно проверять даже без Telegram — просто не уведомляем
        pass

    server_list = await list_servers()
    tasks: list[asyncio.Task] = []
    for srv_item in server_list:
        srv_cfg = settings.servers.get(srv_item.id)
        if srv_cfg is None or not srv_cfg.enabled:
            continue
        srv = await get_server(srv_item.id)
        if srv is None:
            continue
        t = asyncio.create_task(
            _check_one(
                server_id=srv.id,
                host=srv.host,
                server_name=srv.name,
                proxy_port=srv_cfg.proxy_port,
                settings=settings,
            )
        )
        tasks.append(t)

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    return get_status_snapshot()
