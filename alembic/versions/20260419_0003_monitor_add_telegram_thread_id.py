"""monitor_settings: добавлен столбец telegram_thread_id (ID топика супергруппы).

Revision ID: 20260419_0003
Revises: 20260419_0002
Create Date: 2026-04-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260419_0003"
down_revision: Union[str, None] = "20260419_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "monitor_settings",
        sa.Column(
            "telegram_thread_id",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
    )


def downgrade() -> None:
    op.drop_column("monitor_settings", "telegram_thread_id")
