from __future__ import annotations

import ipaddress
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def normalize_ipv4_unique_list(v: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in v:
        s = str(raw).strip()
        if not s:
            continue
        try:
            addr = ipaddress.ip_address(s)
        except ValueError as e:
            raise ValueError(f"Некорректный IP: {raw!r}") from e
        if addr.version != 4:
            raise ValueError(f"Поддерживаются только A-записи (IPv4): {raw!r}")
        t = str(addr)
        if t not in seen:
            seen.add(t)
            out.append(t)
    if not out:
        raise ValueError("Список ips пуст после нормализации")
    return out


class CloudflarePanelDnsRow(BaseModel):
    """Сервер панели и желаемый поддомен (относительно зоны Cloudflare)."""

    model_config = ConfigDict(extra="ignore")

    server_id: Annotated[str, Field(..., min_length=1)]
    name: Annotated[str, Field(..., min_length=1, max_length=253)]

    @field_validator("server_id", "name", mode="after")
    @classmethod
    def strip_fields(cls, v: str) -> str:
        return v.strip()


class CloudflareDeleteDnsRecordRow(BaseModel):
    """Строка из сводки для удаления A по id (имя и IP — только для лога)."""

    model_config = ConfigDict(extra="ignore")

    id: Annotated[str, Field(..., min_length=1)]
    relative_name: str = ""
    content: str = ""

    @field_validator("id", "relative_name", "content", mode="after")
    @classmethod
    def strip_fields(cls, v: str) -> str:
        return str(v).strip()


class CloudflareDeleteDnsRecordsRequest(BaseModel):
    records: Annotated[list[CloudflareDeleteDnsRecordRow], Field(min_length=1, max_length=100)]
    dry_run: bool = False


class CloudflareSyncPanelServersRequest(BaseModel):
    """
    Желаемое состояние A-записей по серверам панели.

    Несколько строк с одним поддоменом дают несколько A на одно имя (несколько IP).
    """

    model_config = ConfigDict(extra="ignore")

    items: Annotated[list[CloudflarePanelDnsRow], Field(min_length=1)]
    proxied: bool = False
    ttl: int = Field(
        60,
        ge=1,
        le=86400,
        description="1 = авто в Cloudflare; иначе 60–86400 с (минимум ручного TTL — 60)",
    )
    dry_run: bool = False

    @model_validator(mode="after")
    def ttl_cloudflare_rules(self) -> CloudflareSyncPanelServersRequest:
        t = self.ttl
        if t == 1:
            return self
        if t < 60:
            raise ValueError("TTL: либо 1 (авто), либо не меньше 60 секунд (требование Cloudflare)")
        if t > 86400:
            raise ValueError("TTL не больше 86400 с")
        return self
