"""Small live HTTP check of the shared external elevation integration."""
import json
from pathlib import Path
from urllib.request import Request, urlopen

BASE = 'http://127.0.0.1:8000'


def request(path, body=None):
    req = Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=30) as response:
        return json.load(response)


points = [{'latitude': 7.145, 'longitude': 166.68}, {'latitude': 7.15, 'longitude': 166.685}]
data = request('/api/surface/workspace', {'origin': points[0], 'destination': points[1], 'profile': 'rover_scout'})
query = '?latitude=7.15&longitude=166.685'
site = request('/api/site' + query)
landing = request('/api/landing' + query)
comparison = request('/api/landing/routes', {**points[1], 'profile': 'rover_scout'})
result = {'endpoints': points, 'source': data['source'], 'resolutionM': data['terrain']['cell_size'],
          'productId': data['terrain']['meta']['product_id'], 'sourceUrl': data['terrain']['meta']['source_url'],
          'routes': {key: {'status': route['status'], 'verdict': route['verdict'],
                           'distanceM': route.get('metrics', {}).get('distance_m')}
                     for key, route in data['result']['routes'].items()},
          'site': {'terrain': site['terrain'], 'verdict': site['verdict']['status']},
          'screening': {'level': landing['level'], 'resolutionM': landing['resolutionM']},
          'comparisonRoutes': list(comparison['routes'])}
assert all(route['status'] == 'ok' for route in result['routes'].values()), result
assert site['terrain']['level'] == landing['level'] == 'local', result
assert len(comparison['routes']) == 3, result
path = Path(__file__).resolve().parents[2] / 'reports/usgs-terrain-verification.json'
path.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(f"Verified: {result['resolutionM']} m elevation, three routes, site details and landing screening outside Jezero.")
