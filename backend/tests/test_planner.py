"""Validation of the terrain engine and the three-route planner.

Run from the backend folder:  python -m pytest -q
"""
from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

from app.explain import explain
from app.main import _suggest_points
from app.planner import DIRS, MODES, analyse, build_edges, normalise_weights, obstacle_mask, plan_routes
from app.profiles import PROFILES, resolve
from app.terrain import Terrain, load_geotiff, make_demo_terrain

ASTRO = PROFILES["astronaut_eva"]


def flat(n: int = 60, cell: float = 10.0) -> np.ndarray:
    return np.full((n, n), -2500.0, dtype=np.float32)


def terrain_of(z: np.ndarray, cell: float = 10.0, conf: np.ndarray | None = None) -> Terrain:
    return Terrain(z, np.ones_like(z) if conf is None else conf, cell, {"simulated": True}, [])


def in_mask(path: list, mask: np.ndarray) -> bool:
    return any(mask[r, c] for r, c in path)


@pytest.fixture(scope="module")
def demo() -> Terrain:
    return make_demo_terrain()


# 1. Two points on nearly flat terrain ---------------------------------------
def test_flat_terrain_gives_straight_octile_path():
    t = terrain_of(flat())
    res = plan_routes(t, ASTRO, (50, 5), (10, 45))
    for mode in MODES:
        m = res["routes"][mode]["metrics"]
        assert res["routes"][mode]["status"] == "ok"
        assert m["distance_m"] == pytest.approx(40 * math.sqrt(2) * 10.0, rel=1e-3)
    # On featureless ground the three strategies cost the same distance.
    assert res["routes"]["safest"]["metrics"]["hazard_exposure"] == pytest.approx(0.0, abs=1e-6)


# 2. Two points separated by a crater ----------------------------------------
def test_route_goes_around_a_crater():
    n = 80
    z = flat(n).astype(np.float64)
    y, x = np.mgrid[0:n, 0:n]
    d = np.hypot(x - 40, y - 40)
    z += np.where(d < 14, -70.0 * (1 - (d / 14) ** 2), 0.0)  # steep bowl
    t = terrain_of(z.astype(np.float32))
    res = plan_routes(t, ASTRO, (40, 5), (40, 75))
    an = analyse(t, ASTRO)
    steep = an["slope"] > ASTRO.max_slope_deg
    assert steep.any()
    for mode in MODES:
        r = res["routes"][mode]
        assert r["status"] == "ok"
        assert not in_mask(r["path"], steep)
        assert r["metrics"]["distance_m"] > 700.0  # the straight line is 700 m
    cost = {m: res["routes"][m]["metrics"]["cost_under"]["safest"] for m in MODES}
    assert cost["safest"] <= min(cost.values()) + 0.01


# 3. Steep terrain: slope limit is respected and depends on the profile -------
def test_slope_limit_is_enforced():
    n = 60
    z = flat(n).astype(np.float64)
    z[:, 30:] += 0.45 * 10.0 * (np.arange(30))  # ~24 deg ramp on the east half
    t = terrain_of(z.astype(np.float32))
    blocked = plan_routes(t, ASTRO, (30, 5), (30, 55))  # astronaut limit is 20 deg
    assert blocked["routes"]["shortest"]["status"] == "unreachable"
    rover = plan_routes(t, PROFILES["rover_large"], (30, 5), (30, 55))  # rover limit is 30 deg
    assert rover["routes"]["shortest"]["status"] == "ok"
    assert rover["routes"]["shortest"]["metrics"]["ascent_m"] > 50.0


# 4. Insufficient elevation data ---------------------------------------------
def test_missing_data_is_never_crossed():
    z = flat(60)
    z[20:40, 25:35] = np.nan
    t = terrain_of(z)
    res = plan_routes(t, ASTRO, (30, 5), (30, 55))
    nodata = np.isnan(t.elevation)
    for mode in MODES:
        assert res["routes"][mode]["status"] == "ok"
        assert not in_mask(res["routes"][mode]["path"], nodata)
    assert analyse(t, ASTRO)["cls"][30, 30] == 4  # classified "unknown", not "safe"
    inside = plan_routes(t, ASTRO, (30, 30), (30, 55))
    assert inside["routes"]["shortest"]["status"] == "unreachable"
    assert "no elevation data" in inside["routes"]["shortest"]["reason"]


def test_low_confidence_is_avoided_by_safest_but_not_called_impassable():
    z = flat(60)
    conf = np.ones_like(z)
    conf[:, 25:35] = 0.1
    conf[50:, :] = 1.0  # a well-mapped corridor along the south edge
    t = terrain_of(z, conf=conf)
    res = plan_routes(t, ASTRO, (20, 5), (20, 55))
    assert res["routes"]["shortest"]["metrics"]["min_confidence"] < 0.35
    assert res["routes"]["safest"]["metrics"]["min_confidence"] >= 0.9
    assert res["routes"]["safest"]["metrics"]["distance_m"] > res["routes"]["shortest"]["metrics"]["distance_m"]


