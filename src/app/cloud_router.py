from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException

from app.cloud_schemas import VdsinaCreateServerBody
from app.cloud_settings import dotenv_configured, dotenv_path, get_vdsina_settings
from app.cloudflare_settings import get_cloudflare_settings
from app.http_shared import shared_http_client
from app.providers.vdsina import VdsinaClient, VdsinaUpstreamError

cloud_meta_router = APIRouter(prefix="/api/cloud", tags=["cloud"])

router = APIRouter(prefix="/api/cloud/vdsina", tags=["cloud-vdsina"])


@cloud_meta_router.get("/providers")
async def cloud_providers() -> list[dict[str, Any]]:
    s = get_vdsina_settings()
    cf = get_cloudflare_settings()
    return [
        {
            "id": "vdsina",
            "label": "VDSina",
            "configured": bool(s.api_token.strip()),
            "api_base": s.api_base.rstrip("/"),
        },
        {
            "id": "cloudflare",
            "label": "Cloudflare DNS",
            "configured": bool(cf.api_token.strip()),
            "api_base": cf.api_base.rstrip("/"),
        },
    ]


def _map_upstream_http(status: int | None) -> int:
    if status is None:
        return 502
    if status in (400, 401, 403, 404, 409, 422, 429):
        return status
    if 400 <= status < 500:
        return 502
    if status >= 500:
        return 502
    return 502


def _raise_upstream(exc: VdsinaUpstreamError) -> None:
    raise HTTPException(status_code=_map_upstream_http(exc.http_status), detail=str(exc)) from exc


def _client() -> VdsinaClient:
    return VdsinaClient(shared_http_client(), get_vdsina_settings())


@router.get("/status")
async def vdsina_status() -> dict[str, Any]:
    s = get_vdsina_settings()
    tok = s.api_token.strip()
    diag: dict[str, Any] = {"length": len(tok)}
    if tok:
        diag["looks_like_hex"] = bool(re.fullmatch(r"[0-9a-fA-F]+", tok))
        diag["looks_like_jwt"] = tok.count(".") == 2 and len(tok) > 40
        diag["has_control_chars"] = any(ord(c) < 32 or ord(c) == 127 for c in tok)
        diag["has_non_ascii"] = any(ord(c) > 127 for c in tok)
    return {
        "provider": "vdsina",
        "configured": bool(tok),
        "api_base": s.api_base.rstrip("/"),
        "dotenv_path": str(dotenv_path()) if dotenv_configured() else None,
        "token_diagnostics": diag if tok else {"length": 0},
        "docs": "https://www.vdsina.com/tech/api",
        "troubleshoot_401": (
            "По умолчанию запросы идут на userapi.vdsina.com. Для аккаунта на vdsina.ru задайте "
            "VDSINA_API_BASE=https://userapi.vdsina.ru/v1 (или VDSINA_BASE_URL). "
            "401 также бывает при неверном токене User API (my.vdsina.com/account/api или my.vdsina.ru/account/api). "
            "Переменная VDSINA_API_TOKEN из среды ОС перекрывает .env."
        ),
    }


@router.get("/account")
async def vdsina_account() -> Any:
    try:
        return await _client().get_account()
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/account/balance")
async def vdsina_account_balance() -> Any:
    try:
        return await _client().get_account_balance()
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/account/limits")
async def vdsina_account_limits() -> Any:
    try:
        return await _client().get_account_limits()
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/catalog/datacenters")
async def vdsina_catalog_datacenters() -> Any:
    try:
        return await _client().list_datacenters()
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/catalog/server-groups")
async def vdsina_catalog_server_groups() -> Any:
    try:
        return await _client().list_server_groups()
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/catalog/server-plans/{group_id}")
async def vdsina_catalog_server_plans(group_id: int) -> Any:
    try:
        return await _client().list_server_plans(group_id)
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/catalog/templates")
async def vdsina_catalog_templates() -> Any:
    try:
        return await _client().list_templates()
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/ssh-keys")
async def vdsina_ssh_keys() -> Any:
    try:
        return await _client().list_ssh_keys()
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/servers")
async def vdsina_servers_list() -> Any:
    try:
        return await _client().list_servers()
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/servers/{server_id}")
async def vdsina_server_get(server_id: int) -> Any:
    try:
        return await _client().get_server(server_id)
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.get("/servers/{server_id}/root-password")
async def vdsina_server_root_password(server_id: int) -> dict[str, str]:
    """Пароль root из панели VDSina (GET /server.password/{id}). Не логировать и не кэшировать."""
    try:
        pwd = await _client().get_server_root_password(server_id)
        return {"password": pwd}
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.post("/servers")
async def vdsina_server_create(body: VdsinaCreateServerBody) -> dict[str, Any]:
    c = _client()
    payload = body.to_upstream_payload()
    try:
        sid = await c.create_server_with_autoprolong(payload, autoprolong=body.autoprolong)
        data = await c.get_server(sid)
        return {"id": sid, "server": data}
    except VdsinaUpstreamError as e:
        _raise_upstream(e)


@router.delete("/servers/{server_id}")
async def vdsina_server_delete(server_id: int) -> dict[str, bool]:
    try:
        await _client().delete_server(server_id)
        return {"ok": True}
    except VdsinaUpstreamError as e:
        _raise_upstream(e)
