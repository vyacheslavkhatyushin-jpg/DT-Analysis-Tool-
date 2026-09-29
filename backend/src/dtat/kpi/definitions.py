"""KPI catalogue: codes, units, how hourly values are combined and when a value is a problem.

Operator reports give hourly percentages, not counters, so values over a period or a group of cells
are approximations. Each KPI uses the method that best reproduced the operator's own period values
(computed from counters) on real data: a plain mean of hourly values, or a mean weighted by the
hour's traffic. Exact values need counters (pm*) and will come with them.
"""

import re
from dataclasses import dataclass
from enum import StrEnum


class Better(StrEnum):
    HIGH = "high"
    LOW = "low"


class Aggregate(StrEnum):
    MEAN = "mean"  # plain mean of hourly values
    TRAFFIC = "traffic"  # mean weighted by the hour's traffic (DL + UL volume)
    SUM = "sum"  # volumes


class Level(StrEnum):
    OK = "ok"
    WARN = "warn"
    BAD = "bad"


@dataclass(frozen=True)
class KpiDef:
    code: str
    title: str
    unit: str
    aggregate: Aggregate
    better: Better | None = None  # None: no good or bad direction (traffic, users)
    warn: float | None = None  # worse than this: needs attention
    bad: float | None = None  # worse than this: a problem
    headers: tuple[str, ...] = ()  # report column names

    def level(self, value: float | None) -> Level | None:
        if value is None or self.better is None or self.warn is None or self.bad is None:
            return None
        sign = 1 if self.better is Better.HIGH else -1
        if sign * value < sign * self.bad:
            return Level.BAD
        if sign * value < sign * self.warn:
            return Level.WARN
        return Level.OK

    def worst(self, low: float, high: float) -> float:
        return low if self.better is Better.HIGH else high


H, L = Better.HIGH, Better.LOW
KPIS: tuple[KpiDef, ...] = (
    KpiDef("availability", "Доступность", "%", Aggregate.MEAN, H, 99.9, 99.0,
           ("Cell availability",)),
    KpiDef("rrc_sr", "RRC Setup SR", "%", Aggregate.MEAN, H, 99.0, 98.0,
           ("RRC Setup Success Rate, %",)),
    KpiDef("erab_sr", "E-RAB Setup SR", "%", Aggregate.MEAN, H, 99.5, 99.0,
           ("ERAB Setup Success Rate,%",)),
    KpiDef("erab_drop", "E-RAB Drop", "%", Aggregate.MEAN, L, 1.0, 2.0,
           ("ERAB Drop Rate,%",)),
    KpiDef("erab_drop_wo_ue_lost", "E-RAB Drop без UE lost", "%", Aggregate.MEAN, L, 1.0, 2.0,
           ("ERAB Drop Rate,% wo UE lost",)),
    KpiDef("ho_sr", "Mobility SR (хэндоверы)", "%", Aggregate.TRAFFIC, H, 98.0, 95.0,
           ("Mobility Success Rate,%",)),
    KpiDef("dl_user_thp", "User Throughput DL", "Мбит/с", Aggregate.TRAFFIC, H, 10.0, 5.0,
           ("User Throughput DL, Mbps",)),
    KpiDef("dl_bler", "DL BLER", "%", Aggregate.MEAN, L, 10.0, 15.0, ("DL BLER Rate",)),
    KpiDef("ul_bler", "UL BLER", "%", Aggregate.MEAN, L, 10.0, 15.0, ("UL BLER Rate",)),
    KpiDef("cqi", "Средний CQI", "", Aggregate.TRAFFIC, H, 10.0, 8.0, ("AVG CQI",)),
    KpiDef("dl_prb", "DL PRB", "%", Aggregate.MEAN, L, 70.0, 85.0,
           ("DL PRB Utilization", "DL PRB Utilitzation")),
    KpiDef("ul_prb", "UL PRB", "%", Aggregate.MEAN, L, 70.0, 85.0, ("UL PRB Utilization",)),
    KpiDef("dl_volume", "Трафик DL", "ГБ", Aggregate.SUM, headers=("DL Payload,GB",)),
    KpiDef("ul_volume", "Трафик UL", "ГБ", Aggregate.SUM, headers=("UL Payload,GB",)),
    KpiDef("active_dl_ue", "Активные UE DL", "", Aggregate.MEAN, headers=("Active DL UE",)),
)  # fmt: skip
KPI_BY_CODE = {k.code: k for k in KPIS}
TRAFFIC_KPIS = ("dl_volume", "ul_volume")


def normalize_header(text: object) -> str:
    """'RRC Setup Success Rate, % ' → 'rrcsetupsuccessrate': case, spaces and punctuation vary."""
    return re.sub(r"[\W_]+", "", str(text or "").lower())


KPI_BY_HEADER = {normalize_header(h): k for k in KPIS for h in k.headers}
