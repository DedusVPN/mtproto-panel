from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class ServerRow(Base):
    __tablename__ = "servers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    host: Mapped[str] = mapped_column(Text, nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("22"))
    username: Mapped[str] = mapped_column(Text, nullable=False)
    auth_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    private_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    private_key_passphrase: Mapped[str | None] = mapped_column(Text, nullable=True)
    password: Mapped[str | None] = mapped_column(Text, nullable=True)

    metrics_points: Mapped[list["MetricsPointRow"]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class MetricsPointRow(Base):
    __tablename__ = "metrics_points"
    __table_args__ = (Index("ix_metrics_points_server_id_t", "server_id", "t"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    server_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
    )
    t: Mapped[float] = mapped_column(nullable=False)
    m: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    server: Mapped["ServerRow"] = relationship(back_populates="metrics_points")


class MonitorSettingsRow(Base):
    __tablename__ = "monitor_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    telegram_bot_token: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    telegram_chat_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    telegram_api_base_url: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    check_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("60"))
    connect_timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("10"))
    failure_threshold: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("2"))
    servers_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
