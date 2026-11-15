"""Site intelligence: what is at a selected Mars location, and can you go there?

``site_report`` gathers evidence from every ingested dataset. ``decide`` turns
that evidence into one verdict with explicit reasons. The rules are kept in a
pure function so they can be tested without rasters:

* ``go``       - local 20 m terrain exists and the cell is inside the mobility limits.
* ``caution``  - local terrain exists and at least one warning applies.
* ``no_go``    - a blocking rule applies (slope beyond the vehicle limit).
* ``unknown``  - no local terrain: unknown ground is never reported as safe.

This is an educational planning model, not an operational safety approval.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache

import numpy as np

from . import jezero as pack
from .data_catalog import pack_topography, region_at
from .landing import CRATER_SOURCE, CTX_SOURCE, MOLA_SOURCE, crater_context, global_topography, local_grid
from .landing import jezero as jezero_terrain
from .planner import CLASS_NAMES, analyse
from .profiles import Profile
from .terrain_api import available_point_sample as point_sample, point_lookup_status, TerrainCoverageError

ROUGH_WARN_M = 1.2        # same threshold as the terrain cell inspector
NEIGHBOUR_RADIUS_M = 100  # ring used for the "surrounded by steep ground" check
RIM_WARN_KM = 0.5
SAND_UNITS = {"Aeb"}      # eolian bedforms: possible loose sand (interpretive map)
PROFILE_NAMES = {"astronaut_eva": "Astronaut on foot", "rover_scout": "Scout rover", "rover_large": "Large science rover"}

LABELS = {
    "go": ("Reachable within model limits", "Reachable within the model limits"),
    "caution": ("Reachable with caution", "Reachable with caution"),
    "no_go": ("Not traversable", "Not traversable for this profile"),
    "unknown": ("Unconfirmed — insufficient data", "Unconfirmed — insufficient data"),
}
UNAVAILABLE = [
    {"key": "rocks", "label": "Rocks and small obstacles", "why": "No calibrated rock abundance layer is available."},
    {"key": "soil", "label": "Soil strength", "why": "No soil mechanics measurements are available here."},
    {"key": "weather", "label": "Current weather", "why": "No live weather feed is available for this location."},
    {"key": "radiation", "label": "Local radiation dose", "why": "No location-specific radiation model is available."},
]


@dataclass(frozen=True)
class Reason:
    code: str
    severity: str  # "block" | "warn" | "ok" | "info"
    text: str
    value: float | None = None
    limit: float | None = None
    unit: str | None = None
    source: str | None = None


@dataclass(frozen=True)
class Evidence:
    """Everything the decision rules may use. ``None`` means not measured."""
    level: str  # "local" (CTX 20 m) | "regional" (MOLA)
    slope_deg: float | None = None
    roughness_m: float | None = None
    terrain_class: str | None = None
    blocked_share: float | None = None
    rim_distance_km: float | None = None
    unit_symbol: str | None = None
    unit_name: str | None = None
    surface_feature: str | None = None
    small_craters: int | None = None
    source: str | None = None
    resolution_m: float | None = None


def decide(evidence: Evidence, profile: Profile) -> dict:
    """Apply the access rules. Returns status, labels and ordered reasons."""
    e, limit, reasons = evidence, profile.max_slope_deg, []
    who = PROFILE_NAMES.get(profile.id, profile.label)
    local = e.level == "local"
    slope_source = e.source or (CTX_SOURCE if local else MOLA_SOURCE)
    scale = "local elevation cell" if local else "regional average across kilometres"

    if local and e.terrain_class == "unknown":
        reasons.append(Reason("no_elevation", "info", "Elevation is missing or unreliable in this cell.", source=slope_source))
    elif e.slope_deg is None:
        reasons.append(Reason("slope_unavailable", "info", "Slope cannot be calculated from the available data."))
    elif e.slope_deg > limit:
        reasons.append(Reason("slope_exceeds_limit", "block",
                              f"Slope {e.slope_deg:.1f}° ({scale}) exceeds the mobility limit of {limit:.0f}° for {who}.",
                              e.slope_deg, limit, "°", slope_source))
    elif local:
        reasons.append(Reason("slope_within_limit", "ok",
                              f"Slope {e.slope_deg:.1f}° is within the mobility limit of {limit:.0f}° for {who}.",
                              e.slope_deg, limit, "°", slope_source))
    else:
        reasons.append(Reason("regional_slope_only", "info",
                              f"Regional slope {e.slope_deg:.1f}° cannot resolve local cliffs or rocks, even though the regional gradient is below the profile limit.",
                              e.slope_deg, limit, "°", slope_source))

    if not local:
        reasons.append(Reason("no_local_terrain", "info",
                              "No valid high resolution elevation model is available at this point in the connected USGS CTX catalog."))
    else:
        if e.terrain_class == "high_risk":
            reasons.append(Reason("high_modelled_risk", "warn", "The mobility model indicates high risk from slope and roughness.", source=slope_source))
        elif e.terrain_class == "moderate":
            reasons.append(Reason("moderate_modelled_risk", "warn", "The mobility model indicates moderate risk.", source=slope_source))
        if e.roughness_m is not None and e.roughness_m > ROUGH_WARN_M:
            reasons.append(Reason("rough_surface", "warn", f"High surface roughness ({e.roughness_m:.2f} m RMS) increases mobility difficulty.",
                                  e.roughness_m, ROUGH_WARN_M, "m RMS", slope_source))
        if e.blocked_share is not None and e.blocked_share >= 0.5:
            reasons.append(Reason("surrounded_by_blocked", "warn",
                                  f"{e.blocked_share * 100:.0f}% of cells within {NEIGHBOUR_RADIUS_M} m are blocked, which may prevent access.",
                                  e.blocked_share * 100, 50, "%", slope_source))
    if e.rim_distance_km is not None and e.rim_distance_km < RIM_WARN_KM:
        reasons.append(Reason("near_crater_rim", "warn" if local else "info",
                              f"This point is {e.rim_distance_km:.2f} km from a large crater rim (approximated as a circle).",
                              e.rim_distance_km, RIM_WARN_KM, "km", CRATER_SOURCE))
    if e.unit_symbol in SAND_UNITS:
        reasons.append(Reason("loose_bedforms", "warn" if local else "info",
                              f"Geologic unit {e.unit_name} contains interpreted eolian bedforms; loose sand may reduce traction. Soil strength is unmeasured.",
                              source="USGS SIM 3464"))
    if e.surface_feature:
        reasons.append(Reason("mapped_surface_feature", "info", f"Mapped USGS surface feature: {e.surface_feature}.", source="USGS SIM 3464"))
    if e.small_craters:
        reasons.append(Reason("small_craters_nearby", "info", f"{e.small_craters} mapped small craters (200–500 m) within 300 m.",
                              e.small_craters, source="USGS SIM 3464"))

    severities = {reason.severity for reason in reasons}
    if "block" in severities:
        status = "no_go"
    elif not local or e.terrain_class == "unknown" or e.slope_deg is None:
        status = "unknown"
    else:
        status = "caution" if "warn" in severities else "go"
    order = {"block": 0, "warn": 1, "ok": 2, "info": 3}
    reasons.sort(key=lambda reason: order[reason.severity])
    return {
        "status": status, "label": LABELS[status][0], "labelEn": LABELS[status][1],
        "confidence": "local" if local else "regional",
        "reasons": [asdict(reason) for reason in reasons],
        "nextStep": ("Calculate a route to check connectivity and energy." if status in ("go", "caution")
                     else "Select another point or change the mobility profile." if status == "no_go"
                     else "A valid high resolution elevation model is required for a local assessment."),
        "limits": "Educational estimate from orbital data. Small rocks, soil strength and live weather are unmeasured.",
    }


@lru_cache(maxsize=16)
def _analysis(profile: Profile) -> dict:
    return analyse(jezero_terrain()[0], profile)


def _local_evidence(sample, profile: Profile) -> dict:
    terrain, _, _, row, col = sample
    bundled = jezero_terrain()
    analysis = _analysis(profile) if bundled and terrain is bundled[0] else analyse(terrain, profile)
    radius = max(1, int(NEIGHBOUR_RADIUS_M / terrain.cell_size))
    window = analysis["cls"][max(0, row - radius):row + radius + 1, max(0, col - radius):col + radius + 1]
    slope, roughness = float(terrain.slope_deg[row, col]), float(terrain.roughness[row, col])
    return {
        "elevation": float(terrain.elevation[row, col]),
        "slope": slope if np.isfinite(slope) else None,
        "roughness": roughness if np.isfinite(roughness) else None,
        "class": CLASS_NAMES[int(analysis["cls"][row, col])],
        "risk": round(float(analysis["risk"][row, col]), 3) if np.isfinite(analysis["risk"][row, col]) else None,
        "blocked_share": float(np.mean(window >= 3)),
    }


def site_report(lat: float, lon: float, profile: Profile) -> dict:
    """Full evidence and verdict for one selected coordinate."""
    sample = local_grid(lat, lon)
    provider_error = None
    if sample is None:
        try:
            sample = point_sample(lat, lon)
        except TerrainCoverageError as error:
            provider_error = str(error)
    _, hazard = crater_context(lat, lon)
    unit = pack.geologic_unit_at(lat, lon)
    feature = pack.surface_feature_at(lat, lon)
    craters = pack.small_craters_near(lat, lon)
    rim = hazard["rimDistanceKm"] if hazard else None

    if sample:
        local = _local_evidence(sample, profile)
        terrain = {"level": "local", "resolutionM": sample[0].cell_size, "source": sample[0].meta.get("source", CTX_SOURCE),
                   "sourceUrl": sample[0].meta.get("source_url"), "productId": sample[0].meta.get("product_id"),
                   "elevationM": round(local["elevation"], 1), "slopeDeg": local["slope"],
                   "roughnessM": local["roughness"], "class": local["class"], "risk": local["risk"]}
        evidence = Evidence("local", local["slope"], local["roughness"], local["class"], local["blocked_share"], rim,
                            unit and unit["symbol"], unit and unit["name"], feature, craters and craters["count"])
    else:
        elevation, slope = global_topography(lat, lon)
        packed = pack_topography(lat, lon) is not None
        terrain = {"level": "regional", "resolutionM": 3705 if packed else 14820,
                   "source": "MOLA MEGT90N000EB · 3,705 m/pixel" if packed else MOLA_SOURCE,
                   "elevationM": round(elevation, 1) if elevation is not None else None,
                   "slopeDeg": round(slope, 2) if slope is not None else None,
                   "roughnessM": None, "class": None, "risk": None}
        evidence = Evidence("regional", slope, rim_distance_km=rim, unit_symbol=unit and unit["symbol"],
                            unit_name=unit and unit["name"], surface_feature=feature,
                            small_craters=craters and craters["count"])

    lookup = {'status': 'ready'} if sample else point_lookup_status(lat, lon)
    verdict = decide(evidence, profile)
    for reason in verdict['reasons']:
        if reason['source'] in (CTX_SOURCE, MOLA_SOURCE):
            reason['source'] = terrain['source']
        if provider_error and reason['code'] == 'no_local_terrain':
            reason.update(code='elevation_service_unavailable', text=provider_error)
        elif reason['code'] == 'no_local_terrain' and lookup['status'] == 'pending':
            reason.update(code='local_elevation_loading', text='Detailed CTX coverage is loading. Regional elevation remains available below.')
        elif reason['code'] == 'no_local_terrain' and lookup['status'] == 'unavailable':
            reason.update(code='elevation_service_unavailable', text='Additional CTX data could not be reached. Installed regional data remain available.')
    return {
        "coordinates": {"latitude": lat, "longitude": lon},
        "profile": {"id": profile.id, "label": profile.label, "maxSlopeDeg": profile.max_slope_deg},
        "region": region_at(lat, lon),
        "verdict": verdict,
        "terrain": terrain,
        "routeAvailable": sample is not None,
        "elevationLookup": lookup,
        "geology": unit,
        "surfaceFeature": feature,
        "smallCraters": craters,
        "landingEllipse": pack.in_landing_ellipse(lat, lon),
        "inJezeroMap": pack.in_map(lat, lon),
        "crater": hazard,
        "rover": pack.nearest_waypoint(lat, lon),
        "unavailable": UNAVAILABLE,
    }
