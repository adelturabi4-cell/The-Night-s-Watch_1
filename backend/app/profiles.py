"""Mobility profiles. Every number here is a documented ASSUMPTION for a
planning model, not spacecraft telemetry."""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace


@dataclass(frozen=True)
class Profile:
    id: str
    label: str
    kind: str  # "astronaut" | "rover"
    mass_kg: float
    speed_mps: float  # nominal speed on flat, smooth ground
    max_slope_deg: float  # slopes above this are treated as impassable
    crr: float  # rolling / locomotion resistance coefficient on smooth ground
    efficiency: float  # mechanical work / energy drawn
    base_power_w: float  # power drawn regardless of motion
    capacity_wh: float  # usable energy budget for one traverse
    reserve_frac: float  # fraction of capacity that must remain at arrival
    resource_name: str
    notes: str

    def to_dict(self) -> dict:
        return asdict(self)


PROFILES: dict[str, Profile] = {
    p.id: p
    for p in (
        Profile(
            "astronaut_eva", "Astronaut on foot (EVA suit)", "astronaut",
            mass_kg=200.0, speed_mps=0.9, max_slope_deg=20.0, crr=0.10, efficiency=0.25,
            base_power_w=250.0, capacity_wh=2400.0, reserve_frac=0.30,
            resource_name="Metabolic energy budget",
            notes="Assumed 80 kg crew member + 120 kg suit and tools. Walking speed and slope limit are "
                  "conservative planning assumptions, not flight rules.",
        ),
        Profile(
            "rover_large", "Large science rover (Perseverance-class)", "rover",
            mass_kg=1025.0, speed_mps=0.042, max_slope_deg=30.0, crr=0.15, efficiency=0.5,
            base_power_w=110.0, capacity_wh=6000.0, reserve_frac=0.25,
            resource_name="Battery energy",
            notes="Mass 1025 kg and top speed ~152 m/h follow published Perseverance figures. Slope limit, "
                  "resistance, efficiency and energy budget are assumptions.",
        ),
        Profile(
            "rover_scout", "Light scout rover", "rover",
            mass_kg=180.0, speed_mps=0.10, max_slope_deg=22.0, crr=0.12, efficiency=0.5,
            base_power_w=40.0, capacity_wh=1200.0, reserve_frac=0.25,
            resource_name="Battery energy",
            notes="Hypothetical small rover. All values are assumptions.",
        ),
    )
}

OVERRIDABLE = ("mass_kg", "speed_mps", "max_slope_deg", "capacity_wh", "efficiency", "reserve_frac")


def resolve(profile_id: str, overrides: dict | None = None) -> Profile:
    if profile_id not in PROFILES:
        raise KeyError(profile_id)
    p = PROFILES[profile_id]
    clean = {}
    for k, v in (overrides or {}).items():
        if k in OVERRIDABLE and v is not None:
            v = float(v)
            if k == "reserve_frac":
                v = min(max(v, 0.0), 0.9)
            elif k == "efficiency":
                v = min(max(v, 0.05), 1.0)
            else:
                v = max(v, 1e-3)
            clean[k] = v
    return replace(p, **clean) if clean else p
