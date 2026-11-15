"""Terrain analysis, energy model and three-strategy A* route planning.

Model summary (all of it is an explicit planning model, not measurement):

risk(cell)      = clip(0.65 * slope / max_slope + 0.35 * roughness / ROUGH_REF, 0, 1)
speed(edge)     = v_nominal * max(0.25, 1 - 0.5 * |grade| / max_slope - 0.3 * rough_n)
energy(edge)    = max(0, m g (crr_eff cos(theta) d + dz)) / efficiency + P_base * t
                  with crr_eff = crr * (1 + 2 * rough_n); no energy is recovered downhill
penalty(edge)   = 40 * risk^2 + 6 * (1 - confidence)^2

cost_shortest   = d                                   (3-D length)
cost_safest     = d * (1 + penalty)
cost_optimal    = d * max(0.05, w_dist + w_time * t_factor + w_energy * e_factor
                               + w_risk * penalty - 0.6 * w_science * science)
"""
from __future__ import annotations

import heapq
import math

import numpy as np

from .profiles import Profile
from .terrain import Terrain

G_MARS = 3.721  # m/s^2
ROUGH_REF_M = 1.2  # roughness (RMS, metres) treated as "fully rough"
SCIENCE_RADIUS_M = 80.0
SITE_VISIT_RADIUS_M = 60.0
HAZARD_REF_M = 400.0  # 400 m at risk 1.0 == one unit of hazard exposure
MIN_FACTOR = 0.05

DIRS = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
MODES = ("shortest", "safest", "optimal")
DEFAULT_WEIGHTS = {"distance": 0.20, "time": 0.15, "energy": 0.20, "risk": 0.35, "science": 0.10}
CLASS_NAMES = ("safe", "moderate", "high_risk", "impassable", "unknown")


def normalise_weights(weights: dict | None) -> dict:
    w = dict(DEFAULT_WEIGHTS)
    for k, v in (weights or {}).items():
        if k in w and v is not None:
            w[k] = max(0.0, float(v))
    total = sum(w.values())
    if total <= 0:
        return dict(DEFAULT_WEIGHTS)
    return {k: v / total for k, v in w.items()}


