"""Educational translational matching on a measured terrain grid."""
from scipy import ndimage
from scipy.signal import correlate2d
import numpy as np
from fastapi import APIRouter, HTTPException, Query

from .landing import jezero

router = APIRouter()
REFERENCE_ORIGIN = 64
REFERENCE_SIZE = 256
TEMPLATE_SIZE = 40


def normalize(image):
    return (image - image.mean()) / max(float(image.std()), 1e-6)


@router.get("/api/navigation/demo")
def navigation_demo(x: int = Query(146, ge=28, le=228), y: int = Query(130, ge=28, le=228),
                    noise: int = Query(20, ge=0, le=90), mode: str = Query("trn", pattern="^(trn|lvs)$")):
    region = jezero()
    if region is None:
        raise HTTPException(503, "Jezero terrain is unavailable")
    terrain, _, _ = region
    start, end = REFERENCE_ORIGIN, REFERENCE_ORIGIN + REFERENCE_SIZE
    elevation = terrain.elevation[start:end, start:end]
    dy, dx = np.gradient(elevation.astype(np.float64), terrain.cell_size)
    image = normalize((-0.55 * dx - 0.35 * dy + 0.76) / np.sqrt(1 + dx**2 + dy**2))
    half = TEMPLATE_SIZE // 2
    truth = np.array([y - half, x - half])
    reference_crop = image[truth[0]:truth[0] + TEMPLATE_SIZE, truth[1]:truth[1] + TEMPLATE_SIZE]
    rng = np.random.default_rng(2020)
    observation = normalize(ndimage.gaussian_filter(reference_crop, 0.65) + noise / 100 * rng.standard_normal(reference_crop.shape))
    kernel = np.ones((TEMPLATE_SIZE, TEMPLATE_SIZE))
    sums = correlate2d(image, kernel, mode="valid")
    squares = correlate2d(image**2, kernel, mode="valid")
    spread = np.sqrt(np.maximum(squares - sums**2 / kernel.size, 1e-8))
    correlation = np.clip(correlate2d(image, observation, mode="valid") / (spread * np.sqrt(kernel.size)), -1, 1)
    grid = correlation[::8, ::8]
    coarse = np.array(np.unravel_index(int(np.argmax(grid)), grid.shape)) * 8
    row, col = np.maximum(coarse - 9, 0)
    patch = correlation[row:coarse[0] + 10, col:coarse[1] + 10]
    fine = np.array(np.unravel_index(int(np.argmax(patch)), patch.shape)) + [row, col]
    separation = correlation.copy()
    separation[max(0, fine[0] - 10):fine[0] + 11, max(0, fine[1] - 10):fine[1] + 11] = -1
    peaks = ndimage.maximum_filter(np.hypot(dx, dy), size=17) == np.hypot(dx, dy)
    points = np.argwhere(peaks & (terrain.slope_deg[start:end, start:end] > 4))
    local = points[np.all((points >= fine) & (points < fine + TEMPLATE_SIZE), axis=1)]
    slopes = terrain.slope_deg[start:end, start:end]
    slope_window = ndimage.maximum_filter(slopes, size=9)
    match_y, match_x = fine + half
    origin_y, origin_x = max(0, match_y - 26), max(0, match_x - 26)
    near = np.s_[origin_y:match_y + 27, origin_x:match_x + 27]
    near_slopes = slope_window[near]
    rr, cc = np.indices(near_slopes.shape)
    displacement = np.hypot(rr - (match_y - origin_y), cc - (match_x - origin_x))
    candidates = np.where(near_slopes <= 8, displacement + near_slopes, np.inf)
    candidate = None
    if np.isfinite(candidates).any():
        cy, cx = np.unravel_index(int(np.argmin(candidates)), candidates.shape)
        candidate = [int(cx + origin_x), int(cy + origin_y)]

    def center(position):
        return [int(position[1] + half), int(position[0] + half)]

    def pixels(data):
        return np.clip(np.round(127.5 + 42 * data), 0, 255).astype("uint8").tolist()

    return {
        "mode": mode, "reference": pixels(image[::2, ::2]), "observation": pixels(observation),
        "coarse": center(coarse), "fine": center(fine), "truth": [x, y], "templateSize": TEMPLATE_SIZE,
        "cellSize": terrain.cell_size, "confidence": round(float(correlation[tuple(fine)]), 3),
        "peakGap": round(float(correlation[tuple(fine)] - separation.max()), 3),
        "errorM": round(float(np.linalg.norm(fine - truth) * terrain.cell_size), 1),
        "landmarks": [[int(c), int(r)] for r, c in local], "landingCandidate": candidate,
        "hazards": (slopes[::2, ::2] > 8).astype("uint8").tolist(),
    }
