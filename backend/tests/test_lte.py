import pytest

from dtat.inventory.lte import (
    band_number,
    dl_frequency_mhz,
    imei_check_digit,
    imei_is_valid,
    make_eci,
    split_eci,
)


@pytest.mark.parametrize(
    ("earfcn", "band", "freq"),
    [
        (0, 1, 2110.0),
        (1300, 3, 1815.0),
        (1849, 3, 1869.9),
        (3100, 7, 2655.0),
        (6300, 20, 806.0),
        (9870, 31, 462.5),
        (68936, 72, 461.0),
    ],
)
def test_earfcn_to_band_and_frequency(earfcn: int, band: int, freq: float) -> None:
    assert band_number(earfcn) == band
    assert dl_frequency_mhz(earfcn) == freq


def test_unknown_earfcn() -> None:
    assert band_number(37900) is None  # TDD band 38 is not in the FDD table
    assert dl_frequency_mhz(37900) is None


def test_eci_round_trip() -> None:
    eci = make_eci(170001, 3)
    assert eci == 170001 * 256 + 3
    assert split_eci(eci) == (170001, 3)


def test_imei_luhn() -> None:
    assert imei_check_digit("49015420323751") == 8
    assert imei_is_valid("490154203237518")
    assert not imei_is_valid("490154203237519")
    assert not imei_is_valid("49015420323751")
