from __future__ import annotations

from sqlalchemy import select

from app.db import session_factory
from app.models import MonitorSettingsRow
from app.monitor_schemas import MonitorSettings, MonitorSettingsUpdate

_MONITOR_ROW_ID = 1


async def load_monitor_settings() -> MonitorSettings:
    fac = session_factory()
    async with fac() as session:
        row = await session.get(MonitorSettingsRow, _MONITOR_ROW_ID)
        if row is None:
            return MonitorSettings()
        raw = {
            "enabled": row.enabled,
            "telegram_bot_token": row.telegram_bot_token or "",
            "telegram_chat_id": row.telegram_chat_id or "",
            "telegram_api_base_url": row.telegram_api_base_url or "",
            "check_interval_seconds": row.check_interval_seconds,
            "connect_timeout_seconds": row.connect_timeout_seconds,
            "failure_threshold": row.failure_threshold,
            "servers": row.servers_json if isinstance(row.servers_json, dict) else {},
        }
        try:
            return MonitorSettings.model_validate(raw)
        except Exception:
            return MonitorSettings()


async def save_monitor_settings(update: MonitorSettingsUpdate) -> MonitorSettings:
    settings = MonitorSettings(
        enabled=update.enabled,
        telegram_bot_token=update.telegram_bot_token.strip(),
        telegram_chat_id=update.telegram_chat_id.strip(),
        telegram_api_base_url=update.telegram_api_base_url.strip().rstrip("/"),
        check_interval_seconds=update.check_interval_seconds,
        connect_timeout_seconds=update.connect_timeout_seconds,
        failure_threshold=update.failure_threshold,
        servers=update.servers,
    )
    servers_json = {k: v.model_dump(mode="json") for k, v in settings.servers.items()}
    fac = session_factory()
    async with fac() as session:
        async with session.begin():
            res = await session.execute(
                select(MonitorSettingsRow)
                .where(MonitorSettingsRow.id == _MONITOR_ROW_ID)
                .with_for_update()
            )
            existing = res.scalar_one_or_none()
            if existing is None:
                session.add(
                    MonitorSettingsRow(
                        id=_MONITOR_ROW_ID,
                        enabled=settings.enabled,
                        telegram_bot_token=settings.telegram_bot_token,
                        telegram_chat_id=settings.telegram_chat_id,
                        telegram_api_base_url=settings.telegram_api_base_url,
                        check_interval_seconds=settings.check_interval_seconds,
                        connect_timeout_seconds=settings.connect_timeout_seconds,
                        failure_threshold=settings.failure_threshold,
                        servers_json=servers_json,
                    )
                )
            else:
                existing.enabled = settings.enabled
                existing.telegram_bot_token = settings.telegram_bot_token
                existing.telegram_chat_id = settings.telegram_chat_id
                existing.telegram_api_base_url = settings.telegram_api_base_url
                existing.check_interval_seconds = settings.check_interval_seconds
                existing.connect_timeout_seconds = settings.connect_timeout_seconds
                existing.failure_threshold = settings.failure_threshold
                existing.servers_json = servers_json
    return settings
