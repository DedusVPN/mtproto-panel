from __future__ import annotations

import ipaddress
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


def build_panel_servers_dns_rows(servers: list[ServerListItem]) -> list[dict[str, str | None]]:
    """Серверы панели для UI: id, имя, хост, IPv4 при наличии (поддомен задаётся на фронте)."""
    out: list[dict[str, str | None]] = []
    for s in servers:
        ip = ipv4_from_host(s.host)
        out.append(
            {
                "server_id": s.id,
                "panel_name": s.name,
                "host": s.host,
                "ipv4": ip,
            }
        )
    return out


def build_dns_overview_view(
    zone_name: str,
    a_records_raw: list[dict[str, Any]],
    servers_rows: list[dict[str, str | None]],
) -> dict[str, Any]:
    """
    Сводка: A-записи зоны, у которых IP есть в панели (остальные не показываем);
    серверы с IPv4, для которых в зоне нет ни одной A на этот IP.
    """
    ip_to_panel: dict[str, list[dict[str, str]]] = {}
    for row in servers_rows:
        ip = row.get("ipv4")
        if not isinstance(ip, str) or not ip:
            continue
        ip_to_panel.setdefault(ip, []).append(
            {"id": str(row.get("server_id") or ""), "name": str(row.get("panel_name") or "")}
        )

    all_zone_ips: set[str] = set()
    for rec in a_records_raw:
        if not isinstance(rec, dict):
            continue
        content = rec.get("content")
        if not isinstance(content, str):
            continue
        try:
            all_zone_ips.add(str(ipaddress.ip_address(content.strip())))
        except ValueError:
            all_zone_ips.add(content.strip())

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
        matched = list(ip_to_panel.get(ip_n, []))
        if not matched:
            continue
        rel = relative_name_from_fqdn(name, zone_name)
        a_records.append(
            {
                "id": rid,
                "name": name,
                "relative_name": rel,
                "content": ip_n,
                "proxied": rec.get("proxied"),
                "ttl": rec.get("ttl"),
                "matched_panel_servers": matched,
            }
        )

    panel_without_a = [r for r in servers_rows if r.get("ipv4") and r["ipv4"] not in all_zone_ips]

    return {
        "a_records": a_records,
        "panel_servers_without_a": panel_without_a,
    }
