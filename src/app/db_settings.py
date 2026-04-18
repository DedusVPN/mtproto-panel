from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DOTENV_PATH = _REPO_ROOT / ".env"

_kw: dict[str, Any] = {
    "env_file_encoding": "utf-8-sig",
    "extra": "ignore",
}
if _DOTENV_PATH.is_file():
    _kw["env_file"] = _DOTENV_PATH


class DatabaseSettings(BaseSettings):
    """Строка подключения async SQLAlchemy (postgresql+asyncpg://…)."""

    model_config = SettingsConfigDict(**_kw)

    database_url: str = Field(
        default="postgresql+asyncpg://panel:panel@localhost:5432/panel",
        validation_alias="DATABASE_URL",
    )


def get_database_settings() -> DatabaseSettings:
    return DatabaseSettings()
