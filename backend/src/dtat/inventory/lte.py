"""LTE identifiers and FDD band arithmetic (3GPP TS 36.101, table 5.7.3-1)."""

from dataclasses import dataclass

PCI_MAX = 503
ENB_ID_MAX = 2**20 - 1
LOCAL_CELL_ID_MAX = 255
TAC_MAX = 65535
BANDWIDTHS_MHZ = (1.4, 3.0, 5.0, 10.0, 15.0, 20.0)


@dataclass(frozen=True)
class FddBand:
    band: int
    f_dl_low_mhz: float
    n_offs_dl: int
    n_dl_max: int


FDD_BANDS: tuple[FddBand, ...] = (
    FddBand(1, 2110.0, 0, 599),
    FddBand(2, 1930.0, 600, 1199),
    FddBand(3, 1805.0, 1200, 1949),
    FddBand(4, 2110.0, 1950, 2399),
    FddBand(5, 869.0, 2400, 2649),
    FddBand(7, 2620.0, 2750, 3449),
    FddBand(8, 925.0, 3450, 3799),
    FddBand(12, 729.0, 5010, 5179),
    FddBand(13, 746.0, 5180, 5279),
    FddBand(14, 758.0, 5280, 5379),
    FddBand(17, 734.0, 5730, 5849),
    FddBand(20, 791.0, 6150, 6449),
    FddBand(25, 1930.0, 8040, 8689),
    FddBand(26, 859.0, 8690, 9039),
    FddBand(28, 758.0, 9210, 9659),
    FddBand(31, 462.5, 9870, 9919),
    FddBand(66, 2110.0, 66436, 67335),
    FddBand(71, 617.0, 68586, 68935),
    FddBand(72, 461.0, 68936, 68985),
)


def fdd_band(earfcn_dl: int) -> FddBand | None:
    for band in FDD_BANDS:
        if band.n_offs_dl <= earfcn_dl <= band.n_dl_max:
            return band
    return None


def band_number(earfcn_dl: int) -> int | None:
    band = fdd_band(earfcn_dl)
    return band.band if band else None


def dl_frequency_mhz(earfcn_dl: int) -> float | None:
    band = fdd_band(earfcn_dl)
    if band is None:
        return None
    return round(band.f_dl_low_mhz + 0.1 * (earfcn_dl - band.n_offs_dl), 1)


def make_eci(enb_id: int, local_cell_id: int) -> int:
    """E-UTRAN Cell Identifier: 20-bit eNB ID followed by 8-bit local cell ID."""
    return (enb_id << 8) | local_cell_id


def split_eci(eci: int) -> tuple[int, int]:
    return eci >> 8, eci & 0xFF


def imei_check_digit(first14: str) -> int:
    """Luhn check digit for the first 14 digits of an IMEI."""
    total = 0
    for i, ch in enumerate(first14):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10


def imei_is_valid(imei: str) -> bool:
    return len(imei) == 15 and imei.isdigit() and imei_check_digit(imei[:14]) == int(imei[14])
