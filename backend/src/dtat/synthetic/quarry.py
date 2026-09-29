"""Synthetic open-pit mine with a private LTE network, for development and demos.

The generator goes through the regular services, so the demo data has the same audit trail,
position history and cell versions as real data. Everything is deterministic for a given seed.
"""

import math
import random
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from dtat.audit.service import SYSTEM_ACTOR
from dtat.db import utcnow
from dtat.inventory import service
from dtat.inventory.lte import imei_check_digit
from dtat.inventory.models import AssetKind, DeviceKind, Site, SiteKind, Status
from dtat.inventory.schemas import (
    AssetCreate,
    CellCreate,
    CellUpdate,
    DeviceCreate,
    ENodeBCreate,
    MapOverlayCreate,
    SiteCreate,
    SiteUpdate,
)

EARTH_M_PER_DEG = 111_320.0


@dataclass(frozen=True)
class QuarryParams:
    center_lat: float = 54.05
    center_lon: float = 87.25
    semi_major_m: float = 1800.0
    semi_minor_m: float = 1000.0
    rotation_deg: float = 25.0
    seed: int = 42
    earfcn_dl: int = 1300  # band 3, 1815 MHz
    bandwidth_mhz: float = 10.0


@dataclass
class SeedSummary:
    sites: int = 0
    cells: int = 0
    assets: int = 0
    devices: int = 0
    overlays: int = 0
    notes: list[str] = field(default_factory=list)


class _Geo:
    """Local metric frame (east, north) around the pit center."""

    def __init__(self, params: QuarryParams) -> None:
        self.p = params
        self.cos_lat = math.cos(math.radians(params.center_lat))
        self.rot = math.radians(params.rotation_deg)

    def to_lonlat(self, east: float, north: float) -> tuple[float, float]:
        lat = self.p.center_lat + north / EARTH_M_PER_DEG
        lon = self.p.center_lon + east / (EARTH_M_PER_DEG * self.cos_lat)
        return round(lon, 7), round(lat, 7)

    def ellipse_point(self, angle_rad: float, scale: float) -> tuple[float, float]:
        """Point on the pit ellipse scaled by `scale`, in local metres."""
        x = self.p.semi_major_m * scale * math.cos(angle_rad)
        y = self.p.semi_minor_m * scale * math.sin(angle_rad)
        east = x * math.cos(self.rot) - y * math.sin(self.rot)
        north = x * math.sin(self.rot) + y * math.cos(self.rot)
        return east, north

    def ellipse_ring(self, scale: float, points: int = 72) -> list[list[float]]:
        ring = [
            list(self.to_lonlat(*self.ellipse_point(2 * math.pi * i / points, scale)))
            for i in range(points)
        ]
        return [*ring, ring[0]]

    def blob(
        self, east: float, north: float, radius: float, rng: random.Random
    ) -> list[list[float]]:
        ring = []
        for i in range(24):
            angle = 2 * math.pi * i / 24
            r = radius * rng.uniform(0.75, 1.15)
            ring.append(
                list(self.to_lonlat(east + r * math.cos(angle), north + r * math.sin(angle)))
            )
        return [*ring, ring[0]]


def _azimuth_to(from_en: tuple[float, float], to_en: tuple[float, float]) -> float:
    dx, dy = to_en[0] - from_en[0], to_en[1] - from_en[1]
    return math.degrees(math.atan2(dx, dy)) % 360


def _norm(azimuth: float) -> float:
    return round(azimuth % 360, 1)


def _imei(rng: random.Random) -> str:
    body = "35" + "".join(str(rng.randint(0, 9)) for _ in range(12))
    return body + str(imei_check_digit(body))


def _overlays(
    geo: _Geo, rng: random.Random, dumps: list[tuple[float, float]], plant: tuple[float, float]
) -> list[MapOverlayCreate]:
    pit: dict[str, Any] = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Верхняя бровка"},
                "geometry": {"type": "Polygon", "coordinates": [geo.ellipse_ring(1.0)]},
            },
            *(
                {
                    "type": "Feature",
                    "properties": {"name": f"Уступ {i}"},
                    "geometry": {"type": "LineString", "coordinates": geo.ellipse_ring(scale)},
                }
                for i, scale in enumerate((0.85, 0.7, 0.55, 0.4, 0.25), start=1)
            ),
            {
                "type": "Feature",
                "properties": {"name": "Съезд (автодорога)"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        list(geo.to_lonlat(*geo.ellipse_point(0.3 + 4.2 * t, 1.05 - 0.85 * t)))
                        for t in (i / 60 for i in range(61))
                    ],
                },
            },
        ],
    }
    dump_fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": name},
                "geometry": {"type": "Polygon", "coordinates": [geo.blob(e, n, 650, rng)]},
            }
            for name, (e, n) in zip(
                ("Отвал Северный", "Отвал Южный", "Отвал Западный"), dumps, strict=True
            )
        ],
    }
    plant_fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Промплощадка"},
                "geometry": {"type": "Polygon", "coordinates": [geo.blob(*plant, 350, rng)]},
            }
        ],
    }
    return [
        MapOverlayCreate(name="Карьер (демо)", color="#b07a3c", geojson=pit),
        MapOverlayCreate(name="Отвалы (демо)", color="#7d8b69", geojson=dump_fc),
        MapOverlayCreate(name="Промплощадка (демо)", color="#6b7fa3", geojson=plant_fc),
    ]


