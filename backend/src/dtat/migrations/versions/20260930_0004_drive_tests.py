"""drive tests

Drive test sessions (with the original file) and their per-second radio samples. measurement
is a TimescaleDB hypertable (weekly chunks, compressed after 30 days).

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "drive_session",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "source",
            sa.Enum(
                "netmonitor",
                "nemo",
                "app",
                name="drive_source",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("samples", sa.Integer(), nullable=False),
        sa.Column("distance_m", sa.Double(), nullable=False),
        sa.Column("plmn", sa.String(length=8), nullable=True),
        sa.Column("operator", sa.String(length=64), nullable=True),
        sa.Column("rx_bytes", sa.BigInteger(), nullable=True),
        sa.Column("tx_bytes", sa.BigInteger(), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("parser_version", sa.String(length=32), nullable=False),
        sa.Column("original_gz", sa.LargeBinary(), nullable=False),
        sa.Column("uploaded_by", sa.String(length=64), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "source IN ('netmonitor', 'nemo', 'app')", name=op.f("ck_drive_session_drive_source")
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["device.id"],
            name=op.f("fk_drive_session_device_id_device"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_drive_session")),
        sa.UniqueConstraint("sha256", name=op.f("uq_drive_session_sha256")),
    )
    op.create_table(
        "measurement",
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lat", sa.Double(), nullable=True),
        sa.Column("lon", sa.Double(), nullable=True),
        sa.Column("accuracy_m", sa.Double(), nullable=True),
        sa.Column("tech", sa.String(length=8), nullable=True),
        sa.Column("tac", sa.Integer(), nullable=True),
        sa.Column("enb_id", sa.Integer(), nullable=True),
        sa.Column("local_cell_id", sa.SmallInteger(), nullable=True),
        sa.Column("eci", sa.Integer(), nullable=True),
        sa.Column("pci", sa.SmallInteger(), nullable=True),
        sa.Column("earfcn", sa.Integer(), nullable=True),
        sa.Column("rsrp", sa.Double(), nullable=True),
        sa.Column("rsrq", sa.Double(), nullable=True),
        sa.Column("sinr", sa.Double(), nullable=True),
        sa.Column("neighbors", sa.SmallInteger(), nullable=True),
        sa.Column("best_neighbor_rsrp", sa.Double(), nullable=True),
        sa.Column("cell_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["drive_session.id"],
            name=op.f("fk_measurement_session_id_drive_session"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("session_id", "seq", "time", name=op.f("pk_measurement")),
    )
    op.create_index(
        "ix_measurement_session_time", "measurement", ["session_id", "time"], unique=False
    )
    op.execute(
        "SELECT create_hypertable('measurement', by_range('time', INTERVAL '7 days'), "
        "create_default_indexes => false)"
    )
    op.execute(
        "ALTER TABLE measurement SET (timescaledb.compress, "
        "timescaledb.compress_segmentby = 'session_id', timescaledb.compress_orderby = 'time, seq')"
    )
    op.execute("SELECT add_compression_policy('measurement', INTERVAL '30 days')")


def downgrade() -> None:
    op.drop_index("ix_measurement_session_time", table_name="measurement")
    op.drop_table("measurement")
    op.drop_table("drive_session")