# 5. Low-battery mission ------------------------------------------------------
def test_low_energy_budget_is_flagged_infeasible(demo):
    pts = _suggest_points(demo)
    ok = plan_routes(demo, ASTRO, tuple(pts["start"]), tuple(pts["goal"]))
    assert ok["routes"]["optimal"]["metrics"]["energy_feasible"]
    low = resolve("astronaut_eva", {"capacity_wh": 300.0})
    res = plan_routes(demo, low, tuple(pts["start"]), tuple(pts["goal"]))
    m = res["routes"]["optimal"]["metrics"]
    assert not m["energy_feasible"] and m["energy_margin_wh"] < 0
    titles = [e["title"] for e in explain(demo, low, res["routes"], res["weights"])]
    assert "Energy budget exceeded" in titles


# 6. Degraded mobility (e.g. a wheel fault lowers the safe slope) -------------
def test_degraded_mobility_changes_or_removes_the_route(demo):
    pts = _suggest_points(demo)
    start, goal = tuple(pts["start"]), tuple(pts["goal"])
    healthy = plan_routes(demo, ASTRO, start, goal)["routes"]["shortest"]
    weak = plan_routes(demo, resolve("astronaut_eva", {"max_slope_deg": 12.0}), start, goal)["routes"]["shortest"]
    assert healthy["metrics"]["max_slope_deg"] > 12.0
    if weak["status"] == "ok":
        assert weak["metrics"]["max_slope_deg"] <= 12.0
        assert weak["metrics"]["distance_m"] >= healthy["metrics"]["distance_m"]


# 7. Dynamic obstacle discovery -----------------------------------------------
def test_new_obstacle_forces_a_replan(demo):
    pts = _suggest_points(demo)
    start, goal = tuple(pts["start"]), tuple(pts["goal"])
    first = plan_routes(demo, ASTRO, start, goal)["routes"]["optimal"]
    here = tuple(first["path"][40])
    ahead = first["path"][55]
    obstacle = [{"row": ahead[0], "col": ahead[1], "radius": 4}]
    second = plan_routes(demo, ASTRO, here, goal, obstacles=obstacle)["routes"]["optimal"]
    assert second["status"] == "ok"
    assert not in_mask(second["path"], obstacle_mask(demo.shape, obstacle))
    # Removing options can never make the best achievable objective better.
    unobstructed = plan_routes(demo, ASTRO, here, goal)["routes"]["optimal"]
    assert in_mask(unobstructed["path"], obstacle_mask(demo.shape, obstacle))
    assert second["metrics"]["objective_cost"] >= unobstructed["metrics"]["objective_cost"] - 0.01
    assert second["path"] != unobstructed["path"]


# 9. Changing mission priorities ----------------------------------------------
def test_optimal_route_follows_the_weights(demo):
    pts = _suggest_points(demo)
    start, goal = tuple(pts["start"]), tuple(pts["goal"])
    dist_first = plan_routes(demo, ASTRO, start, goal, weights={"distance": 1, "time": 0, "energy": 0, "risk": 0, "science": 0})
    risk_first = plan_routes(demo, ASTRO, start, goal, weights={"distance": 0.05, "time": 0, "energy": 0, "risk": 1, "science": 0})
    a, b = dist_first["routes"]["optimal"]["metrics"], risk_first["routes"]["optimal"]["metrics"]
    # Pure-distance weighting reproduces the shortest route.
    assert a["distance_m"] == pytest.approx(dist_first["routes"]["shortest"]["metrics"]["distance_m"], rel=1e-9)
    assert b["hazard_exposure"] < a["hazard_exposure"]
    assert b["distance_m"] > a["distance_m"]


def test_science_weight_pulls_route_towards_sites(demo):
    pts = _suggest_points(demo)
    start, goal = tuple(pts["start"]), tuple(pts["goal"])
    none = plan_routes(demo, ASTRO, start, goal, weights={"distance": 1, "time": 0, "energy": 0, "risk": 0.3, "science": 0})
    high = plan_routes(demo, ASTRO, start, goal, weights={"distance": 1, "time": 0, "energy": 0, "risk": 0.3, "science": 3})
    assert high["routes"]["optimal"]["metrics"]["science_score"] >= none["routes"]["optimal"]["metrics"]["science_score"]


# 10. Unreachable destination -------------------------------------------------
def test_walled_off_goal_is_reported_unreachable():
    z = flat(60)
    z[:, 30] = np.nan  # a full-height gap in the data
    t = terrain_of(z)
    res = plan_routes(t, ASTRO, (30, 5), (30, 55))
    for mode in MODES:
        assert res["routes"][mode]["status"] == "unreachable"
        assert res["routes"][mode]["reason"]
    assert explain(t, ASTRO, res["routes"], res["weights"])[0]["title"] == "No route available"


