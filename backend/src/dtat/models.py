"""Import every ORM model so that Base.metadata is complete (used by Alembic and tests)."""

from dtat.audit.models import ChangeLog
from dtat.auth.models import User
from dtat.db import Base
from dtat.inventory.models import (
    Asset,
    Cell,
    CellVersion,
    Device,
    ENodeB,
    MapOverlay,
    Site,
    SitePosition,
)
from dtat.kpi.models import KpiCell, KpiFile, KpiSample

__all__ = [
    "Asset",
    "Base",
    "Cell",
    "CellVersion",
    "ChangeLog",
    "Device",
    "ENodeB",
    "KpiCell",
    "KpiFile",
    "KpiSample",
    "MapOverlay",
    "Site",
    "SitePosition",
    "User",
]
