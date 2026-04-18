from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas import SSHAuth


AuthMode = Literal["key", "password"]


class ServerListItem(BaseModel):
    id: str
    name: str
    host: str
    port: int = 22
    username: str
    auth_mode: AuthMode


class StoredServer(BaseModel):
    id: str
    name: str = Field(..., min_length=1)
    host: str = Field(..., min_length=1)
    port: int = Field(22, ge=1, le=65535)
    username: str = Field(..., min_length=1)
    auth_mode: AuthMode
    private_key: str | None = None
    private_key_passphrase: str | None = None
    password: str | None = None

    @model_validator(mode="after")
    def credentials_match_mode(self) -> StoredServer:
        if self.auth_mode == "key":
            if not (self.private_key or "").strip():
                raise ValueError("Для входа по ключу нужен private_key")
            self.password = None
        else:
            if not (self.password or "").strip():
                raise ValueError("Для входа по паролю нужен password")
            self.private_key = None
            self.private_key_passphrase = None
        return self

    def to_ssh_auth(self) -> SSHAuth:
        if self.auth_mode == "key":
            return SSHAuth(
                host=self.host,
                port=self.port,
                username=self.username,
                private_key=(self.private_key or "").strip(),
                private_key_passphrase=self.private_key_passphrase,
                password=None,
            )
        return SSHAuth(
            host=self.host,
            port=self.port,
            username=self.username,
            private_key=None,
            private_key_passphrase=None,
            password=(self.password or "").strip(),
        )


class StoredServerCreate(BaseModel):
    name: str = Field(..., min_length=1)
    host: str = Field(..., min_length=1)
    port: int = Field(22, ge=1, le=65535)
    username: str = Field(..., min_length=1)
    auth_mode: AuthMode
    private_key: str | None = None
    private_key_passphrase: str | None = None
    password: str | None = None

    @model_validator(mode="after")
    def credentials_match_mode(self) -> StoredServerCreate:
        if self.auth_mode == "key":
            if not (self.private_key or "").strip():
                raise ValueError("Для входа по ключу нужен private_key")
        else:
            if not (self.password or "").strip():
                raise ValueError("Для входа по паролю нужен password")
        return self


class StoredServerUpdate(BaseModel):
    """Полная замена полей сервера (клиент подставляет текущие секреты или новые)."""

    name: str = Field(..., min_length=1)
    host: str = Field(..., min_length=1)
    port: int = Field(22, ge=1, le=65535)
    username: str = Field(..., min_length=1)
    auth_mode: AuthMode
    private_key: str | None = None
    private_key_passphrase: str | None = None
    password: str | None = None

    @model_validator(mode="after")
    def credentials_match_mode(self) -> StoredServerUpdate:
        if self.auth_mode == "key":
            if not (self.private_key or "").strip():
                raise ValueError("Для входа по ключу нужен private_key")
        else:
            if not (self.password or "").strip():
                raise ValueError("Для входа по паролю нужен password")
        return self
