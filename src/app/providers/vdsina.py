from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from app.cloud_settings import VdsinaSettings, get_vdsina_settings

logger = logging.getLogger(__name__)


class VdsinaUpstreamError(Exception):
    """Ошибка ответа User API VDSina."""

    def __init__(
        self,
        message: str,
        *,
        http_status: int | None = None,
        status_msg: str | None = None,
        description: str | None = None,
    ) -> None:
        super().__init__(message)
        self.http_status = http_status
        self.status_msg = status_msg
        self.description = description


def normalize_keys(obj: Any) -> Any:
    """Преобразует ключи JSON вида server-plan в server_plan (удобно для фронта)."""
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            nk = k.replace("-", "_") if isinstance(k, str) else k
            out[str(nk)] = normalize_keys(v)
        return out
    if isinstance(obj, list):
        return [normalize_keys(x) for x in obj]
    return obj


def _merge_error_message(status_msg: str | None, description: str | None) -> str:
    parts = [p for p in (status_msg, description) if p]
    return " — ".join(parts) if parts else "ошибка API VDSina"


def _format_vdsina_error_data(data: Any) -> str:
    """Текст из поля data ответа VDSina (часто dict поле → список сообщений)."""
    if data is None:
        return ""
    if isinstance(data, dict):
        parts: list[str] = []
        for k, v in data.items():
            if isinstance(v, list):
                parts.append(f"{k}: {', '.join(str(x) for x in v)}")
            else:
                parts.append(f"{k}: {v}")
        return "; ".join(parts)[:4000]
    if isinstance(data, list):
        return "; ".join(str(x) for x in data[:50])[:4000]
    return str(data)[:2000]


def _http_status_from_body(body: dict[str, Any]) -> int | None:
    sc = body.get("status_code")
    if isinstance(sc, int) and not isinstance(sc, bool):
        return sc
    if isinstance(sc, str) and sc.isdigit():
        return int(sc)
    return None


