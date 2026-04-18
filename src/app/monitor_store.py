from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from app.monitor_schemas import MonitorSettings, MonitorSettingsUpdate

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_FILE = _DATA_DIR / "monitor_settings.json"
_lock = asyncio.Lock()


def _ensure_data_dir() -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)


def _chmod_private(path: Path) -> None:
    try:
        os.chmod(path, 0o600)
    except (NotImplementedError, OSError, AttributeError):
        pass


def _read_raw() -> dict:
    if not _FILE.is_file():
        return {}
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _write_atomic(settings: MonitorSettings) -> None:
    _ensure_data_dir()
    raw = settings.model_dump_json(indent=2)
    tmp = _FILE.with_suffix(".json.tmp")
    tmp.write_text(raw, encoding="utf-8")
    _chmod_private(tmp)
    tmp.replace(_FILE)
    _chmod_private(_FILE)


async def load_monitor_settings() -> MonitorSettings:
    async with _lock:
        raw = _read_raw()
    try:
        return MonitorSettings.model_validate(raw)
    except Exception:
        return MonitorSettings()


async def save_monitor_settings(update: MonitorSettingsUpdate) -> MonitorSettings:
    settings = MonitorSettings(
        enabled=update.enabled,
        telegram_bot_token=update.telegram_bot_token.strip(),
        telegram_chat_id=update.telegram_chat_id.strip(),
        check_interval_seconds=update.check_interval_seconds,
        connect_timeout_seconds=update.connect_timeout_seconds,
        failure_threshold=update.failure_threshold,
        servers=update.servers,
    )
    async with _lock:
        _write_atomic(settings)
    return settings
