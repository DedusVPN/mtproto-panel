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


class CloudflareDnsTarget(BaseModel):
    """Одна логическая A-запись: поддомен относительно зоны и один или несколько IPv4."""

    model_config = ConfigDict(extra="ignore")

    name: Annotated[str, Field(..., min_length=1, max_length=253, description="Поддомен (proxy) или @ для apex")]
    ips: Annotated[list[str], Field(..., min_length=1, max_length=50)]
    proxied: bool = False
    ttl: int = Field(1, ge=1, le=2147483647, description="1 = Auto в Cloudflare")

    @field_validator("name", mode="after")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()

    @field_validator("ips", mode="after")
    @classmethod
    def validate_ipv4_list(cls, v: list[str]) -> list[str]:
        return normalize_ipv4_unique_list(v)

    @model_validator(mode="after")
    def proxied_multi_ip(self) -> CloudflareDnsTarget:
        if self.proxied and len(self.ips) > 1:
            raise ValueError("Несколько IPv4 на одно имя несовместимо с proxied=true (оранжевое облако)")
        return self


class CloudflareSyncARequest(BaseModel):
    """Ручная синхронизация A-записей для одного имени (как в UI)."""

    model_config = ConfigDict(extra="ignore")

    name: Annotated[str, Field(..., min_length=1, max_length=253)]
    ips: Annotated[list[str], Field(..., min_length=1)]
    proxied: bool = False
    ttl: int = Field(1, ge=1, le=2147483647)

    @field_validator("name", mode="after")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()

    @field_validator("ips", mode="after")
    @classmethod
    def validate_ips(cls, v: list[str]) -> list[str]:
        return normalize_ipv4_unique_list(v)

    @model_validator(mode="after")
    def proxied_rule(self) -> CloudflareSyncARequest:
        if self.proxied and len(self.ips) > 1:
            raise ValueError("Несколько IPv4 на одно имя несовместимо с proxied=true")
        return self


class CloudflarePanelDnsRow(BaseModel):
    """Сервер панели и желаемый поддомен (относительно зоны Cloudflare)."""

    model_config = ConfigDict(extra="ignore")

    server_id: Annotated[str, Field(..., min_length=1)]
    name: Annotated[str, Field(..., min_length=1, max_length=253)]

    @field_validator("server_id", "name", mode="after")
    @classmethod
    def strip_fields(cls, v: str) -> str:
        return v.strip()


class CloudflareSyncPanelServersRequest(BaseModel):
    """
    DNS по серверам из панели.

    Режим 1 — поле items: каждая строка «server_id + поддомен»; одинаковые поддомены склеиваются
    в несколько A на одно имя (несколько серверов → один хостнейм, несколько IP).

    Режим 2 — union_subdomain + server_ids: все IPv4 выбранных серверов в одну A-группу с этим именем.
    """

    model_config = ConfigDict(extra="ignore")

    items: list[CloudflarePanelDnsRow] = Field(default_factory=list)
    union_subdomain: str | None = None
    server_ids: list[str] = Field(default_factory=list)
    proxied: bool = False
    ttl: int = Field(1, ge=1, le=2147483647)
    dry_run: bool = False

    @model_validator(mode="after")
    def mode_ok(self) -> CloudflareSyncPanelServersRequest:
        us = (self.union_subdomain or "").strip()
        if us:
            if not self.server_ids:
                raise ValueError("В режиме одного поддомена задайте непустой список server_ids")
            if self.items:
                raise ValueError("Нельзя одновременно передавать items и union_subdomain")
        else:
            if not self.items:
                raise ValueError("Задайте items или пару union_subdomain + server_ids")
        return self

    def union_name(self) -> str:
        return (self.union_subdomain or "").strip()
