from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.cloudflare_panel import build_dns_overview_view, build_panel_dns_preview, ipv4_from_host
from app.cloudflare_schemas import CloudflareSyncPanelServersRequest, normalize_ipv4_unique_list
from app.cloudflare_settings import get_cloudflare_settings
from app.http_shared import shared_http_client
from app.providers.cloudflare_api import CloudflareApiError, CloudflareClient
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


@cloudflare_router.get("/overview")
async def cloudflare_overview() -> dict[str, Any]:
    """
    Сводка: зона + проверка токена, все A-записи в зоне с привязкой к серверам панели по IP,
    серверы с IPv4 в карточке, для которых в зоне нет A на этот IP.
    """
    s = get_cloudflare_settings()
    out: dict[str, Any] = {
        "configured": bool(s.api_token.strip()),
        "api_base": s.api_base.rstrip("/"),
    }
    if not s.api_token.strip():
        out["error"] = "Не задан CLOUDFLARE_API_TOKEN"
        return out
    c = _client()
    try:
        verify = await c.verify_token()
        out["token_status"] = verify.get("status")
    except CloudflareApiError as e:
        out["token_error"] = str(e)
        return out
    if not s.zone_id.strip() and not s.zone_name.strip():
        out["error"] = "Задайте CLOUDFLARE_ZONE_ID или CLOUDFLARE_ZONE_NAME"
        return out
    try:
        zid, zname = await c.resolve_zone_id()
    except CloudflareApiError as e:
        out["zone_error"] = str(e)
        return out
    out["zone"] = {"id": zid, "name": zname}

    servers = await list_servers()
    servers_rows = build_panel_dns_preview(servers)
    try:
        all_a = await c.list_all_a_records(zid)
    except CloudflareApiError as e:
        _raise_cf(e)
    out.update(build_dns_overview_view(zname, all_a, servers_rows))
    out["servers"] = servers_rows
    return out


@cloudflare_router.post("/sync-panel-servers")
async def cloudflare_sync_panel_servers(body: CloudflareSyncPanelServersRequest) -> dict[str, Any]:
    """Выравнивание A в Cloudflare под выбранные пары сервер → поддомен (добавление/удаление IP)."""
    c = _client()
    try:
        zid, zname = await c.resolve_zone_id()
    except CloudflareApiError as e:
        _raise_cf(e)

    errors: list[dict[str, str]] = []
    dry = body.dry_run
    full_log: list[str] = []

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

    for e in errors:
        full_log.append("Пропуск: " + ", ".join(f"{k}={v}" for k, v in e.items()))

    results: list[dict[str, Any]] = []

    for nm, raw_ips in by_name.items():
        sids = name_to_servers.get(nm, [])
        try:
            ips = normalize_ipv4_unique_list(raw_ips)
        except ValueError as e:
            msg = str(e)
            full_log.append(f"«{nm}»: {msg}")
            results.append({"name": nm, "ok": False, "server_ids": sids, "error": msg})
            continue
        if body.proxied and len(ips) > 1:
            msg = "Несколько IPv4 на одно имя несовместимо с proxied=true"
            full_log.append(f"«{nm}»: {msg}")
            results.append(
                {
                    "name": nm,
                    "ok": False,
                    "server_ids": sids,
                    "error": msg,
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
            lg = r.get("log") if isinstance(r.get("log"), list) else []
            full_log.extend(str(x) for x in lg)
            results.append({"name": nm, "ok": True, "server_ids": sids, "result": r})
        except CloudflareApiError as e:
            full_log.append(f"«{nm}»: ошибка API: {e}")
            results.append({"name": nm, "ok": False, "server_ids": sids, "error": str(e)})

    return {"dry_run": dry, "zone": zname, "errors": errors, "results": results, "log": full_log}
