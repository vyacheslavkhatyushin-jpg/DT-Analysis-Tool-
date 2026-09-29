from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from dtat.inventory.models import (
    Cell,
    CellVersion,
    ENodeB,
    MapOverlay,
    Site,
    SiteKind,
    SitePosition,
)
from dtat.synthetic.quarry import seed_quarry


def test_seed_quarry(session: Session) -> None:
    summary = seed_quarry(session)
    assert summary.sites == 22
    assert session.scalar(select(func.count()).select_from(Cell)) == summary.cells

    cells = session.execute(
        select(Cell.pci, Cell.earfcn_dl, ENodeB.site_id).join(Cell.enodeb)
    ).all()
    # PCI is unique per carrier and co-sited cells differ in PCI mod 3.
    assert len({(pci, earfcn) for pci, earfcn, _ in cells}) == len(cells)
    per_site: dict[int, list[int]] = {}
    for pci, _, site_id in cells:
        per_site.setdefault(site_id, []).append(pci % 3)
    assert all(len(mods) == len(set(mods)) for mods in per_site.values())

    mobile = session.scalars(select(Site.id).where(Site.kind == SiteKind.MOBILE)).all()
    positions = Counter(session.scalars(select(SitePosition.site_id)))
    assert mobile and all(positions[site_id] == 2 for site_id in mobile)

    assert (session.scalar(select(func.count()).select_from(CellVersion)) or 0) > summary.cells
    assert session.scalar(select(func.count()).select_from(MapOverlay)) == 3


def test_seed_refuses_non_empty_inventory(session: Session) -> None:
    seed_quarry(session)
    try:
        seed_quarry(session)
    except RuntimeError:
        return
    raise AssertionError("second seed must fail")
