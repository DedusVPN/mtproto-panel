from __future__ import annotations

import ipaddress
import re

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
