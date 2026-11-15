"""Georeferenced local terrain and explainable routes for the A/B workspace."""
from datetime import datetime, timezone
import base64
import time
import re

import numpy as np
from rasterio.transform import Affine, xy
from rasterio.warp import transform

from .explain import explain
from .landing import CTX_SOURCE, local_grid
from .planner import analyse, normalise_weights, plan_routes
from .terrain import Terrain
from .terrain_api import remote_window, TerrainCoverageError, TerrainWindowTooLarge


class WorkspaceUnavailable(ValueError):
    """A planning limitation is missing evidence, not a terrain no-go verdict."""
    def __init__(self, code, message, missing_endpoints=()):
        super().__init__(message)
        self.code = code
        self.missing_endpoints = list(missing_endpoints)


def encoded(values, dtype):
    return base64.b64encode(np.ascontiguousarray(values, dtype=dtype).tobytes()).decode('ascii')


def route_verdict(route, profile):
    """Connectivity alone does not make an energy-infeasible path usable."""
    if route['status'] != 'ok':
        reason = route.get('reason') or 'No traversable connection exists between these endpoints.'
        slope = re.search(r'The (start|goal) point sits on a ([0-9.]+) deg slope', reason)
        if slope:
            endpoint = 'starting point A' if slope[1] == 'start' else 'destination B'
            reason = f"The {endpoint} is on a slope of {slope[2]}°, exceeding the mobility limit of {profile.max_slope_deg:g}°."
        elif reason.startswith('No traversable connection'):
            reason = 'No connection satisfies the current slope and obstacle limits. Orbital imagery alone does not establish traversability.'
        return {'status': 'no_go', 'label': 'Route unavailable',
                'reasons': [reason]}
    m = route['metrics']
    reasons = [f"Maximum slope {m['max_slope_deg']:.1f}°; mobility limit {profile.max_slope_deg:.0f}°."]
    if not m['energy_feasible']:
        reasons.append(f"Required energy {m['energy_wh']:.0f} Wh exceeds the available budget; reserve shortfall {abs(m['energy_margin_wh']):.0f} Wh.")
        status = 'no_go'
    else:
        reasons.append(f"Remaining margin {m['energy_margin_wh']:.0f} Wh above the energy reserve after travelling {m['distance_m']:.0f} m.")
        status = 'go'
    if m['min_confidence'] < 0.35:
        reasons.append('This route crosses cells with coverage confidence below 0.35. Elevation evidence is insufficient to confirm traversability.')
        if status != 'no_go':
            status = 'unknown'
    elif m['max_risk'] >= 0.65:
        reasons.append(f"Maximum modelled local risk {m['max_risk']:.2f} / 1 from slope and roughness; caution required.")
        if status == 'go':
            status = 'caution'
    else:
        reasons.append(f"Maximum modelled local risk {m['max_risk']:.2f} / 1 in the slope and roughness model.")
    reasons.append('Derived from orbital elevation. Small rocks, soil strength and current weather are unmeasured.')
    return {'status': status, 'label': {'go': 'Usable within model limits', 'caution': 'Usable with caution',
                                      'unknown': 'Unconfirmed — missing evidence', 'no_go': 'Insufficient energy budget'}[status],
            'reasons': reasons}


def workspace(origin, destination, profile, weights):
    first = local_grid(origin.latitude, origin.longitude)
    last = local_grid(destination.latitude, destination.longitude)
    if first is not None and last is not None:
        terrain, crs, affine, sr, sc = first
        er, ec = map(int, last[3:])
    else:
        points = [(origin.latitude, origin.longitude), (destination.latitude, destination.longitude)]
        try:
            remote = remote_window(points)
        except TerrainWindowTooLarge as error:
            raise WorkspaceUnavailable('window_too_large', str(error)) from error
        except TerrainCoverageError as error:
            raise WorkspaceUnavailable('terrain_service_unavailable', str(error)) from error
        if remote is None:
            missing = [name for name, sample in [('origin', first), ('destination', last)] if sample is None]
            raise WorkspaceUnavailable('missing_local_terrain',
                'No valid CTX elevation model covers both endpoints in the USGS catalog. Choose closer points in a covered area. Orbital imagery alone cannot establish traversability.', missing)
        terrain, crs, affine, cells = remote
        (sr, sc), (er, ec) = cells
    sr, sc = int(sr), int(sc)
    # At least a 2.4 km context around nearby selections; never resample the DEM.
    top, left = max(0, min(sr, er) - 60), max(0, min(sc, ec) - 60)
    bottom, right = min(terrain.shape[0], max(sr, er) + 61), min(terrain.shape[1], max(sc, ec) + 61)
    if max(bottom - top, right - left) > 300:
        raise WorkspaceUnavailable('window_too_large', 'The detailed planning window is limited to 6 km, including terrain margins. Choose closer endpoints.')
    section = np.s_[top:bottom, left:right]
    affine = affine * Affine.translation(left, top)
    h, w = bottom - top, right - left
    meta = {**terrain.meta, 'name': 'Selected A → B terrain', 'source': terrain.meta.get('source', CTX_SOURCE),
            'transform': list(affine)[:6], 'extent_m': [w * terrain.cell_size, h * terrain.cell_size]}
    local = Terrain(terrain.elevation[section], terrain.confidence[section], terrain.cell_size, meta)
    start, goal = (sr - top, sc - left), (er - top, ec - left)
    t0 = time.perf_counter()
    if start == goal:
        planned = {'analysis': analyse(local, profile), 'weights': normalise_weights(weights),
                   'routes': {key: {'status': 'unreachable', 'reason': 'Both endpoints occupy the same terrain cell. Choose a different destination.'}
                              for key in ('shortest', 'safest', 'optimal')}}
    else:
        planned = plan_routes(local, profile, start, goal, weights)
    routes = {key: {**route, 'verdict': route_verdict(route, profile)} for key, route in planned['routes'].items()}
    rr, cc = np.indices(local.shape)
    x, y = xy(affine, rr.ravel(), cc.ravel())
    longitude, latitude = transform(crs, crs.geodetic_crs, x, y)
    an = planned['analysis']
    return {
        'terrain': {'meta': meta, 'width': w, 'height': h, 'cell_size': local.cell_size,
                    'elevation': encoded(local.elevation, '<f4'), 'slope': encoded(local.slope_deg, '<f4'),
                    'roughness': encoded(local.roughness, '<f4'), 'confidence': encoded(np.round(local.confidence * 255), 'u1'),
                    'science_sites': [], 'suggested': {'start': start, 'goal': goal}},
        'geography': {'latitude': encoded(latitude, '<f4'), 'longitude': encoded(longitude, '<f4')},
        'result': {'profile': profile.to_dict(), 'weights': planned['weights'], 'routes': routes,
                   'explanations': explain(local, profile, planned['routes'], planned['weights']),
                   'layers': {'risk': encoded(np.round(np.nan_to_num(an['risk'], nan=1.0) * 255), 'u1'),
                              'cls': encoded(an['cls'], 'u1')},
                   'compute_ms': round((time.perf_counter() - t0) * 1000, 1)},
        'evaluatedAt': datetime.now(timezone.utc).isoformat(),
        'source': meta['source'], 'live': False,
    }
