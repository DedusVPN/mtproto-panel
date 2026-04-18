from __future__ import annotations

import ipaddress
import re
from typing import Any

from app.server_schemas import ServerListItem


def ipv4_from_host(host: str) -> str | None:
    """Только если в поле «хост» уже указан IPv4 (без DNS-резолва имён)."""
    h = (host or "").strip()
    if not h:
        return None
    try:
        addr = ipaddress.ip_address(h)
    except ValueError:
        return None
    if addr.version != 4:
        return None
    return str(addr)


def dns_label_from_server_name(name: str, server_id: str) -> str:
    """Подсказка поддомена из названия сервера в панели (одна метка DNS, до 63 символов)."""
    raw = (name or "").strip().lower()
    raw = re.sub(r"[^a-z0-9-]+", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    if not raw:
        raw = "srv-" + re.sub(r"[^a-z0-9-]", "", server_id.lower())[:12]
    if len(raw) > 63:
        raw = raw[:63].rstrip("-")
    return raw or ("srv-" + server_id[:8])


def uniquify_dns_label(base: str, used: set[str]) -> str:
    b = base[:63].rstrip("-") or "srv"
    if b not in used:
        return b
    for i in range(2, 10_000):
        suffix = f"-{i}"
        head = b[: max(1, 63 - len(suffix))].rstrip("-")
        cand = (head + suffix)[:63]
        if cand not in used:
            return cand
    return (b[:40] + "-x")[:63]


def relative_name_from_fqdn(fqdn: str, zone_name: str) -> str:
    """Имя записи относительно зоны (для отображения)."""
    f = (fqdn or "").strip().rstrip(".").lower()
    z = (zone_name or "").strip().rstrip(".").lower()
    if not f or not z:
        return f or ""
    if f == z:
        return "@"
    suf = "." + z
    if f.endswith(suf):
        rel = f[: -len(suf)]
        return rel if rel else "@"
    return f


def build_panel_dns_preview(servers: list[ServerListItem]) -> list[dict[str, str | None]]:
    used: set[str] = set()
    out: list[dict[str, str | None]] = []
    for s in servers:
        base = dns_label_from_server_name(s.name, s.id)
        sug = uniquify_dns_label(base, used)
        used.add(sug)
        ip = ipv4_from_host(s.host)
        out.append(
            {
                "server_id": s.id,
                "panel_name": s.name,
                "host": s.host,
                "ipv4": ip,
                "suggested_subdomain": sug,
            }
        )
    return out


def build_dns_overview_view(
    zone_name: str,
    a_records_raw: list[dict[str, Any]],
    servers_rows: list[dict[str, str | None]],
) -> dict[str, Any]:
    """Сводка: все A в зоне + привязка к серверам панели по IP; серверы с IPv4 без ни одной A."""
    ip_to_panel: dict[str, list[dict[str, str]]] = {}
    for row in servers_rows:
        ip = row.get("ipv4")
        if not isinstance(ip, str) or not ip:
            continue
        ip_to_panel.setdefault(ip, []).append(
            {"id": str(row.get("server_id") or ""), "name": str(row.get("panel_name") or "")}
        )

    a_records: list[dict[str, Any]] = []
    for rec in a_records_raw:
        if not isinstance(rec, dict):
            continue
        rid = rec.get("id")
        name = rec.get("name")
        content = rec.get("content")
        if not isinstance(rid, str) or not isinstance(name, str) or not isinstance(content, str):
            continue
        try:
            ip_n = str(ipaddress.ip_address(content.strip()))
        except ValueError:
            ip_n = content.strip()
        rel = relative_name_from_fqdn(name, zone_name)
        a_records.append(
            {
                "id": rid,
                "name": name,
                "relative_name": rel,
                "content": ip_n,
                "proxied": rec.get("proxied"),
                "ttl": rec.get("ttl"),
                "matched_panel_servers": list(ip_to_panel.get(ip_n, [])),
            }
        )

    ips_in_cf = {r["content"] for r in a_records}
    panel_without_a = [r for r in servers_rows if r.get("ipv4") and r["ipv4"] not in ips_in_cf]

    return {
        "a_records": a_records,
        "panel_servers_without_a": panel_without_a,
    }
