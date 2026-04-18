from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class MonitorServerConfig(BaseModel):
    proxy_port: int = Field(443, ge=1, le=65535)
    enabled: bool = True


class MonitorSettings(BaseModel):
    enabled: bool = False
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    check_interval_seconds: int = Field(60, ge=10, le=3600)
    connect_timeout_seconds: int = Field(10, ge=2, le=60)
    # Сколько последовательных неудач нужно, прежде чем отправить уведомление «вниз»
    failure_threshold: int = Field(2, ge=1, le=10)
    servers: dict[str, MonitorServerConfig] = Field(default_factory=dict)


class MonitorSettingsUpdate(BaseModel):
    enabled: bool = False
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    check_interval_seconds: int = Field(60, ge=10, le=3600)
    connect_timeout_seconds: int = Field(10, ge=2, le=60)
    failure_threshold: int = Field(2, ge=1, le=10)
    servers: dict[str, MonitorServerConfig] = Field(default_factory=dict)


ProxyStatus = Literal["up", "down", "unknown"]


class ServerCheckStatus(BaseModel):
    status: ProxyStatus = "unknown"
    last_check_ts: float | None = None
    last_change_ts: float | None = None
    consecutive_failures: int = 0
    last_error: str | None = None


class MonitorStatusResponse(BaseModel):
    running: bool
    servers: dict[str, ServerCheckStatus]
