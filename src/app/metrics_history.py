"""Локальное хранение истории снимков метрик (до 2 суток на сервер)."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from app.metrics_prom import parse_prometheus_sample_lines

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_FILE = _DATA_DIR / "metrics_history.json"
_lock = asyncio.Lock()

# 48 часов
_RETENTION_SEC = 2 * 24 * 3600


def _ensure_dir() -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)


def _now() -> float:
    return time.time()


def _read_all() -> dict[str, Any]:
    if not _FILE.is_file():
        return {"servers": {}}
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"servers": {}}
    if not isinstance(data, dict):
        return {"servers": {}}
    if "servers" not in data or not isinstance(data["servers"], dict):
        data["servers"] = {}
    return data


def _write_atomic(doc: dict[str, Any]) -> None:
    _ensure_dir()
    raw = json.dumps(doc, ensure_ascii=False, indent=2)
    tmp = _FILE.with_suffix(".json.tmp")
    tmp.write_text(raw, encoding="utf-8")
    tmp.replace(_FILE)


def _prune_server_points(points: list[dict[str, Any]], cutoff: float) -> list[dict[str, Any]]:
    return [p for p in points if isinstance(p, dict) and float(p.get("t", 0)) >= cutoff]


async def append_snapshot(server_id: str, raw_metrics: str) -> dict[str, Any]:
    """Парсит текст, добавляет точку (все числовые серии), обрезает старше 48 ч."""
    parsed_full = parse_prometheus_sample_lines(raw_metrics)
    t = _now()
    cutoff = t - _RETENTION_SEC
    async with _lock:
        doc = _read_all()
        servers: dict[str, list] = doc.setdefault("servers", {})
        lst = servers.get(server_id)
        if not isinstance(lst, list):
            lst = []
        lst.append({"t": t, "m": parsed_full})
        lst = _prune_server_points(lst, cutoff)
        servers[server_id] = lst
        _write_atomic(doc)
    return {"t": t, "m": parsed_full, "retention_hours": 48}


async def list_history(server_id: str) -> list[dict[str, Any]]:
    async with _lock:
        doc = _read_all()
        servers = doc.setdefault("servers", {})
        lst = servers.get(server_id)
        if not isinstance(lst, list):
            return []
        cutoff = _now() - _RETENTION_SEC
        pruned = _prune_server_points(lst, cutoff)
        if len(pruned) != len(lst):
            servers[server_id] = pruned
            _write_atomic(doc)
        return pruned
