"""Хранение истории снимков метрик в PostgreSQL (до 2 суток на сервер)."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import delete, select

from app.db import session_factory
from app.models import MetricsPointRow
from app.metrics_prom import parse_prometheus_sample_lines

_RETENTION_SEC = 2 * 24 * 3600


def _now() -> float:
    return time.time()


async def append_snapshot(server_id: str, raw_metrics: str) -> dict[str, Any]:
    """Парсит текст, добавляет точку (все числовые серии), обрезает старше 48 ч."""
    parsed_full = parse_prometheus_sample_lines(raw_metrics)
    t = _now()
    cutoff = t - _RETENTION_SEC
    fac = session_factory()
    async with fac() as session:
        async with session.begin():
            session.add(MetricsPointRow(server_id=server_id, t=t, m=parsed_full))
            await session.execute(
                delete(MetricsPointRow).where(
                    MetricsPointRow.server_id == server_id,
                    MetricsPointRow.t < cutoff,
                )
            )
    return {"t": t, "m": parsed_full, "retention_hours": 48}


async def list_history(server_id: str, hours: float | None = None) -> list[dict[str, Any]]:
    """Возвращает точки за удерживаемый период (до 48 ч). Если hours задан — только за последние N часов."""
    now = _now()
    cutoff = now - _RETENTION_SEC
    fac = session_factory()
    async with fac() as session:
        async with session.begin():
            await session.execute(
                delete(MetricsPointRow).where(
                    MetricsPointRow.server_id == server_id,
                    MetricsPointRow.t < cutoff,
                )
            )
            result = await session.execute(
                select(MetricsPointRow)
                .where(
                    MetricsPointRow.server_id == server_id,
                    MetricsPointRow.t >= cutoff,
                )
                .order_by(MetricsPointRow.t)
            )
            rows = result.scalars().all()

    pruned: list[dict[str, Any]] = [
        {"t": float(row.t), "m": dict(row.m) if row.m is not None else {}} for row in rows
    ]
    if hours is not None:
        try:
            h = float(hours)
        except (TypeError, ValueError):
            h = 0.0
        if h > 0:
            span = min(h * 3600.0, float(_RETENTION_SEC))
            tmin = _now() - span
            pruned = [p for p in pruned if isinstance(p, dict) and float(p.get("t", 0)) >= tmin]
    return pruned