class VdsinaClient:
    """Асинхронный клиент User API VDSina (Bearer)."""

    def __init__(self, http: httpx.AsyncClient, settings: VdsinaSettings | None = None) -> None:
        self._http = http
        self._settings = settings or get_vdsina_settings()

    @property
    def configured(self) -> bool:
        return bool(self._settings.api_token.strip())

    def _url(self, path: str) -> str:
        base = self._settings.api_base.rstrip("/")
        if not path.startswith("/"):
            path = "/" + path
        return base + path

    async def _request_raw(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | list[Any] | None = None,
    ) -> tuple[int, Any]:
        if not self.configured:
            raise VdsinaUpstreamError("Не задан VDSINA_API_TOKEN", http_status=None)

        tok = self._settings.api_token.strip()
        headers = {
            "Authorization": f"Bearer {tok}",
            "Accept": "application/json",
        }
        if json_body is not None:
            headers["Content-Type"] = "application/json"

        try:
            r = await self._http.request(method, self._url(path), headers=headers, json=json_body)
        except httpx.RequestError as e:
            raise VdsinaUpstreamError(f"Сеть: {e}") from e

        try:
            body: Any = r.json()
        except json.JSONDecodeError:
            text = (r.text or "")[:4000]
            raise VdsinaUpstreamError(
                f"Некорректный JSON (HTTP {r.status_code}): {text}",
                http_status=r.status_code,
            ) from None

        if r.status_code >= 400:
            if isinstance(body, dict):
                sm = body.get("status_msg")
                desc = body.get("description")
                msg = _merge_error_message(
                    str(sm) if sm is not None else None,
                    str(desc) if desc is not None else None,
                )
                extra = _format_vdsina_error_data(body.get("data"))
                if extra:
                    msg = f"{msg} | {extra}" if msg else extra
                raise VdsinaUpstreamError(
                    msg or f"HTTP {r.status_code}",
                    http_status=r.status_code,
                    status_msg=str(sm) if sm is not None else None,
                    description=str(desc) if desc is not None else None,
                )
            raise VdsinaUpstreamError(f"HTTP {r.status_code}", http_status=r.status_code)

        if not isinstance(body, dict):
            raise VdsinaUpstreamError("Ответ API: ожидался объект JSON", http_status=r.status_code)

        return r.status_code, body

    def _unwrap_ok(self, body: dict[str, Any], *, empty_servers_ok: bool = False) -> Any:
        status = body.get("status")
        status_msg = str(body.get("status_msg") or "")
        if status == "ok":
            return body.get("data")
        if empty_servers_ok and status_msg == "No Server information":
            return []
        msg = _merge_error_message(status_msg, str(body.get("description") or "") or None)
        extra = _format_vdsina_error_data(body.get("data"))
        if extra:
            msg = f"{msg} | {extra}" if msg else extra
        http_int = _http_status_from_body(body)
        raise VdsinaUpstreamError(
            msg or "ошибка API VDSina",
            http_status=http_int,
            status_msg=status_msg or None,
            description=str(body.get("description")) if body.get("description") is not None else None,
        )

    async def get_account(self) -> Any:
        _, body = await self._request_raw("GET", "/account")
        return normalize_keys(self._unwrap_ok(body))

    async def get_account_balance(self) -> Any:
        _, body = await self._request_raw("GET", "/account.balance")
        return normalize_keys(self._unwrap_ok(body))

    async def get_account_limits(self) -> Any:
        _, body = await self._request_raw("GET", "/account.limit")
        return normalize_keys(self._unwrap_ok(body))

    async def list_datacenters(self) -> Any:
        _, body = await self._request_raw("GET", "/datacenter")
        return normalize_keys(self._unwrap_ok(body))

    async def list_server_groups(self) -> Any:
        _, body = await self._request_raw("GET", "/server-group")
        return normalize_keys(self._unwrap_ok(body))

    async def list_server_plans(self, group_id: int) -> Any:
        _, body = await self._request_raw("GET", f"/server-plan/{int(group_id)}")
        return normalize_keys(self._unwrap_ok(body))

    async def list_templates(self) -> Any:
        _, body = await self._request_raw("GET", "/template")
        return normalize_keys(self._unwrap_ok(body))

    async def list_ssh_keys(self) -> Any:
        _, body = await self._request_raw("GET", "/ssh-key")
        return normalize_keys(self._unwrap_ok(body))

    async def list_servers(self) -> Any:
        _, body = await self._request_raw("GET", "/server", json_body=None)
        data = self._unwrap_ok(body, empty_servers_ok=True)
        if data is None:
            return []
        return normalize_keys(data)

    async def get_server(self, server_id: int) -> Any:
        _, body = await self._request_raw("GET", f"/server/{int(server_id)}")
        return normalize_keys(self._unwrap_ok(body))

    async def get_server_root_password(self, server_id: int) -> str:
        """Пароль root по User API: GET /server.password/{id}."""
        _, body = await self._request_raw("GET", f"/server.password/{int(server_id)}")
        data = self._unwrap_ok(body)
        if not isinstance(data, dict):
            raise VdsinaUpstreamError("Ответ API: нет объекта data с паролем")
        pw = data.get("password")
        if pw is None or not str(pw).strip():
            raise VdsinaUpstreamError("Пароль в ответе API пустой (сервер ещё создаётся или недоступен)")
        return str(pw).strip()

    async def create_server(self, payload: dict[str, Any]) -> int:
        _, body = await self._request_raw("POST", "/server", json_body=payload)
        data = self._unwrap_ok(body)
        if not isinstance(data, dict) or "id" not in data:
            raise VdsinaUpstreamError("Создание сервера: в ответе нет id")
        return int(data["id"])

    async def set_autoprolong(self, server_id: int, enabled: bool) -> None:
        val = "1" if enabled else "0"
        _, body = await self._request_raw("PUT", f"/server/{int(server_id)}", json_body={"autoprolong": val})
        self._unwrap_ok(body)

    async def delete_server(self, server_id: int) -> None:
        _, body = await self._request_raw("DELETE", f"/server/{int(server_id)}")
        self._unwrap_ok(body)

    async def create_server_with_autoprolong(
        self,
        payload: dict[str, Any],
        *,
        autoprolong: bool,
        post_create_delay_sec: float = 2.0,
    ) -> int:
        """
        Создаёт VPS и при необходимости отключает автопродление (как в Terraform-провайдере: небольшая пауза перед PUT).
        """
        sid = await self.create_server(payload)
        if not autoprolong:
            await asyncio.sleep(post_create_delay_sec)
            try:
                await self.set_autoprolong(sid, False)
            except VdsinaUpstreamError:
                logger.warning("Не удалось отключить autoprolong для сервера %s сразу после создания", sid)
        return sid