def seed_quarry(session: Session, params: QuarryParams | None = None) -> SeedSummary:
    """Populate an empty inventory with a synthetic quarry network. The caller commits."""
    params = params or QuarryParams()
    if session.scalar(select(func.count()).select_from(Site)):
        raise RuntimeError("Инвентарь не пуст: демо-данные можно загрузить только в пустую базу")

    rng = random.Random(params.seed)
    geo = _Geo(params)
    now = utcnow()
    actor = SYSTEM_ACTOR
    summary = SeedSummary()
    center = (0.0, 0.0)

    dumps = [(-600.0, 2300.0), (700.0, -2300.0), (-3000.0, -300.0)]
    plant = (2900.0, -600.0)

    # (code, name, kind, status, (east, north), structure height, sector azimuths, tac)
    plans: list[
        tuple[str, str, SiteKind, Status, tuple[float, float], float, list[float], int]
    ] = []

    for i in range(10):
        angle = 2 * math.pi * i / 10 + 0.15
        pos = geo.ellipse_point(angle, 1.08)
        inward = _azimuth_to(pos, center)
        azimuths = [_norm(inward - 40), _norm(inward + 40), _norm(inward + 180)]
        plans.append(
            (
                f"KR-R{i + 1:02d}",
                f"Борт {i + 1}",
                SiteKind.STATIONARY,
                Status.ACTIVE,
                pos,
                35.0,
                azimuths,
                10501,
            )
        )
    for i in range(6):
        angle = 2 * math.pi * i / 6 + 0.5
        pos = geo.ellipse_point(angle, rng.uniform(0.45, 0.75))
        offset = rng.uniform(0, 120)
        azimuths = [_norm(offset + k * 120) for k in range(3)]
        plans.append(
            (
                f"KR-M{i + 1:02d}",
                f"Передвижная {i + 1}",
                SiteKind.MOBILE,
                Status.ACTIVE,
                pos,
                15.0,
                azimuths,
                10501,
            )
        )
    for i, pos in enumerate(dumps):
        offset = rng.uniform(0, 120)
        plans.append(
            (
                f"KR-D{i + 1:02d}",
                ("Отвал Северный", "Отвал Южный", "Отвал Западный")[i],
                SiteKind.STATIONARY,
                Status.ACTIVE,
                pos,
                25.0,
                [_norm(offset + k * 120) for k in range(3)],
                10502,
            )
        )
    for i, (name, dx, dy) in enumerate(
        (("АБК", -150.0, 120.0), ("Обогатительная фабрика", 200.0, -150.0))
    ):
        pos = (plant[0] + dx, plant[1] + dy)
        offset = rng.uniform(0, 120)
        plans.append(
            (
                f"KR-P{i + 1:02d}",
                name,
                SiteKind.STATIONARY,
                Status.ACTIVE,
                pos,
                30.0,
                [_norm(offset + k * 120) for k in range(3)],
                10502,
            )
        )
    planned_pos = geo.ellipse_point(3.9, 1.12)
    plans.append(
        (
            "KR-R11",
            "Борт 11 (проект)",
            SiteKind.STATIONARY,
            Status.PLANNED,
            planned_pos,
            35.0,
            [_norm(_azimuth_to(planned_pos, center) + d) for d in (-40, 40)],
            10501,
        )
    )

    # Unique PCI groups in shuffled order: co-sited cells get PCI mod 3 = 0, 1, 2.
    groups = list(range(1, len(plans) + 1))
    rng.shuffle(groups)

    for idx, (code, name, kind, status, pos, height, azimuths, tac) in enumerate(plans):
        mobile = kind is SiteKind.MOBILE
        start_pos = pos
        if mobile:
            # Mobile masts start 250–450 m away and are moved to the current point later.
            shift_angle = rng.uniform(0, 2 * math.pi)
            shift = rng.uniform(250, 450)
            start_pos = (
                pos[0] + shift * math.cos(shift_angle),
                pos[1] + shift * math.sin(shift_angle),
            )
        lon, lat = geo.to_lonlat(*start_pos)
        site = service.create_site(
            session,
            actor,
            SiteCreate(
                code=code,
                name=name,
                kind=kind,
                status=status,
                lat=lat,
                lon=lon,
                structure_type="прицеп-мачта" if mobile else "мачта",
                structure_height_m=height,
            ),
        )
        summary.sites += 1
        if mobile:
            lon, lat = geo.to_lonlat(*pos)
            service.update_site(
                session,
                actor,
                site.id,
                SiteUpdate(
                    lat=lat, lon=lon, effective_at=now - timedelta(days=rng.randint(10, 60))
                ),
            )

        enodeb = service.create_enodeb(
            session,
            actor,
            ENodeBCreate(
                site_id=site.id,
                enb_id=170_001 + idx,
                name=code,
                vendor="Ericsson",
                hw_model="Baseband 6630",
                sw_version="23.Q4",
                status=status,
            ),
        )
        for sector, azimuth in enumerate(azimuths):
            cell = service.create_cell(
                session,
                actor,
                CellCreate(
                    enodeb_id=enodeb.id,
                    local_cell_id=sector + 1,
                    name=f"{code}-{sector + 1}",
                    status=status,
                    pci=3 * groups[idx] + sector,
                    earfcn_dl=params.earfcn_dl,
                    earfcn_ul=params.earfcn_dl + 18000,
                    bandwidth_mhz=params.bandwidth_mhz,
                    tac=tac,
                    max_tx_power_dbm=43.0,
                    antenna_model="ANT-65-17 (демо)",
                    height_m=height - 2,
                    azimuth_deg=azimuth,
                    mech_tilt_deg=float(rng.choice((0, 1, 2))),
                    elec_tilt_deg=float(rng.choice((6, 7, 8))),
                    beamwidth_deg=65.0,
                ),
            )
            summary.cells += 1
            # A few rim cells were re-tilted recently: shows up in the cell history.
            if code.startswith("KR-R") and sector == 0 and idx % 3 == 0 and status is Status.ACTIVE:
                service.update_cell(
                    session,
                    actor,
                    cell.id,
                    CellUpdate(
                        elec_tilt_deg=(cell.elec_tilt_deg or 6) + 2,
                        effective_at=now - timedelta(days=rng.randint(3, 20)),
                    ),
                )
    summary.notes.append(
        f"EARFCN {params.earfcn_dl}, {params.bandwidth_mhz:g} МГц; "
        "передвижные сайты с историей перемещений"
    )

    fleet = (
        [("С", i, AssetKind.HAUL_TRUCK, "Самосвал 130 т") for i in range(101, 121)]
        + [("Э", i, AssetKind.EXCAVATOR, "Экскаватор 20 м³") for i in range(1, 5)]
        + [("Б", i, AssetKind.DRILL, "Буровой станок") for i in range(1, 4)]
        + [("Д", i, AssetKind.DOZER, "Бульдозер") for i in range(1, 3)]
        + [("А", i, AssetKind.LIGHT_VEHICLE, "Вахтовый автомобиль") for i in range(1, 4)]
    )
    for prefix, number, asset_kind, model in fleet:
        asset_name = f"{prefix}-{number:02d}"
        asset = service.create_asset(
            session, actor, AssetCreate(name=asset_name, kind=asset_kind, model=model)
        )
        summary.assets += 1
        service.create_device(
            session,
            actor,
            DeviceCreate(
                name=f"RTR-{asset_name}",
                kind=DeviceKind.ROUTER,
                imei=_imei(rng),
                model="LTE-роутер (демо)",
                asset_id=asset.id,
            ),
        )
        summary.devices += 1

    roles = (
        "горный мастер",
        "диспетчер",
        "машинист экскаватора",
        "взрывник",
        "механик",
        "электрик",
    )
    for i in range(1, 16):
        service.create_device(
            session,
            actor,
            DeviceCreate(
                name=f"RAD-{i:02d}",
                kind=DeviceKind.RADIO,
                imei=_imei(rng),
                model="PTT-рация (демо)",
                role=roles[i % len(roles)],
            ),
        )
        summary.devices += 1
    for i in range(1, 3):
        service.create_device(
            session,
            actor,
            DeviceCreate(
                name=f"DT-PHONE-{i}",
                kind=DeviceKind.PHONE,
                imei=_imei(rng),
                model="Эталонный телефон (демо)",
                role="драйв-тест",
            ),
        )
        summary.devices += 1
    for i, place in enumerate(("диспетчерская", "забой Э-01", "дробильный комплекс"), start=1):
        service.create_device(
            session,
            actor,
            DeviceCreate(
                name=f"PROBE-{i:02d}",
                kind=DeviceKind.PROBE,
                imei=_imei(rng),
                model="Зонд (демо)",
                role=f"зонд: {place}",
            ),
        )
        summary.devices += 1

    for overlay in _overlays(geo, rng, dumps, plant):
        service.create_overlay(session, actor, overlay)
        summary.overlays += 1

    return summary
