"""kpi statistics

Hourly KPI values from the operator's statistics, keyed by the operator's cell names and linked
to inventory cells. kpi_sample is a TimescaleDB hypertable (monthly chunks, compressed after
two months).

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.create_table(
        "kpi_file",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by", sa.String(length=64), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cells", sa.Integer(), nullable=False),
        sa.Column("samples", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_kpi_file")),
    )
    op.create_index(op.f("ix_kpi_file_sha256"), "kpi_file", ["sha256"], unique=False)
    op.create_table(
        "kpi_cell",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cell_name", sa.String(length=64), nullable=False),
        sa.Column("enb_name", sa.String(length=64), nullable=True),
        sa.Column("cell_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["cell_id"], ["cell.id"], name=op.f("fk_kpi_cell_cell_id_cell"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_kpi_cell")),
        sa.UniqueConstraint("cell_name", name=op.f("uq_kpi_cell_cell_name")),
    )
    op.create_index(op.f("ix_kpi_cell_cell_id"), "kpi_cell", ["cell_id"], unique=False)
    op.create_table(
        "kpi_sample",
        sa.Column("kpi_cell_id", sa.Integer(), nullable=False),
        sa.Column("kpi", sa.String(length=32), nullable=False),
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Double(), nullable=False),
        sa.ForeignKeyConstraint(
            ["kpi_cell_id"],
            ["kpi_cell.id"],
            name=op.f("fk_kpi_sample_kpi_cell_id_kpi_cell"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("kpi_cell_id", "kpi", "time", name=op.f("pk_kpi_sample")),
    )
    op.create_index("ix_kpi_sample_kpi_time", "kpi_sample", ["kpi", "time"], unique=False)
    op.execute(
        "SELECT create_hypertable('kpi_sample', by_range('time', INTERVAL '30 days'), "
        "create_default_indexes => false)"
    )
    op.execute(
        "ALTER TABLE kpi_sample SET (timescaledb.compress, "
        "timescaledb.compress_segmentby = 'kpi_cell_id, kpi', timescaledb.compress_orderby = 'time')"
    )
    op.execute("SELECT add_compression_policy('kpi_sample', INTERVAL '60 days')")


def downgrade() -> None:
    op.drop_index("ix_kpi_sample_kpi_time", table_name="kpi_sample")
    op.drop_table("kpi_sample")
    op.drop_index(op.f("ix_kpi_cell_cell_id"), table_name="kpi_cell")
    op.drop_table("kpi_cell")
    op.drop_index(op.f("ix_kpi_file_sha256"), table_name="kpi_file")
    op.drop_table("kpi_file")
