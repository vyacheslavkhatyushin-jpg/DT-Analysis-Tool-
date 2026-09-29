"""Russian labels for enum values, used in Excel files (the UI keeps its own copy)."""

from enum import StrEnum
from typing import Any

from dtat.inventory.models import AssetKind, DeviceKind, SiteKind, Status

STATUS_LABELS = {
    Status.PLANNED: "планируется",
    Status.ACTIVE: "в работе",
    Status.INACTIVE: "отключен",
    Status.DISMANTLED: "выведен",
}
SITE_KIND_LABELS = {SiteKind.STATIONARY: "стационарный", SiteKind.MOBILE: "передвижной"}
DEVICE_KIND_LABELS = {
    DeviceKind.PHONE: "телефон",
    DeviceKind.ROUTER: "роутер",
    DeviceKind.RADIO: "рация",
    DeviceKind.PROBE: "зонд",
    DeviceKind.OTHER: "другое",
}
ASSET_KIND_LABELS = {
    AssetKind.HAUL_TRUCK: "самосвал",
    AssetKind.EXCAVATOR: "экскаватор",
    AssetKind.DRILL: "буровой станок",
    AssetKind.DOZER: "бульдозер",
    AssetKind.LOADER: "погрузчик",
    AssetKind.LIGHT_VEHICLE: "автомобиль",
    AssetKind.OTHER: "другое",
}

LABELS: dict[type[StrEnum], dict[Any, str]] = {
    Status: STATUS_LABELS,
    SiteKind: SITE_KIND_LABELS,
    DeviceKind: DEVICE_KIND_LABELS,
    AssetKind: ASSET_KIND_LABELS,
}


def label(value: StrEnum) -> str:
    return LABELS[type(value)][value]


def parse_enum[E: StrEnum](enum_cls: type[E], text: str) -> E | None:
    """Accept a Russian label or the internal value, case-insensitively."""
    needle = text.strip().lower()
    for member, member_label in LABELS[enum_cls].items():
        if needle in (member_label, member.value):
            return enum_cls(member.value)
    return None