def _shift(a: np.ndarray, dr: int, dc: int, fill) -> np.ndarray:
    """out[r, c] = a[r + dr, c + dc], or ``fill`` outside the grid."""
    out = np.full_like(a, fill)
    h, w = a.shape
    r0, r1 = max(0, -dr), min(h, h - dr)
    c0, c1 = max(0, -dc), min(w, w - dc)
    out[r0:r1, c0:c1] = a[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
    return out


def analyse(terrain: Terrain, p: Profile) -> dict:
    """Per-cell risk estimate and terrain class for one mobility profile."""
    nodata = np.isnan(terrain.elevation)
    slope = np.where(nodata, 0.0, terrain.slope_deg).astype(np.float64)
    rough_n = np.clip(np.where(nodata, 0.0, terrain.roughness) / ROUGH_REF_M, 0.0, 1.0)
    risk = np.clip(0.65 * slope / p.max_slope_deg + 0.35 * rough_n, 0.0, 1.0)
    cls = np.zeros(terrain.shape, dtype=np.uint8)
    cls[risk >= 0.35] = 1
    cls[risk >= 0.60] = 2
    cls[terrain.confidence < 0.35] = 4
    cls[slope > p.max_slope_deg] = 3
    cls[nodata] = 4
    risk[nodata] = np.nan
    return {"risk": risk, "rough_n": rough_n, "cls": cls, "nodata": nodata, "slope": slope}


def obstacle_mask(shape: tuple[int, int], obstacles: list | None) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    if not obstacles:
        return mask
    rr, cc = np.mgrid[0:shape[0], 0:shape[1]]
    for ob in obstacles:
        mask |= np.hypot(rr - ob["row"], cc - ob["col"]) <= ob.get("radius", 3)
    return mask


def science_field(terrain: Terrain) -> np.ndarray:
    field = np.zeros(terrain.shape, dtype=np.float64)
    rr, cc = np.mgrid[0:terrain.shape[0], 0:terrain.shape[1]]
    for s in terrain.science_sites:
        d = np.hypot(rr - s["row"], cc - s["col"]) * terrain.cell_size
        field += float(s.get("value", 0.5)) * np.exp(-((d / SCIENCE_RADIUS_M) ** 2))
    return np.clip(field, 0.0, 1.0)


def build_edges(terrain: Terrain, p: Profile, an: dict, blocked: np.ndarray, weights: dict) -> dict:
    """Vectorised per-direction edge attributes and costs for the whole grid."""
    nodata = an["nodata"]
    z = np.where(nodata, 0.0, terrain.elevation).astype(np.float64)
    risk0 = np.where(nodata, 1.0, an["risk"])
    conf0 = terrain.confidence.astype(np.float64)
    rough0 = an["rough_n"]
    sci0 = science_field(terrain)
    passable = ~nodata & (an["slope"] <= p.max_slope_deg) & ~blocked

    e_flat_per_m = (p.mass_kg * G_MARS * p.crr / p.efficiency + p.base_power_w / p.speed_mps) / 3600.0
    out = {"passable": passable, "e_flat_per_m": e_flat_per_m, "dirs": []}
    for dr, dc in DIRS:
        dh = terrain.cell_size * math.hypot(dr, dc)
        dz = _shift(z, dr, dc, 0.0) - z
        d3 = np.sqrt(dh * dh + dz * dz)
        theta = np.arctan2(dz, dh)
        grade = np.abs(np.degrees(theta))
        valid = passable & _shift(passable, dr, dc, False) & (grade <= p.max_slope_deg)
        if dr and dc:  # no cutting corners past a blocked cell
            valid &= _shift(passable, dr, 0, False) & _shift(passable, 0, dc, False)

        risk_e = 0.5 * (risk0 + _shift(risk0, dr, dc, 1.0))
        conf_e = 0.5 * (conf0 + _shift(conf0, dr, dc, 0.0))
        rough_e = 0.5 * (rough0 + _shift(rough0, dr, dc, 0.0))
        sci_e = 0.5 * (sci0 + _shift(sci0, dr, dc, 0.0))

        v = p.speed_mps * np.maximum(0.25, 1.0 - 0.5 * grade / p.max_slope_deg - 0.3 * rough_e)
        t = d3 / v
        crr_eff = p.crr * (1.0 + 2.0 * rough_e)
        e_mech = np.maximum(0.0, p.mass_kg * G_MARS * (crr_eff * np.cos(theta) * d3 + dz))
        energy = (e_mech / p.efficiency + p.base_power_w * t) / 3600.0  # Wh

        penalty = 40.0 * risk_e**2 + 6.0 * (1.0 - conf_e) ** 2
        t_factor = p.speed_mps / v
        e_factor = np.clip(energy / (e_flat_per_m * d3), 0.2, 10.0)
        opt_factor = np.maximum(
            MIN_FACTOR,
            weights["distance"] + weights["time"] * t_factor + weights["energy"] * e_factor
            + weights["risk"] * penalty - 0.6 * weights["science"] * sci_e,
        )
        costs = {"shortest": d3, "safest": d3 * (1.0 + penalty), "optimal": d3 * opt_factor}
        for k in costs:
            costs[k] = np.where(valid, costs[k], np.inf)
        out["dirs"].append({"d3": d3, "dz": dz, "t": t, "energy": energy, "risk": risk_e, "conf": conf_e,
                            "grade": grade, "valid": valid, "cost": costs})
    out["h_scale"] = {
        "shortest": 1.0,
        "safest": 1.0,
        "optimal": max(MIN_FACTOR, weights["distance"] + weights["time"] + 0.2 * weights["energy"] - 0.6 * weights["science"]),
    }
    return out


def astar(cost_dirs: list, shape: tuple[int, int], cell: float, start: int, goal: int, h_scale: float):
    """A* on an 8-connected grid. ``cost_dirs[k][u]`` is the cost of leaving
    cell ``u`` in direction ``DIRS[k]`` (inf if not allowed). The heuristic is
    the octile distance times the smallest possible cost per metre, which is
    admissible and consistent, so the returned path is optimal."""
    h, w = shape
    n = h * w
    offs = [dr * w + dc for dr, dc in DIRS]
    gr, gc = divmod(goal, w)
    hs = h_scale * cell
    sqrt2m1 = math.sqrt(2.0) - 1.0
    inf = math.inf

    g = [inf] * n
    parent = [-1] * n
    closed = bytearray(n)
    g[start] = 0.0
    heap = [(0.0, 0.0, start)]
    expanded = 0
    while heap:
        _, gu, u = heapq.heappop(heap)
        if closed[u]:
            continue
        if u == goal:
            break
        closed[u] = 1
        expanded += 1
        for k in range(8):
            c = cost_dirs[k][u]
            if c == inf:
                continue
            v = u + offs[k]
            if closed[v]:
                continue
            ng = gu + c
            if ng < g[v]:
                g[v] = ng
                parent[v] = u
                vr, vc = divmod(v, w)
                dy = abs(vr - gr)
                dx = abs(vc - gc)
                hv = hs * ((dx if dx > dy else dy) + sqrt2m1 * (dy if dx > dy else dx))
                heapq.heappush(heap, (ng + hv, ng, v))
    if g[goal] == inf:
        return None, inf, expanded
    path = [goal]
    while path[-1] != start:
        path.append(parent[path[-1]])
    path.reverse()
    return path, g[goal], expanded


def _terrain_reason(terrain: Terrain, p: Profile, an: dict, blocked: np.ndarray, rc: tuple[int, int], name: str) -> str | None:
    r, c = rc
    if an["nodata"][r, c]:
        return f"The {name} point has no elevation data."
    if blocked[r, c]:
        return f"The {name} point is inside a reported obstacle."
    if an["slope"][r, c] > p.max_slope_deg:
        return (f"The {name} point sits on a {an['slope'][r, c]:.1f} deg slope, above the "
                f"{p.max_slope_deg:.0f} deg limit of this profile.")
    return None


def _route_metrics(terrain: Terrain, p: Profile, an: dict, edges: dict, path: list, total_cost: float) -> dict:
    h, w = terrain.shape
    idx = np.asarray(path)
    rows, cols = np.divmod(idx, w)
    off_to_k = {dr * w + dc: k for k, (dr, dc) in enumerate(DIRS)}
    ks = [off_to_k[int(b - a)] for a, b in zip(path[:-1], path[1:])]

    def gather(key: str) -> np.ndarray:
        return np.array([edges["dirs"][k][key].flat[u] for k, u in zip(ks, path[:-1])], dtype=np.float64)

    d3, dz, t, en, risk_e, conf_e = (gather(k) for k in ("d3", "dz", "t", "energy", "risk", "conf"))
    dist = np.concatenate([[0.0], np.cumsum(d3)])
    energy = np.concatenate([[0.0], np.cumsum(en)])
    time_s = np.concatenate([[0.0], np.cumsum(t)])
    hazard = float(np.sum(risk_e**2 * d3) / HAZARD_REF_M)

    cell_risk = an["risk"][rows, cols]
    cell_slope = an["slope"][rows, cols]
    cell_conf = terrain.confidence[rows, cols]
    cls = an["cls"][rows, cols]

    visited, science = [], 0.0
    for s in terrain.science_sites:
        dmin = float(np.min(np.hypot(rows - s["row"], cols - s["col"])) * terrain.cell_size)
        if dmin <= SITE_VISIT_RADIUS_M:
            visited.append(s["name"])
            science += float(s.get("value", 0.5))

    usable = p.capacity_wh * (1.0 - p.reserve_frac)
    total_e = float(energy[-1])
    costs = {m: float(sum(edges["dirs"][k]["cost"][m].flat[u] for k, u in zip(ks, path[:-1]))) for m in MODES}
    return {
        "path": [[int(r), int(c)] for r, c in zip(rows, cols)],
        "profile": {
            "dist": np.round(dist, 1).tolist(),
            "elev": np.round(terrain.elevation[rows, cols].astype(np.float64), 2).tolist(),
            "slope": np.round(cell_slope, 2).tolist(),
            "risk": np.round(cell_risk, 3).tolist(),
            "conf": np.round(cell_conf.astype(np.float64), 3).tolist(),
            "energy": np.round(energy, 2).tolist(),
            "time": np.round(time_s, 1).tolist(),
        },
        "metrics": {
            "distance_m": round(float(dist[-1]), 1),
            "straight_line_m": round(float(np.hypot(rows[-1] - rows[0], cols[-1] - cols[0]) * terrain.cell_size), 1),
            "duration_s": round(float(time_s[-1]), 1),
            "energy_wh": round(total_e, 1),
            "energy_usable_wh": round(usable, 1),
            "energy_margin_wh": round(usable - total_e, 1),
            "energy_feasible": bool(total_e <= usable),
            "ascent_m": round(float(np.sum(np.maximum(dz, 0.0))), 1),
            "descent_m": round(float(np.sum(np.maximum(-dz, 0.0))), 1),
            "max_slope_deg": round(float(np.max(cell_slope)), 1),
            "mean_risk": round(float(np.mean(risk_e)), 3),
            "max_risk": round(float(np.max(cell_risk)), 3),
            "hazard_exposure": round(hazard, 3),
            "risk_score": round(100.0 * (1.0 - math.exp(-hazard)), 1),
            "min_confidence": round(float(np.min(cell_conf)), 2),
            "mean_confidence": round(float(np.mean(conf_e)), 2),
            "science_score": round(science, 2),
            "science_sites": visited,
            "class_fractions": {name: round(float(np.mean(cls == i)), 3) for i, name in enumerate(CLASS_NAMES)},
            "objective_cost": round(float(total_cost), 2),
            "cost_under": {m: round(v, 2) for m, v in costs.items()},
        },
    }


def plan_routes(terrain: Terrain, p: Profile, start: tuple[int, int], goal: tuple[int, int],
                weights: dict | None = None, obstacles: list | None = None, modes: tuple = MODES) -> dict:
    h, w = terrain.shape
    for name, (r, c) in (("start", start), ("goal", goal)):
        if not (0 <= r < h and 0 <= c < w):
            raise ValueError(f"{name} is outside the map")
    wts = normalise_weights(weights)
    an = analyse(terrain, p)
    blocked = obstacle_mask(terrain.shape, obstacles)
    edges = build_edges(terrain, p, an, blocked, wts)

    reason = _terrain_reason(terrain, p, an, blocked, start, "start") or _terrain_reason(terrain, p, an, blocked, goal, "goal")
    s_idx, g_idx = start[0] * w + start[1], goal[0] * w + goal[1]
    routes = {}
    for mode in modes:
        if reason:
            routes[mode] = {"status": "unreachable", "reason": reason}
            continue
        cost_lists = [d["cost"][mode].ravel().tolist() for d in edges["dirs"]]
        path, total, expanded = astar(cost_lists, terrain.shape, terrain.cell_size, s_idx, g_idx, edges["h_scale"][mode])
        if path is None:
            routes[mode] = {"status": "unreachable", "expanded": expanded,
                            "reason": "No traversable connection exists between the two points under the current "
                                      "slope limit and reported obstacles."}
            continue
        routes[mode] = {"status": "ok", "expanded": expanded, **_route_metrics(terrain, p, an, edges, path, total)}
    return {"routes": routes, "weights": wts, "analysis": an, "edges": edges}
