"""Install the data used by the application, with a resumable provenance manifest.

Global display layers are installed at overview scales. Detailed display tiles
and full available CTX models are installed around the application's named
regions and the four supplied HiRISE footprints. No synthetic observations.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
import json
import math
from pathlib import Path
import re
import shutil
import sys
import time
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import imagery_service as imagery
from app import terrain_api as terrain

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / 'reports/offline-data-install.json'
REGIONS = [
    ('Jezero', 18.45, 77.45), ('Olympus Mons', 18.65, -133.8),
    ('Valles Marineris', -14.01, -58.59), ('Gale', -5.44, 137.7),
    ('Hellas Planitia', -42.43, 70.5), ('Cerberus', 7.145, 166.68),
    ('Tyrrhena Terra', -24.417, 80.964), ('Dark dunes', -27.79655, -156.82845),
    ('Coprates', -14.0217255, -63.3260685), ('Southern crater', -46.8335, -143.8076),
    ('Selected region 1', 19.48986795, 15.42976319), ('Selected region 2', 25.84906067, 24.45611263),
]
state = {'startedAt': time.time(), 'regions': REGIONS, 'tiles': {'ready': 0, 'failed': []},
         'elevation': [], 'hirise': [], 'limits': [
             'Global overview imagery is cached through level 4; regional detail through each supported level.',
             'CTX elevation covers valid stereo footprints, not all of Mars.',
             'HiRISE JPEG previews are orbital images, not elevation models.',
             'No live global weather, soil strength or calibrated rock-abundance feed is available in these datasets.']}


def save():
    REPORT.write_text(json.dumps(state, indent=2), encoding='utf-8')


def tile_at(lat, lon, level):
    n = 2 ** level
    return min(n - 1, max(0, int((90 - lat) / 180 * n))), int((lon + 180) / 360 * 2 * n) % (2 * n)


def tile_jobs():
    jobs = set()
    for product in ['viking', 'relief', 'thermal', 'geology', 'roughness']:
        maximum = 1 if product == 'roughness' else 4
        for level in range(1 if product == 'geology' else 0, maximum + 1):
            for row in range(2 ** level):
                for col in range(2 ** (level + 1)):
                    jobs.add((product, level, row, col))
    for _, lat, lon in REGIONS:
        for product, maximum in [('viking', 7), ('relief', 7), ('thermal', 8)]:
            for level in range(5, maximum + 1):
                row, col = tile_at(lat, lon, level)
                for dr in [-1, 0, 1]:
                    for dc in [-1, 0, 1]:
                        if 0 <= row + dr < 2 ** level:
                            jobs.add((product, level, row + dr, (col + dc) % 2 ** (level + 1)))
    for level in range(8, 14):
        north, west = tile_at(18.7211945, 77.1604655, level)
        south, east = tile_at(18.2110274, 77.6991776, level)
        for row in range(north, south + 1):
            for col in range(west, east + 1):
                jobs.add(('ctx', level, row, col))
    return sorted(jobs)


def install_tile(job):
    address = imagery.tile_address(*job)
    failure = ''
    for attempt in range(3):
        try:
            media, data = imagery.fetch_tile(address)
            return {'tile': job, 'bytes': len(data)}
        except Exception as error:
            failure = str(error)
            if attempt < 2:
                time.sleep(.3 * (attempt + 1))
    return {'tile': job, 'error': failure}


def download(url, target, limit=600_000_000):
    if target.is_file() and target.stat().st_size > 0:
        return target.stat().st_size
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + '.part')
    with urlopen(Request(url, headers={'User-Agent': 'MarsNexus offline data installer'}), timeout=30) as response:
        expected = int(response.headers.get('Content-Length', '0'))
        if expected > limit:
            raise ValueError(f'Asset exceeds the installation size bound: {expected} bytes')
        total = 0
        with temporary.open('wb') as output:
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > limit:
                    raise ValueError('Asset exceeds the installation size bound')
                output.write(block)
        if expected and total != expected:
            raise ValueError('Incomplete download')
    temporary.replace(target)
    return total


def install_elevation():
    items = {}
    for name, lat, lon in REGIONS:
        try:
            found = terrain.candidates([(lat - .08, lon - .08), (lat + .08, lon + .08)])
            state['elevation'].append({'region': name, 'catalogModels': len(found)})
            for item in found[:4]:
                items[item['id']] = item
        except Exception as error:
            state['elevation'].append({'region': name, 'error': str(error)})
    installed = []
    terrain.PRODUCTS.mkdir(parents=True, exist_ok=True)
    for item in items.values():
        try:
            href = terrain.asset_url(item)
            path = terrain.PRODUCTS / f'{sha256(href.encode()).hexdigest()}.tif'
            size = download(href, path)
            import rasterio
            with rasterio.open(path) as ds:
                assert ds.crs is not None and ds.count == 1 and 15 <= abs(ds.transform.a) <= 40
                shape = ds.shape
            installed.append(item)
            (terrain.PRODUCTS / 'catalog.json').write_text(json.dumps(installed), encoding='utf-8')
            state['elevation'].append({'product': item['id'], 'bytes': size, 'shape': shape, 'source': href})
            print(f'CTX {len(installed)}/{len(items)}: {size / 1e6:.1f} MB', flush=True)
        except Exception as error:
            state['elevation'].append({'product': item['id'], 'error': str(error)})
        save()


def install_hirise():
    observations = ['ESP_011485_1555', 'ESP_049009_1520', 'ESP_052869_1660', 'ESP_075450_1330']
    target = ROOT / 'frontend/public/mars-data/hirise/observations'
    target.mkdir(parents=True, exist_ok=True)
    source = Path('C:/Users/asus/Desktop/MarsPath_AI_Resources (2)/MarsPath_AI_Resources/Data/Imagery/HiRISE')
    catalog = []
    for observation in observations:
        try:
            page = f'https://www.uahirise.org/{observation}'
            with urlopen(page, timeout=20) as response:
                html = response.read().decode()
            urls = re.findall(r'href=[\"\']([^\"\']+)[\"\']', html)
            url = next(u for u in urls if u.endswith(f'/{observation}_RED.browse.jpg') and '/EXTRAS/' in u)
            if url.startswith('//'):
                url = 'https:' + url
            url = url.replace('http:', 'https:')
            size = download(url, target / f'{observation}.jpg', 200_000_000)
            label = (source / f'{observation}_RED.LBL').read_text()
            value = lambda key: float(re.search(rf'^\s*{key}\s*=\s*([-\d.]+)', label, re.M)[1])
            west, east = value('WESTERNMOST_LONGITUDE'), value('EASTERNMOST_LONGITUDE')
            entry = {'id': observation, 'url': f'/mars-data/hirise/observations/{observation}.jpg',
                     'bounds': {'west': (west + 180) % 360 - 180, 'east': (east + 180) % 360 - 180,
                                'south': value('MINIMUM_LATITUDE'), 'north': value('MAXIMUM_LATITUDE')},
                     'source': page, 'asset': url, 'bytes': size, 'credit': 'NASA/JPL-Caltech/UArizona'}
            catalog.append(entry)
            shutil.copy2(source / f'{observation}_RED.LBL', target / f'{observation}.lbl')
            state['hirise'].append(entry)
            print(f'HiRISE {observation}: {size / 1e6:.1f} MB', flush=True)
        except Exception as error:
            state['hirise'].append({'id': observation, 'error': str(error)})
        save()
    (ROOT / 'frontend/src/hiriseCatalog.json').write_text(json.dumps(catalog), encoding='utf-8')
    (target / 'catalog.json').write_text(json.dumps(catalog, indent=2), encoding='utf-8')


if __name__ == '__main__':
    jobs = tile_jobs()
    state['tiles']['requested'] = len(jobs)
    save()
    print(f'Installing {len(jobs)} map tiles plus regional elevation models and HiRISE observations.', flush=True)
    # Metadata and full models first; the interactive program can use them immediately.
    install_hirise()
    install_elevation()
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(install_tile, job) for job in jobs]
        for index, future in enumerate(as_completed(futures), 1):
            result = future.result()
            if 'error' in result:
                state['tiles']['failed'].append(result)
            else:
                state['tiles']['ready'] += 1
            if index % 100 == 0 or index == len(jobs):
                save()
                print(f"Tiles {index}/{len(jobs)}; installed {state['tiles']['ready']}; missing {len(state['tiles']['failed'])}", flush=True)
    state['completedAt'] = time.time()
    state['installedBytes'] = sum(p.stat().st_size for p in (ROOT / 'backend/data').rglob('*') if p.is_file())
    save()
    print('Installation finished; see reports/offline-data-install.json for exact coverage and unavailable assets.', flush=True)
