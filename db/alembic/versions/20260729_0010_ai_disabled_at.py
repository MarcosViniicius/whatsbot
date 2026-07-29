"""add ai_disabled_at to contacts

Revision ID: 0010_ai_disabled_at
Revises: 0009_conversation_status
Create Date: 2026-07-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_ai_disabled_at"
down_revision: Union[str, Sequence[str], None] = "0009_conversation_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("ai_disabled_at", sa.Float, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("contacts", "ai_disabled_at")
