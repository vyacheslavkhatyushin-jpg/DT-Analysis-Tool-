"""initial inventory schema

Revision ID: 0001
Revises:
Create Date: 2026-09-29 05:15:44.909720
"""

from collections.abc import Sequence

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    # btree_gist: exclusion constraints that forbid overlapping validity periods.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "app_user",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.String(length=128), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "admin",
                "engineer",
                "viewer",
                name="user_role",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "role IN ('admin', 'engineer', 'viewer')", name=op.f("ck_app_user_user_role")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_user")),
        sa.UniqueConstraint("username", name=op.f("uq_app_user_username")),
    )
    op.create_table(
        "asset",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "haul_truck",
                "excavator",
                "drill",
                "dozer",
                "loader",
                "light_vehicle",
                "other",
                name="asset_kind",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('haul_truck', 'excavator', 'drill', 'dozer', 'loader', 'light_vehicle', 'other')",
            name=op.f("ck_asset_asset_kind"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_asset")),
        sa.UniqueConstraint("name", name=op.f("uq_asset_name")),
    )
    op.create_table(
        "map_overlay",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("visible_by_default", sa.Boolean(), nullable=False),
        sa.Column("geojson", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_map_overlay")),
        sa.UniqueConstraint("name", name=op.f("uq_map_overlay_name")),
    )
    op.create_table(
        "site",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=True),
        sa.Column(
            "kind",
            sa.Enum(
                "stationary",
                "mobile",
                name="site_kind",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "planned",
                "active",
                "inactive",
                "dismantled",
                name="site_status",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("lat", sa.Double(), nullable=False),
        sa.Column("lon", sa.Double(), nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.types.Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            sa.Computed("ST_SetSRID(ST_MakePoint(lon, lat), 4326)", persisted=True),
            nullable=False,
        ),
        sa.Column("structure_type", sa.String(length=32), nullable=True),
        sa.Column("structure_height_m", sa.Double(), nullable=True),
        sa.Column("ground_elevation_m", sa.Double(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('stationary', 'mobile')", name=op.f("ck_site_site_kind")),
        sa.CheckConstraint(
            "status IN ('planned', 'active', 'inactive', 'dismantled')",
            name=op.f("ck_site_site_status"),
        ),
        sa.CheckConstraint("lat BETWEEN -90 AND 90", name=op.f("ck_site_lat_range")),
        sa.CheckConstraint("lon BETWEEN -180 AND 180", name=op.f("ck_site_lon_range")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_site")),
        sa.UniqueConstraint("code", name=op.f("uq_site_code")),
    )
    op.create_index("ix_site_geom", "site", ["geom"], unique=False, postgresql_using="gist")
    op.create_table(
        "change_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "ts", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column(
            "source",
            sa.Enum(
                "ui",
                "import",
                "api",
                "system",
                name="change_source",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("entity_label", sa.String(length=128), nullable=True),
        sa.Column(
            "action",
            sa.Enum(
                "create",
                "update",
                "delete",
                name="change_action",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "action IN ('create', 'update', 'delete')", name=op.f("ck_change_log_change_action")
        ),
        sa.CheckConstraint(
            "source IN ('ui', 'import', 'api', 'system')", name=op.f("ck_change_log_change_source")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name=op.f("fk_change_log_user_id_app_user"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_change_log")),
    )
    op.create_index(
        "ix_change_log_entity", "change_log", ["entity_type", "entity_id"], unique=False
    )
    op.create_index(op.f("ix_change_log_ts"), "change_log", ["ts"], unique=False)
    op.create_table(
        "device",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "phone",
                "router",
                "radio",
                "probe",
                "other",
                name="device_kind",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "planned",
                "active",
                "inactive",
                "dismantled",
                name="device_status",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("imei", sa.String(length=15), nullable=True),
        sa.Column("imsi", sa.String(length=15), nullable=True),
        sa.Column("iccid", sa.String(length=22), nullable=True),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column("asset_id", sa.Integer(), nullable=True),
        sa.Column("role", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('phone', 'router', 'radio', 'probe', 'other')",
            name=op.f("ck_device_device_kind"),
        ),
        sa.CheckConstraint(
            "status IN ('planned', 'active', 'inactive', 'dismantled')",
            name=op.f("ck_device_device_status"),
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["asset.id"], name=op.f("fk_device_asset_id_asset"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device")),
        sa.UniqueConstraint("imei", name=op.f("uq_device_imei")),
        sa.UniqueConstraint("name", name=op.f("uq_device_name")),
    )
    op.create_table(
        "enodeb",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("enb_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=True),
        sa.Column("vendor", sa.String(length=32), nullable=True),
        sa.Column("hw_model", sa.String(length=64), nullable=True),
        sa.Column("sw_version", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "planned",
                "active",
                "inactive",
                "dismantled",
                name="enodeb_status",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('planned', 'active', 'inactive', 'dismantled')",
            name=op.f("ck_enodeb_enodeb_status"),
        ),
        sa.CheckConstraint("enb_id BETWEEN 0 AND 1048575", name=op.f("ck_enodeb_enb_id_range")),
        sa.ForeignKeyConstraint(
            ["site_id"], ["site.id"], name=op.f("fk_enodeb_site_id_site"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_enodeb")),
        sa.UniqueConstraint("enb_id", name=op.f("uq_enodeb_enb_id")),
    )
    op.create_index(op.f("ix_enodeb_site_id"), "enodeb", ["site_id"], unique=False)
    op.create_table(
        "site_position",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("lat", sa.Double(), nullable=False),
        sa.Column("lon", sa.Double(), nullable=False),
        sa.Column("valid_period", postgresql.TSTZRANGE(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        postgresql.ExcludeConstraint(
            (sa.column("site_id"), "="),
            (sa.column("valid_period"), "&&"),
            using="gist",
            name="site_position_no_overlap",
        ),
        sa.ForeignKeyConstraint(
            ["site_id"], ["site.id"], name=op.f("fk_site_position_site_id_site"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_site_position")),
    )
    op.create_index(op.f("ix_site_position_site_id"), "site_position", ["site_id"], unique=False)
    op.create_table(
        "cell",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enodeb_id", sa.Integer(), nullable=False),
        sa.Column("local_cell_id", sa.Integer(), nullable=False),
        sa.Column("eci", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "planned",
                "active",
                "inactive",
                "dismantled",
                name="cell_status",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("pci", sa.Integer(), nullable=False),
        sa.Column("earfcn_dl", sa.Integer(), nullable=False),
        sa.Column("earfcn_ul", sa.Integer(), nullable=True),
        sa.Column("band", sa.Integer(), nullable=True),
        sa.Column("bandwidth_mhz", sa.Double(), nullable=True),
        sa.Column("tac", sa.Integer(), nullable=True),
        sa.Column("max_tx_power_dbm", sa.Double(), nullable=True),
        sa.Column("antenna_model", sa.String(length=64), nullable=True),
        sa.Column("height_m", sa.Double(), nullable=True),
        sa.Column("azimuth_deg", sa.Double(), nullable=True),
        sa.Column("mech_tilt_deg", sa.Double(), nullable=True),
        sa.Column("elec_tilt_deg", sa.Double(), nullable=True),
        sa.Column("beamwidth_deg", sa.Double(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('planned', 'active', 'inactive', 'dismantled')",
            name=op.f("ck_cell_cell_status"),
        ),
        sa.CheckConstraint(
            "azimuth_deg >= 0 AND azimuth_deg < 360", name=op.f("ck_cell_azimuth_range")
        ),
        sa.CheckConstraint(
            "local_cell_id BETWEEN 0 AND 255", name=op.f("ck_cell_local_cell_id_range")
        ),
        sa.CheckConstraint("pci BETWEEN 0 AND 503", name=op.f("ck_cell_pci_range")),
        sa.CheckConstraint("tac BETWEEN 0 AND 65535", name=op.f("ck_cell_tac_range")),
        sa.ForeignKeyConstraint(
            ["enodeb_id"], ["enodeb.id"], name=op.f("fk_cell_enodeb_id_enodeb"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cell")),
        sa.UniqueConstraint("eci", name=op.f("uq_cell_eci")),
        sa.UniqueConstraint("enodeb_id", "local_cell_id", name="uq_cell_enodeb_local_cell"),
        sa.UniqueConstraint("name", name=op.f("uq_cell_name")),
    )
    op.create_index(op.f("ix_cell_enodeb_id"), "cell", ["enodeb_id"], unique=False)
    op.create_table(
        "cell_version",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cell_id", sa.Integer(), nullable=False),
        sa.Column("valid_period", postgresql.TSTZRANGE(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("enb_id", sa.Integer(), nullable=False),
        sa.Column("local_cell_id", sa.Integer(), nullable=False),
        sa.Column("eci", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "planned",
                "active",
                "inactive",
                "dismantled",
                name="cell_version_status",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("pci", sa.Integer(), nullable=False),
        sa.Column("earfcn_dl", sa.Integer(), nullable=False),
        sa.Column("earfcn_ul", sa.Integer(), nullable=True),
        sa.Column("band", sa.Integer(), nullable=True),
        sa.Column("bandwidth_mhz", sa.Double(), nullable=True),
        sa.Column("tac", sa.Integer(), nullable=True),
        sa.Column("max_tx_power_dbm", sa.Double(), nullable=True),
        sa.Column("antenna_model", sa.String(length=64), nullable=True),
        sa.Column("height_m", sa.Double(), nullable=True),
        sa.Column("azimuth_deg", sa.Double(), nullable=True),
        sa.Column("mech_tilt_deg", sa.Double(), nullable=True),
        sa.Column("elec_tilt_deg", sa.Double(), nullable=True),
        sa.Column("beamwidth_deg", sa.Double(), nullable=True),
        postgresql.ExcludeConstraint(
            (sa.column("cell_id"), "="),
            (sa.column("valid_period"), "&&"),
            using="gist",
            name="cell_version_no_overlap",
        ),
        sa.CheckConstraint(
            "status IN ('planned', 'active', 'inactive', 'dismantled')",
            name=op.f("ck_cell_version_cell_version_status"),
        ),
        sa.ForeignKeyConstraint(
            ["cell_id"], ["cell.id"], name=op.f("fk_cell_version_cell_id_cell"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cell_version")),
    )
    op.create_index(op.f("ix_cell_version_cell_id"), "cell_version", ["cell_id"], unique=False)
    op.create_index("ix_cell_version_eci", "cell_version", ["eci"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_cell_version_eci", table_name="cell_version")
    op.drop_index(op.f("ix_cell_version_cell_id"), table_name="cell_version")
    op.drop_table("cell_version")
    op.drop_index(op.f("ix_cell_enodeb_id"), table_name="cell")
    op.drop_table("cell")
    op.drop_index(op.f("ix_site_position_site_id"), table_name="site_position")
    op.drop_table("site_position")
    op.drop_index(op.f("ix_enodeb_site_id"), table_name="enodeb")
    op.drop_table("enodeb")
    op.drop_table("device")
    op.drop_index(op.f("ix_change_log_ts"), table_name="change_log")
    op.drop_index("ix_change_log_entity", table_name="change_log")
    op.drop_table("change_log")
    op.drop_index("ix_site_geom", table_name="site", postgresql_using="gist")
    op.drop_table("site")
    op.drop_table("map_overlay")
    op.drop_table("asset")
    op.drop_table("app_user")
