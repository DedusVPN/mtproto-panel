"""Начальная схема: servers, metrics_points, monitor_settings.

Revision ID: 20260419_0001
Revises:
Create Date: 2026-04-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260419_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "servers",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("host", sa.Text(), nullable=False),
        sa.Column("port", sa.Integer(), server_default=sa.text("22"), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("auth_mode", sa.String(length=16), nullable=False),
        sa.Column("private_key", sa.Text(), nullable=True),
        sa.Column("private_key_passphrase", sa.Text(), nullable=True),
        sa.Column("password", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "metrics_points",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("server_id", sa.String(length=64), nullable=False),
        sa.Column("t", sa.Float(), nullable=False),
        sa.Column("m", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_metrics_points_server_id_t", "metrics_points", ["server_id", "t"], unique=False)
    op.create_table(
        "monitor_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("telegram_bot_token", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("telegram_chat_id", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("check_interval_seconds", sa.Integer(), server_default=sa.text("60"), nullable=False),
        sa.Column("connect_timeout_seconds", sa.Integer(), server_default=sa.text("10"), nullable=False),
        sa.Column("failure_threshold", sa.Integer(), server_default=sa.text("2"), nullable=False),
        sa.Column(
            "servers_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("monitor_settings")
    op.drop_index("ix_metrics_points_server_id_t", table_name="metrics_points")
    op.drop_table("metrics_points")
    op.drop_table("servers")
