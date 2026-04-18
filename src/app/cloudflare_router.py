from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.cloudflare_panel import build_panel_dns_preview, ipv4_from_host
from app.cloudflare_schemas import (
    CloudflareSyncARequest,
    CloudflareSyncPanelServersRequest,
    normalize_ipv4_unique_list,
)
from app.cloud_settings import dotenv_configured, dotenv_path
from app.cloudflare_settings import get_cloudflare_settings
from app.cloudflare_targets import load_dns_targets_from_settings
from app.http_shared import shared_http_client
from app.providers.cloudflare_api import CloudflareApiError, CloudflareClient, fqdn_for_record
from app.server_store import get_server, list_servers

cloudflare_router = APIRouter(prefix="/api/cloud/cloudflare", tags=["cloud-cloudflare"])


def _map_cf_http(status: int | None) -> int:
    if status is None:
        return 502
    if status in (400, 401, 403, 404, 409, 422, 429):
        return status
    if 400 <= status < 500:
        return 502
    if status >= 500:
        return 502
    return 502


def _raise_cf(exc: CloudflareApiError) -> None:
    raise HTTPException(status_code=_map_cf_http(exc.http_status), detail=str(exc)) from exc


def _client() -> CloudflareClient:
    return CloudflareClient(shared_http_client(), get_cloudflare_settings())


@cloudflare_router.get("/status")
async def cloudflare_status() -> dict[str, Any]:
    s = get_cloudflare_settings()
    tok = s.api_token.strip()
    out: dict[str, Any] = {
        "provider": "cloudflare",
        "configured": bool(tok),
        "api_base": s.api_base.rstrip("/"),
        "zone_id_set": bool(s.zone_id.strip()),
        "zone_name": s.zone_name.strip() or None,
        "dotenv_path": str(dotenv_path()) if dotenv_configured() else None,
        "dns_targets_file": str(s.dns_targets_file) if s.dns_targets_file else None,
        "dns_targets_file_exists": bool(s.dns_targets_file and s.dns_targets_file.is_file()),
        "dns_targets_json_set": bool((s.dns_targets_json or "").strip()),
        "docs": "https://developers.cloudflare.com/api/",
    }
    if not tok:
        return out
    try:
        verify = await _client().verify_token()
        out["token_status"] = verify.get("status")
        out["token_summary"] = {k: verify.get(k) for k in ("id", "expires_on") if verify.get(k) is not None}
    except CloudflareApiError as e:
        out["token_error"] = str(e)
        return out
    if not s.zone_id.strip() and not s.zone_name.strip():
        return out
    try:
        zid, zname = await _client().resolve_zone_id()
        out["zone"] = {"id": zid, "name": zname}
    except CloudflareApiError as e:
        out["zone_error"] = str(e)
    try:
        targets = load_dns_targets_from_settings(s)
        out["targets_count"] = len(targets)
    except ValueError as e:
        out["targets_parse_error"] = str(e)
    return out


@cloudflare_router.get("/dns-records")
async def cloudflare_dns_records(
    name: str = Query(..., min_length=1, description="Поддомен (mt) или FQDN"),
) -> dict[str, Any]:
    c = _client()
    try:
        zid, zname = await c.resolve_zone_id()
        fqdn = fqdn_for_record(name, zname)
        recs = await c.list_a_records(zid, fqdn)
    except CloudflareApiError as e:
        _raise_cf(e)
    slim = [
        {"id": r.get("id"), "content": r.get("content"), "proxied": r.get("proxied"), "ttl": r.get("ttl")}
        for r in recs
        if isinstance(r, dict)
    ]
    return {"zone": zname, "fqdn": fqdn, "records": slim}


@cloudflare_router.post("/sync-a")
async def cloudflare_sync_a(body: CloudflareSyncARequest) -> dict[str, Any]:
    c = _client()
    try:
        zid, zname = await c.resolve_zone_id()
        return await c.sync_a_records(
            zone_id=zid,
            zone_name=zname,
            record_label=body.name,
            ips=body.ips,
            proxied=body.proxied,
            ttl=body.ttl,
            dry_run=False,
        )
    except CloudflareApiError as e:
        _raise_cf(e)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@cloudflare_router.post("/sync-a/dry-run")
async def cloudflare_sync_a_dry_run(body: CloudflareSyncARequest) -> dict[str, Any]:
    c = _client()
    try:
        zid, zname = await c.resolve_zone_id()
        return await c.sync_a_records(
            zone_id=zid,
            zone_name=zname,
            record_label=body.name,
            ips=body.ips,
            proxied=body.proxied,
            ttl=body.ttl,
            dry_run=True,
        )
    except CloudflareApiError as e:
        _raise_cf(e)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@cloudflare_router.get("/panel-servers-preview")
async def cloudflare_panel_servers_preview() -> dict[str, Any]:
    """Серверы из панели + подсказка поддомена; A-запись возможна только если «хост» — уже IPv4."""
    servers = await list_servers()
    return {"servers": build_panel_dns_preview(servers)}


