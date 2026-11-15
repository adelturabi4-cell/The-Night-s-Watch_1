"""Normalize supplied display assets and the official USGS naming catalog."""
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET
import math

import numpy as np
import rasterio
import warnings
warnings.filterwarnings('ignore', category=rasterio.errors.NotGeoreferencedWarning)

def read_rgb(path):
    with rasterio.open(path) as image:
        pixels = image.read()
        if pixels.shape[0] == 1: pixels = np.repeat(pixels, 3, axis=0)
        return np.moveaxis(pixels[:3], 0, -1)

def save_rgb(path, pixels):
    with rasterio.open(path, 'w', driver='JPEG', height=pixels.shape[0], width=pixels.shape[1], count=3, dtype='uint8', quality=92) as image:
        image.write(np.moveaxis(pixels, -1, 0))

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'backend/data'
PUBLIC = ROOT / 'frontend/public/mars-data'
with zipfile.ZipFile(DATA / 'mars-names.kmz') as archive:
    xml = ET.fromstring(archive.read(next(name for name in archive.namelist() if name.endswith('.kml'))))
features = []
for point in xml.findall('.//{*}Placemark'):
    fields = {node.attrib['name']: node.text for node in point.findall('.//{*}SimpleData')}
    if fields.get('approval') != 'Adopted by IAU':
        continue
    features.append({'name': fields['clean_name'], 'latitude': float(fields['center_lat']),
                     'longitude': (float(fields['center_lon']) + 180) % 360 - 180,
                     'diameter': float(fields['diameter']), 'type': fields['type'],
                     'bounds': [float(fields[key]) for key in ['min_lon', 'min_lat', 'max_lon', 'max_lat']],
                     'source': fields['link'].replace('http:', 'https:')})
catalog = {'source': 'https://planetarynames.wr.usgs.gov/Page/MARS/target', 'retrieved': '2026-11-15',
           'geometry': 'Named feature centers, diameters and approximate bounding extents; not exact boundaries.', 'features': features}
for target in [DATA / 'mars-names.json', ROOT / 'frontend/src/regionCatalog.json']:
    target.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

# The supplied 0..360 texture is shifted to the application's -180..180 seam.
pixels = read_rgb(PUBLIC / 'mola/globe-color.jpg')
save_rgb(PUBLIC / 'mola/globe-180.jpg', np.roll(pixels, pixels.shape[1] // 2, axis=1))

# Assemble a bounded HiRISE quicklook mosaic. XYZ Mercator is used only for display.
spec = json.loads((PUBLIC / 'layers.json').read_text())['layers'][1]
west, south, east, north = spec['bounds']
level = 17  # Audit found that only level 17 is actually present in this pack.
n = 2 ** level
def tile_x(lon): return (lon + 180) / 360 * n
def tile_y(lat): return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
x0, x1 = math.floor(tile_x(west)), math.floor(tile_x(east))
y0, y1 = math.floor(tile_y(north)), math.floor(tile_y(south))
# Sample each equirectangular output row at its corresponding Mercator row.
width, height = 1200, 1400
rows = np.linspace(north, south, height)
ys = np.array([(tile_y(float(lat))-y0)*256 for lat in rows])
xs = np.linspace((tile_x(west)-x0)*256, (tile_x(east)-x0)*256, width)
out = np.zeros((height,width,4),dtype=np.uint8)
available = 0
for x in range(x0,x1+1):
    ix = np.flatnonzero((xs//256).astype(int) == x-x0)
    for y in range(y0,y1+1):
        iy = np.flatnonzero((ys//256).astype(int) == y-y0)
        path = PUBLIC / f'hirise/tiles/{level}/{x}/{y}.jpg'
        if not path.exists() or not len(ix) or not len(iy): continue
        available += 1
        pixels = read_rgb(path)
        out[iy[:,None],ix[None,:],:3] = pixels[(ys[iy].astype(int)%256)[:,None],(xs[ix].astype(int)%256)[None,:]]
        out[iy[:,None],ix[None,:],3] = 255
with rasterio.open(PUBLIC / 'hirise/site-equirect.png','w',driver='PNG',height=height,width=width,count=4,dtype='uint8') as dst:
    dst.write(np.moveaxis(out,-1,0))
(PUBLIC / 'integration-audit.json').write_text(json.dumps({'hirise':{'availableTiles':available,'expectedFootprintTiles':(x1-x0+1)*(y1-y0+1),'availableZooms':[17],'missingTiles':'Transparent, never interpolated as real observations.'},'names':len(features)}),encoding='utf-8')
print(f'Imported {len(features)} approved Mars names, normalized MOLA texture, and HiRISE display mosaic.')
