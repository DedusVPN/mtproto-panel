#!/usr/bin/env python3
"""Синхронизация A-записей Cloudflare из .env (CLOUDFLARE_*) или из аргументов CLI."""
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

from app.cloudflare_schemas import CloudflareDnsTarget  # noqa: E402
from app.cloudflare_settings import get_cloudflare_settings  # noqa: E402
from app.cloudflare_targets import load_dns_targets_from_settings, parse_dns_targets_payload  # noqa: E402
from app.providers.cloudflare_api import CloudflareApiError, CloudflareClient  # noqa: E402


def _targets_from_args(ns: argparse.Namespace) -> list[CloudflareDnsTarget]:
    if ns.name and ns.ips:
        ips = [x.strip() for x in ns.ips.split(",") if x.strip()]
        return [CloudflareDnsTarget(name=ns.name, ips=ips, proxied=ns.proxied, ttl=ns.ttl)]
    if ns.name or ns.ips:
        print("Для одиночной записи укажите оба аргумента: --name и --ips", file=sys.stderr)
        raise SystemExit(2)
    s = get_cloudflare_settings()
    if ns.config is not None:
        if not ns.config.is_file():
            print(f"Файл не найден: {ns.config}", file=sys.stderr)
            raise SystemExit(2)
        return parse_dns_targets_payload(ns.config.read_text(encoding="utf-8-sig"))
    return load_dns_targets_from_settings(s)


async def _run(ns: argparse.Namespace) -> int:
    targets = _targets_from_args(ns)
    if not targets:
        print(
            "Нет целей DNS: задайте --name и --ips, или CLOUDFLARE_DNS_TARGETS_FILE / "
            "CLOUDFLARE_DNS_TARGETS_JSON, или --config путь.json",
            file=sys.stderr,
        )
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
        rc = 0
        for t in targets:
            try:
                r = await c.sync_a_records(
                    zone_id=zid,
                    zone_name=zname,
                    record_label=t.name,
                    ips=t.ips,
                    proxied=t.proxied,
                    ttl=t.ttl,
                    dry_run=ns.dry_run,
                )
                print(json.dumps({"name": t.name, **r}, ensure_ascii=False, indent=2))
            except (CloudflareApiError, ValueError) as e:
                print(f"[{t.name}] ошибка: {e}", file=sys.stderr)
                rc = 1
        return rc


def main() -> int:
    p = argparse.ArgumentParser(description="Синхронизация A-записей Cloudflare (несколько IP на имя — несколько A).")
    p.add_argument("--dry-run", action="store_true", help="Только показать план, без изменений в API")
    p.add_argument("--config", type=Path, default=None, help="JSON с records / массивом целей (перекрывает файл из .env)")
    p.add_argument("--name", help="Поддомен (mtproxy) или @ для apex — вместе с --ips")
    p.add_argument("--ips", help="IPv4 через запятую для --name")
    p.add_argument("--proxied", action="store_true", help="С прокси Cloudflare (только один IP)")
    p.add_argument("--ttl", type=int, default=1, help="TTL (1 = auto)")
    ns = p.parse_args()
    return asyncio.run(_run(ns))


if __name__ == "__main__":
    raise SystemExit(main())