# Optimality: A* against an independent Dijkstra implementation ---------------
@pytest.mark.parametrize("profile_id", ["astronaut_eva", "rover_large"])
def test_astar_matches_scipy_dijkstra(demo, profile_id):
    p = PROFILES[profile_id]
    pts = _suggest_points(demo)
    start, goal = tuple(pts["start"]), tuple(pts["goal"])
    res = plan_routes(demo, p, start, goal)
    h, w = demo.shape
    edges = res["edges"]
    idx = np.arange(h * w)
    for mode in MODES:
        rows, cols, vals = [], [], []
        for k, (dr, dc) in enumerate(DIRS):
            c = edges["dirs"][k]["cost"][mode].ravel()
            ok = np.isfinite(c)
            rows.append(idx[ok]); cols.append(idx[ok] + dr * w + dc); vals.append(c[ok])
        graph = coo_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(h * w, h * w)).tocsr()
        ref = dijkstra(graph, directed=True, indices=start[0] * w + start[1])[goal[0] * w + goal[1]]
        assert np.isfinite(ref)
        assert res["routes"][mode]["metrics"]["objective_cost"] == pytest.approx(ref, abs=0.01)  # value is rounded to 0.01


def test_each_route_wins_on_its_own_objective(demo):
    pts = _suggest_points(demo)
    res = plan_routes(demo, ASTRO, tuple(pts["start"]), tuple(pts["goal"]))
    cost = {m: res["routes"][m]["metrics"]["cost_under"] for m in MODES}
    for mode in MODES:
        assert all(cost[mode][mode] <= cost[other][mode] + 1e-6 for other in MODES)
    # "Shortest" really is the shortest traversable length.
    assert all(res["routes"]["shortest"]["metrics"]["distance_m"] <= res["routes"][m]["metrics"]["distance_m"] + 0.1 for m in MODES)


def test_paths_are_connected_and_stay_on_allowed_cells(demo):
    pts = _suggest_points(demo)
    res = plan_routes(demo, ASTRO, tuple(pts["start"]), tuple(pts["goal"]))
    passable = res["edges"]["passable"]
    for mode in MODES:
        path = res["routes"][mode]["path"]
        assert path[0] == pts["start"] and path[-1] == pts["goal"]
        assert all(max(abs(a[0] - b[0]), abs(a[1] - b[1])) == 1 for a, b in zip(path[:-1], path[1:]))
        assert all(passable[r, c] for r, c in path)


def test_weights_are_normalised():
    w = normalise_weights({"distance": 2, "risk": 2, "time": 0, "energy": 0, "science": 0})
    assert sum(w.values()) == pytest.approx(1.0) and w["distance"] == pytest.approx(0.5)


# Real-data path: a GeoTIFF round trip ----------------------------------------
def test_geotiff_loader_preserves_elevation_resolution_and_nodata(tmp_path):
    rasterio = pytest.importorskip("rasterio")
    from rasterio.transform import from_origin

    yy, xx = np.mgrid[0:50, 0:40]
    z = (0.1 * xx + 0.05 * yy - 2500.0).astype(np.float32)  # gentle ramp, about 3 deg
    z[0:5, 0:5] = -32768.0
    path = tmp_path / "dtm.tif"
    with rasterio.open(path, "w", driver="GTiff", height=50, width=40, count=1, dtype="float32",
                       transform=from_origin(1000.0, 5000.0, 2.0, 2.0), nodata=-32768.0) as ds:
        ds.write(z, 1)
    t = load_geotiff(str(path))
    assert t.shape == (50, 40)
    assert t.cell_size == pytest.approx(2.0)
    assert t.meta["simulated"] is False
    assert np.isnan(t.elevation[2, 2]) and t.confidence[2, 2] == 0.0
    assert t.elevation[30, 20] == pytest.approx(z[30, 20])
    res = plan_routes(t, ASTRO, (45, 5), (10, 35))
    assert res["routes"]["shortest"]["status"] == "ok"
    assert not in_mask(res["routes"]["shortest"]["path"], np.isnan(t.elevation))


# API -------------------------------------------------------------------------
def test_api_end_to_end():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    terr = client.get("/api/terrain").json()
    assert terr["meta"]["simulated"] is False
    assert 'CTX' in terr['meta']['source']
    assert terr['science_sites'] == []
    body = {"start": terr["suggested"]["start"], "goal": terr["suggested"]["goal"], "profile": "astronaut_eva"}
    out = client.post("/api/routes", json=body).json()
    assert set(out["routes"]) == set(MODES)
    assert all(out["routes"][m]["status"] == "ok" for m in MODES)
    assert out["explanations"]
    assert client.post("/api/routes", json={**body, "profile": "nope"}).status_code == 404
    assert client.post("/api/routes", json={**body, "goal": [9999, 0]}).status_code == 422
