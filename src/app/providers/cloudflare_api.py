from __future__ import annotations

import asyncio
import random
from typing import Any

import httpx

from app.cloudflare_settings import CloudflareSettings


class CloudflareApiError(Exception):
    def __init__(
        self,
        message: str,
        *,
        http_status: int | None = None,
        errors: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.http_status = http_status
        self.errors = errors or []


def fqdn_for_record(name: str, zone_name: str) -> str:
    """Имя записи для API: поддомен «proxy» → proxy.example.com; «@» или пусто → apex."""
    z = zone_name.strip().rstrip(".").lower()
    raw = (name or "").strip().rstrip(".").lower()
    if raw in ("", "@"):
        return z
    if raw == "*":
        return "*." + z
    if raw == z or raw.endswith("." + z):
        return raw
    if "." in raw:
        return raw
    return f"{raw}.{z}"


class CloudflareClient:
    """Клиент Cloudflare API v4 (DNS)."""

    def __init__(self, http: httpx.AsyncClient, settings: CloudflareSettings) -> None:
        self._http = http
        self._s = settings
        self._base = settings.api_base.rstrip("/")

    def _headers(self) -> dict[str, str]:
        tok = self._s.api_token.strip()
        if not tok:
            raise CloudflareApiError("Не задан CLOUDFLARE_API_TOKEN", http_status=None)
        return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    async def _request(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        url = f"{self._base}{path}" if path.startswith("/") else f"{self._base}/{path}"
        headers = self._headers()
        for attempt in range(4):
            try:
                r = await self._http.request(method, url, headers=headers, **kw)
            except httpx.RequestError as e:
                if attempt < 3:
                    await asyncio.sleep(0.2 * (2**attempt) + random.uniform(0, 0.08))
                    continue
                detail = str(e).strip() or e.__class__.__name__
                raise CloudflareApiError(
                    f"Сеть: {detail or 'сбой соединения с API Cloudflare (повторите попытку)'}",
                    http_status=None,
                ) from e
            try:
                body = r.json()
            except Exception:
                body = {"success": False, "errors": [{"message": r.text[:500]}]}
            if not isinstance(body, dict):
                raise CloudflareApiError("Некорректный JSON ответа", http_status=r.status_code)
            if not body.get("success"):
                errs = body.get("errors")
                em: list[dict[str, Any]] = errs if isinstance(errs, list) else []
                parts = [str(x.get("message") or x) for x in em if isinstance(x, dict)]
                msg = "; ".join(parts) if parts else str(body.get("errors", "ошибка API"))
                raise CloudflareApiError(msg, http_status=r.status_code, errors=em)
            return body

    async def verify_token(self) -> dict[str, Any]:
        return (await self._request("GET", "/user/tokens/verify")).get("result") or {}

    async def resolve_zone_id(self) -> tuple[str, str]:
        """Возвращает (zone_id, zone_name)."""
        zid = self._s.zone_id.strip()
        zname = self._s.zone_name.strip().lower().rstrip(".")
        if zid:
            body = await self._request("GET", f"/zones/{zid}")
            res = body.get("result")
            if not isinstance(res, dict):
                raise CloudflareApiError("Пустой result зоны", http_status=None)
            name = str(res.get("name") or zname or zid).lower().rstrip(".")
            return zid, name
        if not zname:
            raise CloudflareApiError("Задайте CLOUDFLARE_ZONE_ID или CLOUDFLARE_ZONE_NAME", http_status=None)
        body = await self._request("GET", "/zones", params={"name": zname, "status": "active"})
        res = body.get("result")
        if not isinstance(res, list) or not res:
            raise CloudflareApiError(f"Зона «{zname}» не найдена в аккаунте токена", http_status=None)
        z = res[0]
        if not isinstance(z, dict) or "id" not in z:
            raise CloudflareApiError("Некорректный ответ списка зон", http_status=None)
        return str(z["id"]), str(z.get("name") or zname).lower().rstrip(".")

    async def list_a_records(self, zone_id: str, record_name_fqdn: str) -> list[dict[str, Any]]:
        name = record_name_fqdn.strip().lower().rstrip(".")
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            body = await self._request(
                "GET",
                f"/zones/{zone_id}/dns_records",
                params={"type": "A", "name": name, "page": page, "per_page": 100},
            )
            res = body.get("result")
            if not isinstance(res, list):
                break
            out.extend([x for x in res if isinstance(x, dict)])
            info = body.get("result_info")
            total_pages = 1
            if isinstance(info, dict) and isinstance(info.get("total_pages"), int):
                total_pages = max(1, int(info["total_pages"]))
            if page >= total_pages:
                break
            page += 1
        return out

    async def list_all_a_records(self, zone_id: str) -> list[dict[str, Any]]:
        """Все A-записи зоны (постранично)."""
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            body = await self._request(
                "GET",
                f"/zones/{zone_id}/dns_records",
                params={"type": "A", "page": page, "per_page": 100},
            )
            res = body.get("result")
            if not isinstance(res, list):
                break
            out.extend([x for x in res if isinstance(x, dict)])
            info = body.get("result_info")
            total_pages = 1
            if isinstance(info, dict) and isinstance(info.get("total_pages"), int):
                total_pages = max(1, int(info["total_pages"]))
            if page >= total_pages:
                break
            page += 1
        return out

    async def create_a(
        self,
        zone_id: str,
        *,
        name_fqdn: str,
        content: str,
        proxied: bool,
        ttl: int,
    ) -> dict[str, Any]:
        payload = {
            "type": "A",
            "name": name_fqdn.lower().rstrip("."),
            "content": content,
            "proxied": proxied,
            "ttl": ttl,
        }
        body = await self._request("POST", f"/zones/{zone_id}/dns_records", json=payload)
        res = body.get("result")
        return res if isinstance(res, dict) else {}

    async def delete_record(self, zone_id: str, record_id: str) -> None:
        await self._request("DELETE", f"/zones/{zone_id}/dns_records/{record_id}")

    async def delete_dns_records_batch(
        self,
        zone_id: str,
        entries: list[tuple[str, str, str]],
        *,
        dry_run: bool,
    ) -> dict[str, Any]:
        """entries: (record_id, relative_name для лога, ip для лога)."""
        log: list[str] = []
        deleted: list[str] = []
        clean = [(a.strip(), b or "?", c or "?") for a, b, c in entries if isinstance(a, str) and a.strip()]
        if not clean:
            return {"dry_run": dry_run, "log": ["Нет записей для удаления."], "deleted_record_ids": []}
        for i, (rid, rel, ip) in enumerate(clean):
            if dry_run:
                log.append(f"[dry-run] Удалить A: id={rid}, поддомен={rel}, ip={ip}")
            else:
                await self.delete_record(zone_id, rid)
                log.append(f"Удалено A: id={rid}, поддомен={rel}, ip={ip}")
                deleted.append(rid)
                if i < len(clean) - 1:
                    await asyncio.sleep(0.15)
        return {"dry_run": dry_run, "log": log, "deleted_record_ids": deleted}

    async def sync_a_records(
        self,
        *,
        zone_id: str,
        zone_name: str,
        record_label: str,
        ips: list[str],
        proxied: bool,
        ttl: int,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        fqdn = fqdn_for_record(record_label, zone_name)
        existing = await self.list_a_records(zone_id, fqdn)
        desired = list(ips)
        by_content: dict[str, list[str]] = {}
        for rec in existing:
            rid = rec.get("id")
            content = rec.get("content")
            if not isinstance(rid, str) or not isinstance(content, str):
                continue
            by_content.setdefault(content, []).append(rid)

        id_to_row: dict[str, tuple[str, str]] = {}
        for rec in existing:
            rid = rec.get("id")
            content = rec.get("content")
            if isinstance(rid, str) and isinstance(content, str):
                id_to_row[rid] = (fqdn, content)

        to_delete: list[str] = []
        to_create: list[str] = []

        for ip, ids in by_content.items():
            if ip not in desired:
                to_delete.extend(ids)
            elif len(ids) > 1:
                to_delete.extend(ids[1:])

        have = {ip for ip in by_content if ip in desired and by_content[ip]}
        for ip in desired:
            if ip not in have:
                to_create.append(ip)

        deleted: list[str] = []
        created: list[str] = []
        log: list[str] = []

        for rid in to_delete:
            row = id_to_row.get(rid, (fqdn, "?"))
            if dry_run:
                log.append(f"[dry-run] Удалить A: id={rid}, name={row[0]}, ip={row[1]}")
            else:
                log.append(f"Удалено A: id={rid}, name={row[0]}, ip={row[1]}")

        for ip in to_create:
            if dry_run:
                log.append(f"[dry-run] Создать A: name={fqdn}, ip={ip}, proxied={proxied}, ttl={ttl}")
            else:
                log.append(f"Создано A: name={fqdn}, ip={ip}, proxied={proxied}, ttl={ttl}")

        if not log:
            log.append("Изменений нет: набор A уже совпадает с желаемыми IP.")

        if dry_run:
            return {
                "fqdn": fqdn,
                "dry_run": True,
                "would_delete": to_delete,
                "would_create": to_create,
                "desired": desired,
                "log": log,
            }

        for i, rid in enumerate(to_delete):
            await self.delete_record(zone_id, rid)
            deleted.append(rid)
            if i < len(to_delete) - 1:
                await asyncio.sleep(0.12)

        for i, ip in enumerate(to_create):
            await self.create_a(zone_id, name_fqdn=fqdn, content=ip, proxied=proxied, ttl=ttl)
            created.append(ip)
            if i < len(to_create) - 1:
                await asyncio.sleep(0.12)

        final = await self.list_a_records(zone_id, fqdn)
        final_ips = sorted({str(x.get("content")) for x in final if isinstance(x.get("content"), str)})

        return {
            "fqdn": fqdn,
            "dry_run": False,
            "deleted_record_ids": deleted,
            "created_ips": created,
            "desired": desired,
            "actual": final_ips,
            "log": log,
        }
