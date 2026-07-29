"""add conversation_status to contacts

Revision ID: 0009_conversation_status
Revises: 0008_plugin_installed_deps
Create Date: 2026-07-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009_conversation_status"
down_revision: Union[str, Sequence[str], None] = "0008_plugin_installed_deps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("conversation_status", sa.Text, nullable=False, server_default="open"),
    )


def downgrade() -> None:
    op.drop_column("contacts", "conversation_status")