@cloudflare_router.post("/sync-panel-servers")
async def cloudflare_sync_panel_servers(body: CloudflareSyncPanelServersRequest) -> dict[str, Any]:
    """
    Синхронизация A-записей из `servers.json`: либо таблица server_id→поддомен, либо один поддомен на все выбранные IP.
    Несколько строк с одним поддоменом дают несколько A на одно имя (round-robin на стороне DNS).
    """
    c = _client()
    try:
        zid, zname = await c.resolve_zone_id()
    except CloudflareApiError as e:
        _raise_cf(e)

    errors: list[dict[str, str]] = []
    dry = body.dry_run

    if body.union_name():
        ips_acc: list[str] = []
        for sid in body.server_ids:
            sid = sid.strip()
            if not sid:
                continue
            s = await get_server(sid)
            if s is None:
                errors.append({"server_id": sid, "error": "сервер не найден"})
                continue
            ip = ipv4_from_host(s.host)
            if not ip:
                errors.append(
                    {"server_id": sid, "panel_name": s.name, "host": s.host, "error": "хост не IPv4 — укажите IP в карточке сервера"}
                )
                continue
            ips_acc.append(ip)
        try:
            ips = normalize_ipv4_unique_list(ips_acc)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        if body.proxied and len(ips) > 1:
            raise HTTPException(
                status_code=422,
                detail="Несколько IPv4 на одно имя несовместимо с proxied=true",
            )
        try:
            r = await c.sync_a_records(
                zone_id=zid,
                zone_name=zname,
                record_label=body.union_name(),
                ips=ips,
                proxied=body.proxied,
                ttl=body.ttl,
                dry_run=dry,
            )
        except CloudflareApiError as e:
            _raise_cf(e)
        return {"mode": "union", "dry_run": dry, "zone": zname, "errors": errors, "result": r}

    by_name: dict[str, list[str]] = {}
    name_to_servers: dict[str, list[str]] = {}
    for row in body.items:
        s = await get_server(row.server_id)
        if s is None:
            errors.append({"server_id": row.server_id, "error": "сервер не найден"})
            continue
        ip = ipv4_from_host(s.host)
        if not ip:
            errors.append(
                {
                    "server_id": row.server_id,
                    "panel_name": s.name,
                    "host": s.host,
                    "error": "хост не IPv4 — укажите IP в карточке сервера",
                }
            )
            continue
        nm = row.name
        by_name.setdefault(nm, []).append(ip)
        name_to_servers.setdefault(nm, []).append(row.server_id)

    results: list[dict[str, Any]] = []
    for nm, raw_ips in by_name.items():
        sids = name_to_servers.get(nm, [])
        try:
            ips = normalize_ipv4_unique_list(raw_ips)
        except ValueError as e:
            results.append({"name": nm, "ok": False, "server_ids": sids, "error": str(e)})
            continue
        if body.proxied and len(ips) > 1:
            results.append(
                {
                    "name": nm,
                    "ok": False,
                    "server_ids": sids,
                    "error": "Несколько IPv4 на одно имя несовместимо с proxied=true",
                }
            )
            continue
        try:
            r = await c.sync_a_records(
                zone_id=zid,
                zone_name=zname,
                record_label=nm,
                ips=ips,
                proxied=body.proxied,
                ttl=body.ttl,
                dry_run=dry,
            )
            results.append({"name": nm, "ok": True, "server_ids": sids, "result": r})
        except CloudflareApiError as e:
            results.append({"name": nm, "ok": False, "server_ids": sids, "error": str(e)})

    return {"mode": "per_subdomain", "dry_run": dry, "zone": zname, "errors": errors, "results": results}


@cloudflare_router.post("/sync-config")
async def cloudflare_sync_config(dry_run: bool = Query(False)) -> dict[str, Any]:
    s = get_cloudflare_settings()
    try:
        targets = load_dns_targets_from_settings(s)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if not targets:
        raise HTTPException(
            status_code=422,
            detail="Нет целей: задайте CLOUDFLARE_DNS_TARGETS_FILE или CLOUDFLARE_DNS_TARGETS_JSON",
        )
    c = _client()
    try:
        zid, zname = await c.resolve_zone_id()
    except CloudflareApiError as e:
        _raise_cf(e)
    results: list[dict[str, Any]] = []
    for t in targets:
        try:
            r = await c.sync_a_records(
                zone_id=zid,
                zone_name=zname,
                record_label=t.name,
                ips=t.ips,
                proxied=t.proxied,
                ttl=t.ttl,
                dry_run=dry_run,
            )
            results.append({"name": t.name, "ok": True, "result": r})
        except (CloudflareApiError, ValueError) as e:
            results.append({"name": t.name, "ok": False, "error": str(e)})
    return {"dry_run": dry_run, "zone": zname, "results": results}
