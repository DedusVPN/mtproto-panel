"""monitor_settings: добавлен столбец telegram_api_base_url.

Revision ID: 20260419_0002
Revises: 20260419_0001
Create Date: 2026-04-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260419_0002"
down_revision: Union[str, None] = "20260419_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "monitor_settings",
        sa.Column(
            "telegram_api_base_url",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
    )


def downgrade() -> None:
    op.drop_column("monitor_settings", "telegram_api_base_url")
