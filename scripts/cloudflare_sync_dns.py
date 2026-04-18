#!/usr/bin/env python3
"""CLI: одна A-группа в Cloudflare (поддомен + список IPv4). Панель — GET/POST /api/cloud/cloudflare/…"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import httpx

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.cloudflare_schemas import normalize_ipv4_unique_list  # noqa: E402
from app.cloudflare_settings import get_cloudflare_settings  # noqa: E402
from app.providers.cloudflare_api import CloudflareApiError, CloudflareClient  # noqa: E402


async def _run(ns: argparse.Namespace) -> int:
    if ns.ttl != 1 and (ns.ttl < 60 or ns.ttl > 86400):
        print("TTL: укажите 1 (авто) или число от 60 до 86400.", file=sys.stderr)
        return 2
    if not ns.name or not ns.ips:
        print("Укажите --name и --ips (IPv4 через запятую).", file=sys.stderr)
        return 2
    ips = [x.strip() for x in ns.ips.split(",") if x.strip()]
    try:
        ips = normalize_ipv4_unique_list(ips)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    if ns.proxied and len(ips) > 1:
        print("С proxied=true допустим только один IP.", file=sys.stderr)
        return 2

    settings = get_cloudflare_settings()
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0), follow_redirects=True) as http:
        c = CloudflareClient(http, settings)
        try:
            zid, zname = await c.resolve_zone_id()
        except CloudflareApiError as e:
            print(str(e), file=sys.stderr)
            return 1
        print(f"Зона: {zname} ({zid})")
        try:
            r = await c.sync_a_records(
                zone_id=zid,
                zone_name=zname,
                record_label=ns.name,
                ips=ips,
                proxied=ns.proxied,
                ttl=ns.ttl,
                dry_run=ns.dry_run,
            )
            print(json.dumps(r, ensure_ascii=False, indent=2))
        except (CloudflareApiError, ValueError) as e:
            print(str(e), file=sys.stderr)
            return 1
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Синхронизация одной группы A-записей Cloudflare (CLI).")
    p.add_argument("--dry-run", action="store_true", help="Только план и лог, без запросов DELETE/POST")
    p.add_argument("--name", required=True, help="Поддомен (mt) или @ для apex")
    p.add_argument("--ips", required=True, help="IPv4 через запятую")
    p.add_argument("--proxied", action="store_true")
    p.add_argument("--ttl", type=int, default=60, help="1 = авто в CF; иначе 60–86400 (минимум ручного — 60)")
    ns = p.parse_args()
    return asyncio.run(_run(ns))


if __name__ == "__main__":
    raise SystemExit(main())
