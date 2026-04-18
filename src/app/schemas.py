from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator


class SSHAuth(BaseModel):
    host: str = Field(..., min_length=1, description="IP или hostname сервера")
    port: int = Field(22, ge=1, le=65535)
    username: str = Field(..., min_length=1)
    private_key: str | None = Field(
        default=None,
        description="Содержимое PEM/OpenSSH ключа (если без пароля SSH)",
    )
    private_key_passphrase: str | None = Field(
        default=None,
        description="Пароль от зашифрованного ключа",
    )
    password: str | None = Field(
        default=None,
        description="Пароль учётной записи SSH (если без ключа)",
    )

    @field_validator("private_key", "password", mode="before")
    @classmethod
    def empty_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        return s if s else None

    @model_validator(mode="after")
    def key_xor_password(self) -> SSHAuth:
        has_key = bool(self.private_key)
        has_pw = bool(self.password)
        if not has_key and not has_pw:
            raise ValueError("Укажите приватный ключ или пароль SSH")
        if has_key and has_pw:
            raise ValueError("Укажите только один способ входа: ключ или пароль SSH")
        return self


class TelemtUserEntry(BaseModel):
    username: str = Field(..., min_length=1, pattern=r"^[a-zA-Z0-9_-]+$")
    secret_hex: str = Field(..., min_length=32, max_length=32, pattern=r"^[0-9a-fA-F]{32}$")


class TelemtConfigPayload(BaseModel):
    public_host: str = Field(..., min_length=1)
    public_port: int = Field(443, ge=1, le=65535)
    server_port: int = Field(443, ge=1, le=65535)
    metrics_port: int = Field(9090, ge=1, le=65535)
    api_listen: str = Field("127.0.0.1:9091")
    tls_domain: str = Field(..., min_length=1)
    ad_tag: str = Field(..., min_length=32, max_length=32, pattern=r"^[0-9a-fA-F]{32}$")
    users: list[TelemtUserEntry] = Field(..., min_length=1)
    mode_classic: bool = False
    mode_secure: bool = False
    mode_tls: bool = True
    log_level: str = Field("normal", pattern=r"^(debug|verbose|normal|silent)$")
    metrics_whitelist: list[str] = Field(
        default_factory=lambda: ["127.0.0.1/32", "::1/128"]
    )
    api_whitelist: list[str] = Field(
        default_factory=lambda: ["127.0.0.1/32", "::1/128"]
    )

    @field_validator("users")
    @classmethod
    def unique_usernames(cls, v: list[TelemtUserEntry]) -> list[TelemtUserEntry]:
        names = [u.username for u in v]
        if len(names) != len(set(names)):
            raise ValueError("Имена пользователей в [access.users] должны быть уникальными")
        return v


class DeployOptions(BaseModel):
    apt_update_upgrade: bool = True
    sysctl_file_limits: bool = True
    sysctl_network: bool = True
    download_binary: bool = True
    binary_path: str = Field(
        "/bin/telemt",
        pattern=r"^(/bin/telemt|/usr/local/bin/telemt)$",
    )
    install_systemd: bool = True
    start_and_enable_service: bool = True
    verify_api: bool = True
    # Безопасность / шейпер (аналогично идеям из Reshala: UFW, f2b, sysctl, tc)
    install_ufw: bool = False
    install_fail2ban: bool = False
    kernel_hardening_sysctl: bool = False
    install_traffic_shaper: bool = False
    # Скачивание (клиент ← сервер): исходящий трафик, классификация по sport
    shaper_download_fast_mbytes_per_sec: float = Field(2.0, ge=0.125, le=125.0)
    shaper_download_slow_mbytes_per_sec: float = Field(1.0, ge=0.125, le=125.0)
    # Загрузка (клиент → сервер): ingress → IFB, классификация по dport
    shaper_upload_fast_mbytes_per_sec: float = Field(2.0, ge=0.125, le=125.0)
    shaper_upload_slow_mbytes_per_sec: float = Field(1.0, ge=0.125, le=125.0)
    shaper_fast_tcp_ports: list[int] = Field(
        default_factory=lambda: [443, 80, 8080, 8443]
    )
    ufw_extra_tcp_ports: list[int] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def legacy_shaper_mbytes(cls, data: object) -> object:
        """Старые поля shaper_*_mbytes_per_sec → скачивание и загрузка."""
        if not isinstance(data, dict):
            return data
        old_f = data.pop("shaper_fast_mbytes_per_sec", None)
        old_s = data.pop("shaper_slow_mbytes_per_sec", None)
        if old_f is not None and "shaper_download_fast_mbytes_per_sec" not in data:
            data["shaper_download_fast_mbytes_per_sec"] = old_f
        if old_s is not None and "shaper_download_slow_mbytes_per_sec" not in data:
            data["shaper_download_slow_mbytes_per_sec"] = old_s
        if old_f is not None and "shaper_upload_fast_mbytes_per_sec" not in data:
            data["shaper_upload_fast_mbytes_per_sec"] = old_f
        if old_s is not None and "shaper_upload_slow_mbytes_per_sec" not in data:
            data["shaper_upload_slow_mbytes_per_sec"] = old_s
        return data

    @field_validator("shaper_fast_tcp_ports", "ufw_extra_tcp_ports")
    @classmethod
    def ports_range(cls, v: list[int]) -> list[int]:
        for p in v:
            if not (1 <= int(p) <= 65535):
                raise ValueError(f"Недопустимый порт: {p}")
        return [int(x) for x in v]


class DeployRequest(BaseModel):
    ssh: SSHAuth
    telemt: TelemtConfigPayload
    options: DeployOptions = Field(default_factory=DeployOptions)


class SSHTestRequest(BaseModel):
    ssh: SSHAuth


class JournalStreamRequest(BaseModel):
    ssh: SSHAuth


class MetricsSnapshotRequest(BaseModel):
    """Снять снимок /metrics с выбранного сохранённого сервера по SSH."""

    server_id: str = Field(..., min_length=1)
    metrics_port: int = Field(9090, ge=1, le=65535)
