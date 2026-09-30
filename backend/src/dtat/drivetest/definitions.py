"""Radio metrics of a drive test and their quality classes.

Four classes per metric (good / fair / poor / bad), common practice for LTE drive tests. The same
thresholds color the track, build the distributions and find problem segments.
"""

from dataclasses import dataclass
from enum import StrEnum


class Quality(StrEnum):
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    BAD = "bad"


@dataclass(frozen=True)
class Metric:
    code: str
    title: str
    unit: str
    # Lower bounds of good, fair and poor; anything below the last one is bad.
    bounds: tuple[float, float, float]

    def quality(self, value: float | None) -> Quality | None:
        if value is None:
            return None
        good, fair, poor = self.bounds
        if value >= good:
            return Quality.GOOD
        if value >= fair:
            return Quality.FAIR
        if value >= poor:
            return Quality.POOR
        return Quality.BAD


METRICS: tuple[Metric, ...] = (
    Metric("rsrp", "RSRP", "дБм", (-90, -100, -110)),
    Metric("rsrq", "RSRQ", "дБ", (-10, -13, -16)),
    Metric("sinr", "SINR", "дБ", (13, 5, 0)),
)
METRIC_BY_CODE = {m.code: m for m in METRICS}

# Problem segments: how long a condition must hold to count, and what it is.
WEAK_COVERAGE_RSRP = -105.0  # below: weak coverage
INTERFERENCE_RSRP = -95.0  # at least this RSRP ...
INTERFERENCE_SINR = 3.0  # ... and SINR below this: interference, not coverage
MIN_PROBLEM_SECONDS = 5
PING_PONG_SECONDS = 10  # back to the previous cell within this time
GAP_SECONDS = 5  # no radio measurement for longer than this
