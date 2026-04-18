from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DOTENV_PATH = _REPO_ROOT / ".env"

_settings_kw: dict[str, Any] = {
    "env_prefix": "CLOUDFLARE_",
    "env_file_encoding": "utf-8-sig",
    "extra": "ignore",
}
if _DOTENV_PATH.is_file():
    _settings_kw["env_file"] = _DOTENV_PATH


class CloudflareSettings(BaseSettings):
    """Токен и зона Cloudflare для DNS API."""

    model_config = SettingsConfigDict(**_settings_kw)

    api_token: str = Field(default="", description="API Token с правами Zone.DNS Edit + Zone.Zone Read")
    api_base: str = Field(
        default="https://api.cloudflare.com/client/v4",
        description="Базовый URL API v4",
    )
    zone_id: str = Field(default="", description="Идентификатор зоны (предпочтительно)")
    zone_name: str = Field(default="", description="Корневой домен зоны, если zone_id не задан")

    @field_validator("api_token", mode="before")
    @classmethod
    def normalize_api_token(cls, v: object) -> str:
        if v is None:
            return ""
        s = str(v).strip().replace("\x00", "")
        for ch in ("\ufeff", "\u200b", "\u200c", "\u200d", "\u2060"):
            s = s.replace(ch, "")
        s = re.sub(r"(?i)^Bearer\s+", "", s).strip()
        if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
            s = s[1:-1].strip()
        return s

    @field_validator("api_base", mode="after")
    @classmethod
    def normalize_api_base(cls, v: str) -> str:
        return (v or "").strip().rstrip("/") or "https://api.cloudflare.com/client/v4"

    @field_validator("zone_id", "zone_name", mode="before")
    @classmethod
    def strip_str(cls, v: object) -> str:
        if v is None:
            return ""
        return str(v).strip()

    @model_validator(mode="after")
    def zone_hint(self) -> CloudflareSettings:
        return self


def get_cloudflare_settings() -> CloudflareSettings:
    return CloudflareSettings()
