from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DOTENV_PATH = _REPO_ROOT / ".env"

_settings_kw: dict[str, Any] = {
    "env_prefix": "PANEL_",
    "env_file_encoding": "utf-8-sig",
    "extra": "ignore",
}
if _DOTENV_PATH.is_file():
    _settings_kw["env_file"] = _DOTENV_PATH


def _read_file_trim(path: str) -> str:
    p = Path(path)
    return p.read_text(encoding="utf-8").strip()


class PanelAuthSettings(BaseSettings):
    """Параметры JWT и входа в панель (префикс окружения PANEL_)."""

    model_config = SettingsConfigDict(**_settings_kw)

    auth_enabled: bool = Field(
        default=False,
        description="Включить защиту API и WebSocket (JWT в cookie или Authorization).",
    )
    jwt_secret: str = Field(default="", description="Секрет подписи JWT, минимум 32 байта.")
    jwt_secret_file: str = Field(
        default="",
        description="Путь к файлу с секретом (Docker secrets), перекрывает jwt_secret из .env.",
    )
    jwt_expire_minutes: int = Field(default=480, ge=5, le=60 * 24 * 14)
    admin_username: str = Field(default="admin", min_length=1, max_length=128)

    admin_password_hash: str = Field(
        default="",
        description="Хэш bcrypt для пароля администратора (рекомендуется).",
    )
    admin_password_hash_file: str = Field(
        default="",
        description="Путь к файлу с bcrypt-хэшем (Docker secrets).",
    )
    admin_password: str = Field(
        default="",
        description="Пароль в открытом виде (только для временной отладки; в продакшене не используйте).",
    )

    cookie_name: str = Field(default="telemt_panel_at", min_length=1, max_length=64)
    cookie_secure: bool = Field(
        default=False,
        description="Флаг Secure у cookie; за прокси с TLS включите и trust_forwarded_proto.",
    )
    cookie_samesite: str = Field(default="lax", description="lax | strict | none")

    trust_forwarded_proto: bool = Field(
        default=False,
        description="Доверять X-Forwarded-Proto при выставлении Secure cookie.",
    )

    cors_origins: str = Field(
        default="",
        description="Список Origin через запятую для CORS; пусто — middleware CORS не подключается.",
    )
    expose_openapi: bool = Field(
        default=False,
        description="Разрешить /docs и /openapi.json без аутентификации (не рекомендуется в продакшене).",
    )

    @field_validator("cookie_samesite", mode="before")
    @classmethod
    def _lower_samesite(cls, v: object) -> str:
        s = str(v or "").strip().lower()
        if s not in ("lax", "strict", "none"):
            return "lax"
        return s

    @model_validator(mode="after")
    def _load_secret_files(self) -> PanelAuthSettings:
        if self.jwt_secret_file.strip():
            path = self.jwt_secret_file.strip()
            self.jwt_secret = _read_file_trim(path)
        if self.admin_password_hash_file.strip():
            path = self.admin_password_hash_file.strip()
            self.admin_password_hash = _read_file_trim(path)
        return self

    def effective_jwt_secret(self) -> str:
        return (self.jwt_secret or "").strip()

    def effective_password_hash(self) -> str:
        return (self.admin_password_hash or "").strip()

    def effective_plain_password(self) -> str:
        return (self.admin_password or "").strip()

    def login_configured(self) -> bool:
        has_hash = bool(self.effective_password_hash())
        has_plain = bool(self.effective_plain_password())
        return has_hash or has_plain

    def auth_active(self) -> bool:
        if not self.auth_enabled:
            return False
        secret_ok = len(self.effective_jwt_secret()) >= 32
        return secret_ok and self.login_configured()


def get_panel_auth_settings() -> PanelAuthSettings:
    return PanelAuthSettings()


def forwarded_https_request(request_scheme: str, forwarded_proto: str | None) -> bool:
    if request_scheme.lower() == "https":
        return True
    if not forwarded_proto:
        return False
    return forwarded_proto.split(",")[0].strip().lower() == "https"
