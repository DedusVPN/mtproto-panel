from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DOTENV_PATH = _REPO_ROOT / ".env"

# По умолчанию User API для vdsina.com; для аккаунта на vdsina.ru задайте VDSINA_API_BASE=https://userapi.vdsina.ru/v1
DEFAULT_VDSINA_API_BASE = "https://userapi.vdsina.com/v1"

# Загружаем .env из корня репозитория (не из cwd), чтобы токен находился при запуске uvicorn из любой папки.
_settings_kw: dict = {
    "env_prefix": "VDSINA_",
    "env_file_encoding": "utf-8-sig",
    "extra": "ignore",
}
if _DOTENV_PATH.is_file():
    _settings_kw["env_file"] = _DOTENV_PATH


def dotenv_path() -> Path:
    return _DOTENV_PATH


def dotenv_configured() -> bool:
    return _DOTENV_PATH.is_file()


def read_dotenv_raw_value(key: str) -> str | None:
    """Читает KEY=… из .env в корне проекта (без подстановки в os.environ)."""
    if not _DOTENV_PATH.is_file():
        return None
    try:
        raw = _DOTENV_PATH.read_text(encoding="utf-8-sig")
    except OSError:
        return None
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        if k.strip() != key:
            continue
        val = v.strip()
        if len(val) >= 2 and ((val[0] == val[-1] == '"') or (val[0] == val[-1] == "'")):
            val = val[1:-1].strip()
        return val
    return None


class VdsinaSettings(BaseSettings):
    """Настройки VDSina User API (токен: my.vdsina.com/account/api или my.vdsina.ru/account/api)."""

    model_config = SettingsConfigDict(**_settings_kw)

    api_token: str = Field(default="", description="Bearer-токен User API")
    api_base: str = Field(default=DEFAULT_VDSINA_API_BASE, description="Базовый URL User API")

    @model_validator(mode="before")
    @classmethod
    def terraform_base_url(cls, data: Any) -> Any:
        """
        Terraform-провайдер использует VDSINA_BASE_URL; pydantic по полю api_base читает только VDSINA_API_BASE.
        Подхватываем legacy-переменную из окружения и из .env, если api_base ещё не задан.
        """
        d = dict(data) if isinstance(data, dict) else {}
        cur = (d.get("api_base") or "").strip()
        if not cur:
            legacy = (os.environ.get("VDSINA_BASE_URL") or "").strip()
            if not legacy:
                legacy = (read_dotenv_raw_value("VDSINA_BASE_URL") or "").strip()
            if legacy:
                d["api_base"] = legacy
        return d

    @field_validator("api_token", mode="before")
    @classmethod
    def normalize_api_token(cls, v: object) -> str:
        if v is None:
            return ""
        s = str(v).strip()
        # UTF-16LE / ошибки копирования: нулевые байты и «невидимые» символы
        s = s.replace("\x00", "")
        for ch in ("\ufeff", "\u200b", "\u200c", "\u200d", "\u2060"):
            s = s.replace(ch, "")
        # Частая ошибка: вставили целиком «Bearer xxx», а мы добавляем Bearer ещё раз.
        s = re.sub(r"(?i)^Bearer\s+", "", s).strip()
        if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
            s = s[1:-1].strip()
        return s

    @field_validator("api_base", mode="after")
    @classmethod
    def normalize_api_base(cls, v: str) -> str:
        s = (v or "").strip().rstrip("/")
        return s or DEFAULT_VDSINA_API_BASE


def get_vdsina_settings() -> VdsinaSettings:
    """Без кэша: при смене .env / переменных окружения и --reload подхватываются актуальные значения."""
    return VdsinaSettings()
