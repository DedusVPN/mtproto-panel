"""Одноразовый импорт legacy JSON (том /app/data в Docker) в PostgreSQL при обновлении.

Импорт срабатывает только пока соответствующие таблицы «пусты», чтобы не перетирать
данные, уже живущие в БД после миграции.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import close_db, init_db, session_factory
from app.models import MetricsPointRow, MonitorSettingsRow, ServerRow
from app.monitor_schemas import MonitorSettings
from app.server_schemas import StoredServer

log = logging.getLogger(__name__)


def resolve_legacy_data_dir() -> Path | None:
    """Каталог с servers.json и др.: LEGACY_DATA_DIR, иначе /app/data, иначе ./data у репозитория."""
    raw = os.environ.get("LEGACY_DATA_DIR", "").strip()
    if raw:
        p = Path(raw)
        return p if p.is_dir() else None
    dock = Path("/app/data")
    if dock.is_dir():
        return dock
    repo_data = Path(__file__).resolve().parents[2] / "data"
    return repo_data if repo_data.is_dir() else None


async def _metrics_table_empty(session: AsyncSession) -> bool:
    total = await session.scalar(select(func.count()).select_from(MetricsPointRow))
    return (total or 0) == 0


async def _servers_table_empty(session: AsyncSession) -> bool:
    total = await session.scalar(select(func.count()).select_from(ServerRow))
    return (total or 0) == 0


async def _monitor_row_missing(session: AsyncSession) -> bool:
    row = await session.get(MonitorSettingsRow, 1)
    return row is None


async def migrate_legacy_json(data_dir: Path) -> None:
    await init_db()
    fac = session_factory()

    async with fac() as session:
        servers_empty = await _servers_table_empty(session)
        monitor_missing = await _monitor_row_missing(session)
        metrics_empty = await _metrics_table_empty(session)

    servers_path = data_dir / "servers.json"
    if servers_empty and servers_path.is_file():
        raw = json.loads(servers_path.read_text(encoding="utf-8"))
        if isinstance(raw, list) and raw:
            async with fac() as session:
                async with session.begin():
                    for row in raw:
                        try:
                            s = StoredServer.model_validate(row)
                        except Exception:
                            continue
                        session.add(
                            ServerRow(
                                id=s.id,
                                name=s.name,
                                host=s.host,
                                port=s.port,
                                username=s.username,
                                auth_mode=s.auth_mode,
                                private_key=s.private_key,
                                private_key_passphrase=s.private_key_passphrase,
                                password=s.password,
                            )
                        )
            log.info("legacy import: серверы из %s", servers_path)

    mon_path = data_dir / "monitor_settings.json"
    if monitor_missing and mon_path.is_file():
        data = json.loads(mon_path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            settings = MonitorSettings.model_validate(data)
            servers_json = {k: v.model_dump(mode="json") for k, v in settings.servers.items()}
            async with fac() as session:
                async with session.begin():
                    session.add(
                        MonitorSettingsRow(
                            id=1,
                            enabled=settings.enabled,
                            telegram_bot_token=settings.telegram_bot_token,
                            telegram_chat_id=settings.telegram_chat_id,
                            check_interval_seconds=settings.check_interval_seconds,
                            connect_timeout_seconds=settings.connect_timeout_seconds,
                            failure_threshold=settings.failure_threshold,
                            servers_json=servers_json,
                        )
                    )
            log.info("legacy import: монитор из %s", mon_path)

    mpath = data_dir / "metrics_history.json"
    if metrics_empty and mpath.is_file():
        doc = json.loads(mpath.read_text(encoding="utf-8"))
        servers = doc.get("servers") if isinstance(doc, dict) else None
        if isinstance(servers, dict) and servers:
            inserted = 0
            async with fac() as session:
                async with session.begin():
                    for sid, lst in servers.items():
                        if not isinstance(lst, list):
                            continue
                        srv = await session.get(ServerRow, sid)
                        if srv is None:
                            continue
                        for p in lst:
                            if not isinstance(p, dict):
                                continue
                            t = float(p.get("t", 0))
                            m = p.get("m")
                            if not isinstance(m, dict):
                                m = {}
                            dup = await session.execute(
                                select(MetricsPointRow.id)
                                .where(
                                    MetricsPointRow.server_id == sid,
                                    MetricsPointRow.t == t,
                                )
                                .limit(1)
                            )
                            if dup.scalar_one_or_none() is not None:
                                continue
                            session.add(MetricsPointRow(server_id=sid, t=t, m=m))
                            inserted += 1
            log.info("legacy import: метрики из %s, новых точек: %s", mpath, inserted)


async def migrate_legacy_json_merge(data_dir: Path) -> None:
    """Принудительное слияние JSON → БД (ручной скрипт): upsert серверов/монитора, метрики без дублей (server_id, t)."""
    await init_db()
    fac = session_factory()

    servers_path = data_dir / "servers.json"
    if servers_path.is_file():
        raw = json.loads(servers_path.read_text(encoding="utf-8"))
        if isinstance(raw, list) and raw:
            async with fac() as session:
                async with session.begin():
                    for row in raw:
                        try:
                            s = StoredServer.model_validate(row)
                        except Exception:
                            continue
                        existing = await session.get(ServerRow, s.id)
                        if existing is None:
                            session.add(
                                ServerRow(
                                    id=s.id,
                                    name=s.name,
                                    host=s.host,
                                    port=s.port,
                                    username=s.username,
                                    auth_mode=s.auth_mode,
                                    private_key=s.private_key,
                                    private_key_passphrase=s.private_key_passphrase,
                                    password=s.password,
                                )
                            )
                        else:
                            existing.name = s.name
                            existing.host = s.host
                            existing.port = s.port
                            existing.username = s.username
                            existing.auth_mode = s.auth_mode
                            existing.private_key = s.private_key
                            existing.private_key_passphrase = s.private_key_passphrase
                            existing.password = s.password
            log.info("legacy merge: серверы из %s", servers_path)

    mon_path = data_dir / "monitor_settings.json"
    if mon_path.is_file():
        data = json.loads(mon_path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            settings = MonitorSettings.model_validate(data)
            servers_json = {k: v.model_dump(mode="json") for k, v in settings.servers.items()}
            async with fac() as session:
                async with session.begin():
                    row = await session.get(MonitorSettingsRow, 1)
                    if row is None:
                        session.add(
                            MonitorSettingsRow(
                                id=1,
                                enabled=settings.enabled,
                                telegram_bot_token=settings.telegram_bot_token,
                                telegram_chat_id=settings.telegram_chat_id,
                                check_interval_seconds=settings.check_interval_seconds,
                                connect_timeout_seconds=settings.connect_timeout_seconds,
                                failure_threshold=settings.failure_threshold,
                                servers_json=servers_json,
                            )
                        )
                    else:
                        row.enabled = settings.enabled
                        row.telegram_bot_token = settings.telegram_bot_token
                        row.telegram_chat_id = settings.telegram_chat_id
                        row.check_interval_seconds = settings.check_interval_seconds
                        row.connect_timeout_seconds = settings.connect_timeout_seconds
                        row.failure_threshold = settings.failure_threshold
                        row.servers_json = servers_json
            log.info("legacy merge: монитор из %s", mon_path)

    mpath = data_dir / "metrics_history.json"
    if mpath.is_file():
        doc = json.loads(mpath.read_text(encoding="utf-8"))
        servers = doc.get("servers") if isinstance(doc, dict) else None
        if isinstance(servers, dict) and servers:
            inserted = 0
            async with fac() as session:
                async with session.begin():
                    for sid, lst in servers.items():
                        if not isinstance(lst, list):
                            continue
                        srv = await session.get(ServerRow, sid)
                        if srv is None:
                            continue
                        for p in lst:
                            if not isinstance(p, dict):
                                continue
                            t = float(p.get("t", 0))
                            m = p.get("m")
                            if not isinstance(m, dict):
                                m = {}
                            dup = await session.execute(
                                select(MetricsPointRow.id)
                                .where(
                                    MetricsPointRow.server_id == sid,
                                    MetricsPointRow.t == t,
                                )
                                .limit(1)
                            )
                            if dup.scalar_one_or_none() is not None:
                                continue
                            session.add(MetricsPointRow(server_id=sid, t=t, m=m))
                            inserted += 1
            log.info("legacy merge: метрики из %s, новых точек: %s", mpath, inserted)


async def run_legacy_import() -> None:
    """Точка входа для entrypoint и ручного запуска."""
    logging.basicConfig(level=logging.INFO)
    d = resolve_legacy_data_dir()
    if d is None:
        log.info("legacy import: каталог legacy не найден, пропуск")
        return
    try:
        await migrate_legacy_json(d)
    finally:
        await close_db()


def main() -> None:
    import asyncio

    asyncio.run(run_legacy_import())


if __name__ == "__main__":
    main()
