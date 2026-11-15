"""Site intelligence: decision rules, Jezero pack lookups and the HTTP contract."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import jezero as pack
from app.landing import jezero as jezero_terrain
from app.main import app
from app.profiles import PROFILES, resolve
from app.site_intel import Evidence, decide

client = TestClient(app)
EVA = PROFILES["astronaut_eva"]
LANDING_SITE = {"latitude": 18.4446, "longitude": 77.4509}  # Octavia E. Butler landing
LANDING = (18.4446, 77.4509)


def codes(verdict):
    return [reason["code"] for reason in verdict["reasons"]]


# --- decision rules (pure) -------------------------------------------------

def test_gentle_local_cell_is_go():
    verdict = decide(Evidence("local", slope_deg=2.0, roughness_m=0.2, terrain_class="safe", blocked_share=0.0), EVA)
    assert verdict["status"] == "go" and verdict["confidence"] == "local"
    assert codes(verdict) == ["slope_within_limit"]


def test_slope_beyond_profile_limit_blocks_and_is_listed_first():
    verdict = decide(Evidence("local", slope_deg=27.0, roughness_m=2.0, terrain_class="impassable"), EVA)
    assert verdict["status"] == "no_go"
    first = verdict["reasons"][0]
    assert first["code"] == "slope_exceeds_limit" and first["value"] == 27.0 and first["limit"] == EVA.max_slope_deg


def test_same_cell_changes_with_the_mobility_profile():
    evidence = Evidence("local", slope_deg=25.0, roughness_m=0.3, terrain_class="high_risk")
    assert decide(evidence, EVA)["status"] == "no_go"
    assert decide(evidence, PROFILES["rover_large"])["status"] == "caution"


@pytest.mark.parametrize("evidence, code", [
    (Evidence("local", 5.0, 1.9, "moderate"), "rough_surface"),
    (Evidence("local", 5.0, 0.2, "safe", blocked_share=0.7), "surrounded_by_blocked"),
    (Evidence("local", 5.0, 0.2, "safe", rim_distance_km=0.1), "near_crater_rim"),
    (Evidence("local", 5.0, 0.2, "safe", unit_symbol="Aeb", unit_name="Eolian bedform unit"), "loose_bedforms"),
])
def test_each_warning_downgrades_go_to_caution(evidence, code):
    verdict = decide(evidence, EVA)
    assert verdict["status"] == "caution" and code in codes(verdict)


def test_unknown_ground_is_never_reported_as_safe():
    regional = decide(Evidence("regional", slope_deg=0.4), EVA)
    assert regional["status"] == "unknown" and "no_local_terrain" in codes(regional)
    assert decide(Evidence("regional"), EVA)["status"] == "unknown"
    assert decide(Evidence("local", terrain_class="unknown"), EVA)["status"] == "unknown"


def test_regional_slope_beyond_limit_is_a_block():
    verdict = decide(Evidence("regional", slope_deg=24.0), EVA)
    assert verdict["status"] == "no_go" and verdict["confidence"] == "regional"


# --- Jezero pack repository ------------------------------------------------

def test_pack_is_installed_with_expected_counts():
    counts = pack.manifest()["counts"]
    assert counts == {"geologic_polygons": 1308, "geologic_units": 14, "surface_features": 285,
                      "small_craters": 341, "rover_waypoints": 708, "rover_images": 708}


def test_geologic_unit_lookup_matches_the_published_map():
    floor = pack.geologic_unit_at(*LANDING)
    assert floor["symbol"] == "Njf" and floor["name"] == "Jezero floor unit"
    assert floor["color"].startswith("#") and "doi.org/10.3133/sim3464" in floor["citation"]
    assert pack.geologic_unit_at(18.48, 77.40)["symbol"] == "NHjf2"  # western fan
    assert pack.geologic_unit_at(0.0, 0.0) is None and not pack.in_map(0.0, 0.0)


def test_landing_ellipse_and_out_of_map_are_distinguished():
    assert pack.in_landing_ellipse(*LANDING) is True
    assert pack.in_landing_ellipse(18.2, 77.0) is False
    assert pack.in_landing_ellipse(0.0, 0.0) is None


def test_nearest_waypoint_reports_distance_and_never_claims_a_remote_image():
    here = pack.nearest_waypoint(*LANDING)
    assert here["sol"] == 13 and here["distanceM"] < 25 and here["imageAtSelection"]
    assert here["images"][0]["url"].startswith("https://mars.nasa.gov/")
    away = pack.nearest_waypoint(18.2, 77.0)
    assert away["distanceM"] > 10_000 and not away["imageAtSelection"]
    assert pack.nearest_waypoint(-14.0, -63.3) is None


def test_mars_distance_uses_the_mars_radius():
    one_degree = pack.distance_m(0.0, 0.0, np.array([1.0]), np.array([0.0]))[0]
    assert one_degree == pytest.approx(59_274.7, rel=1e-4)  # Earth would give ~111 km


# --- HTTP contract ---------------------------------------------------------

def test_site_endpoint_at_the_landing_site():
    data = client.get("/api/site", params=LANDING_SITE).json()
    assert data["region"]["name"] == "Jezero"
    assert data["verdict"]["status"] in ("go", "caution")
    assert data["terrain"]["level"] == "local" and data["terrain"]["resolutionM"] == 20
    assert data["geology"]["symbol"] == "Njf" and data["landingEllipse"] and data["inJezeroMap"]
    assert data["rover"]["sol"] == 13
    assert {item["key"] for item in data["unavailable"]} == {"rocks", "soil", "weather", "radiation"}


def test_site_endpoint_far_from_local_coverage_stays_unknown():
    data = client.get("/api/site", params={"latitude": -14.02, "longitude": -63.32}).json()
    assert data["verdict"]["status"] == "unknown" and data["terrain"]["level"] == "regional"
    assert data["geology"] is None and data["rover"] is None and data["landingEllipse"] is None
    assert not data["routeAvailable"]


def test_steepest_local_cell_is_no_go_with_the_slope_reason():
    from rasterio.transform import xy
    from rasterio.warp import transform
    terrain, crs, affine = jezero_terrain()
    valid = np.where(terrain.confidence >= 0.8, terrain.slope_deg, -1)
    row, col = np.unravel_index(np.argmax(valid), valid.shape)
    x, y = xy(affine, int(row), int(col))
    lon, lat = transform(crs, crs.geodetic_crs, [x], [y])
    data = client.get("/api/site", params={"latitude": lat[0], "longitude": lon[0], "max_slope_deg": 10}).json()
    assert data["verdict"]["status"] == "no_go"
    assert data["verdict"]["reasons"][0]["code"] == "slope_exceeds_limit"
    assert data["profile"]["maxSlopeDeg"] == 10


def test_site_endpoint_validates_input():
    assert client.get("/api/site", params={"latitude": 91, "longitude": 0}).status_code == 422
    assert client.get("/api/site", params={"latitude": 0, "longitude": 181}).status_code == 422
    assert client.get("/api/site", params={**LANDING_SITE, "profile": "submarine"}).status_code == 404
    assert resolve("rover_large").max_slope_deg == 30


def test_overlay_and_legend_endpoints():
    track = client.get("/api/jezero/rover").json()
    assert len(track["points"]) == 708 and track["points"][0][2] == 13 and "NASA" in track["credit"]
    legend = client.get("/api/jezero/geology").json()
    assert len(legend["units"]) == 14 and all(unit["description"] for unit in legend["units"])
    assert sum(unit["polygonCount"] for unit in legend["units"]) == 1308


@pytest.fixture(autouse=True)
def isolate_remote_catalog(monkeypatch):
    monkeypatch.setattr('app.site_intel.point_sample', lambda lat, lon: None)
