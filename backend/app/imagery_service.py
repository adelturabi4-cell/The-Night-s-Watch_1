"""A bounded same-origin cache for public planetary imagery tiles."""
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

router = APIRouter()
PRODUCTS = {
    "viking": ("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg", 7),
    "relief": ("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg", 7),
    "roughness": ("mola_roughness", "png", 1),
    "thermal": ("Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12_clon0_ly", "png", 8),
    "ctx": ("JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0", "png", 13),
}
CACHE = Path(__file__).resolve().parents[1] / 'data/imagery-cache'


def installed_tile(url):
    digest = sha256(url.encode()).hexdigest()
    for extension, media in [('jpg', 'image/jpeg'), ('png', 'image/png'), ('webp', 'image/webp')]:
        path = CACHE / f'{digest}.{extension}'
        if path.is_file():
            return media, path.read_bytes()
    return None


def store_tile(url, media, data):
    extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[media]
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f'{sha256(url.encode()).hexdigest()}.{extension}'
    with NamedTemporaryFile(dir=CACHE, suffix='.part', delete=False) as temp:
        temp.write(data)
        temporary = Path(temp.name)
    temporary.replace(path)


def tile_address(product, level, row, column):
    if product == "geology":
        maximum = 4
    elif product in PRODUCTS:
        _, _, maximum = PRODUCTS[product]
    else:
        return None
    if not 0 <= level <= maximum or not 0 <= row < 2 ** level or not 0 <= column < 2 ** (level + 1):
        return None
    if product == "geology":
        arcgis_level = level + 1
        arcgis_row = row + 2 ** level // 2
        # The ArcGIS cache starts at +180° latitude. Its level 1 tiles span 180°,
        # so rebasing tiles to the common grid requires level 2 or higher.
        if level == 0:
            return None
        return ("https://tiles.arcgis.com/tiles/nzS0F0zdNLvs7nc8/arcgis/rest/services/"
                f"Mars_geology_All_layers_100pct/MapServer/tile/{arcgis_level}/{arcgis_row}/{column}")
    dataset, extension, _ = PRODUCTS[product]
    return f"https://trek.nasa.gov/tiles/Mars/EQ/{dataset}/1.0.0/default/default028mm/{level}/{row}/{column}.{extension}"


@lru_cache(maxsize=128)
def fetch_tile(url):
    local = installed_tile(url)
    if local:
        return local
    with urlopen(Request(url, headers={"User-Agent": "MartianMap/1.0 planetary imagery"}), timeout=8) as upstream:
        media = upstream.headers.get_content_type()
        data = upstream.read(1_048_577)
    if media not in {"image/png", "image/jpeg", "image/webp"} or not data or len(data) > 1_048_576:
        raise ValueError("Unexpected tile response")
    if not (data.startswith(b'\xff\xd8') or data.startswith(b'\x89PNG') or data.startswith(b'RIFF')):
        raise ValueError('The imagery response is not a supported image')
    store_tile(url, media, data)
    return media, data


@router.get("/api/layers/{product}/{level}/{row}/{column}")
def layer_tile(product: str, level: int, row: int, column: int):
    address = tile_address(product, level, row, column)
    if address is None:
        raise HTTPException(404, "Unknown layer or tile outside the map")
    try:
        media, data = fetch_tile(address)
    except HTTPError as exc:
        if exc.code in (400, 404):
            raise HTTPException(404, "Imagery does not cover this tile") from exc
        raise HTTPException(502, "Imagery service unavailable") from exc
    except (OSError, URLError, ValueError) as exc:
        raise HTTPException(502, "Imagery service unavailable") from exc
    return Response(data, media_type=media, headers={"Cache-Control": "public, max-age=86400"})
