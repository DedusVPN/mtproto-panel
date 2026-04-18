"""Разбор текстового формата Prometheus (exposition) для снимков telemt."""

from __future__ import annotations

import math
import re
from typing import Any

# Имя с необязательными метками и значение в конце строки.
_LINE = re.compile(
    r"^((?P<base>[a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?)\s+(?P<val>[+-]?(?:inf|Inf|nan|NaN|[0-9.eE+-]+))\s*$"
)


def parse_prometheus_sample_lines(text: str) -> dict[str, float]:
    """Возвращает плоский словарь «полное_имя_с_метками» → число (только конечные float)."""
    out: dict[str, float] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _LINE.match(line)
        if not m:
            continue
        key = m.group(1)
        sval = m.group("val").lower()
        if sval in ("nan", "+nan", "-nan", "inf", "+inf", "-inf"):
            continue
        try:
            v = float(sval)
        except ValueError:
            continue
        if math.isnan(v) or math.isinf(v):
            continue
        out[key] = v
    return out


def telemt_metrics_subset(parsed: dict[str, float]) -> dict[str, float]:
    """Оставляем только релевантные для панели серии telemt_* (без лишнего шума)."""
    slim: dict[str, float] = {}
    for k, v in parsed.items():
        if k.startswith("telemt_"):
            slim[k] = v
    return slim


def parse_prometheus_help_type(text: str) -> tuple[dict[str, str], dict[str, str]]:
    """
    Извлекает из exposition-строки комментарии # HELP и # TYPE.
    Ключ — имя метрики без меток (как в спецификации Prometheus).
    """
    help_map: dict[str, str] = {}
    type_map: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("# HELP "):
            rest = line[7:].strip()
            i = rest.find(" ")
            if i > 0:
                name, desc = rest[:i].strip(), rest[i + 1 :].strip()
                if name:
                    help_map[name] = desc
        elif line.startswith("# TYPE "):
            rest = line[7:].strip()
            parts = rest.split(None, 2)
            if len(parts) >= 2:
                name, typ = parts[0], parts[1].strip()
                if name:
                    type_map[name] = typ
    return help_map, type_map


def metric_base_name(full_key: str) -> str:
    """Имя метрики без label-set, например telemt_x из telemt_x{a=\"b\"}."""
    return full_key.split("{", 1)[0] if "{" in full_key else full_key


def build_metric_rows(raw: str, parsed: dict[str, float]) -> list[dict[str, Any]]:
    """Сортированные строки для таблицы UI: ключ, значение, HELP, TYPE."""
    help_m, type_m = parse_prometheus_help_type(raw)
    rows: list[dict[str, Any]] = []
    for key in sorted(parsed.keys()):
        base = metric_base_name(key)
        rows.append(
            {
                "key": key,
                "base": base,
                "value": parsed[key],
                "help": help_m.get(base),
                "type": type_m.get(base),
            }
        )
    return rows


def build_stats_cards(parsed: dict[str, float]) -> dict[str, Any]:
    """Сводка для карточек UI из последнего снимка."""
    p = telemt_metrics_subset(parsed)

    def pick(*keys: str) -> float | None:
        for k in keys:
            if k in p:
                return p[k]
        return None

    users_current: dict[str, float] = {}
    users_total: dict[str, float] = {}
    for k, v in p.items():
        if k.startswith("telemt_user_connections_current{"):
            um = re.search(r'user="([^"]+)"', k)
            if um:
                users_current[um.group(1)] = v
        if k.startswith("telemt_user_connections_total{"):
            um = re.search(r'user="([^"]+)"', k)
            if um:
                users_total[um.group(1)] = v

    ver = None
    for k in p:
        if k.startswith("telemt_build_info{") and "version=" in k:
            vm = re.search(r'version="([^"]+)"', k)
            if vm:
                ver = vm.group(1)
            break

    return {
        "version": ver,
        "uptime_seconds": pick("telemt_uptime_seconds"),
        "connections_total": pick("telemt_connections_total"),
        "connections_bad_total": pick("telemt_connections_bad_total"),
        "handshake_timeouts_total": pick("telemt_handshake_timeouts_total"),
        "upstream_connect_success": pick("telemt_upstream_connect_success_total"),
        "upstream_connect_fail": pick("telemt_upstream_connect_fail_total"),
        "writers_active": pick("telemt_me_writers_active_current"),
        "writers_warm": pick("telemt_me_writers_warm_current"),
        "desync_total": pick("telemt_desync_total"),
        "telemetry_core": pick("telemt_telemetry_core_enabled"),
        "per_user_connections_current": users_current,
        "per_user_connections_total": users_total,
    }
