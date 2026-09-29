"""cell installation site

A cell's antenna may be installed away from its eNodeB (remote radio units, DAS in another
building): cell.site_id holds the installation site. Existing cells get their eNodeB's site.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cell", sa.Column("site_id", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE cell SET site_id = enodeb.site_id FROM enodeb WHERE enodeb.id = cell.enodeb_id"
    )
    op.alter_column("cell", "site_id", nullable=False)
    op.create_index(op.f("ix_cell_site_id"), "cell", ["site_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_cell_site_id_site"), "cell", "site", ["site_id"], ["id"], ondelete="RESTRICT"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_cell_site_id_site"), "cell", type_="foreignkey")
    op.drop_index(op.f("ix_cell_site_id"), table_name="cell")
    op.drop_column("cell", "site_id")
