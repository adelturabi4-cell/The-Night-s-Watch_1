import { identifyRegion } from './mars'
import type { Coordinates, Assessment } from './mars'
import { JEZERO_WEATHER } from './siteNarration'

const SWIM = 'https://science.nasa.gov/resource/swim-map-shows-subsurface-water-ice-on-mars/'
const RAD = 'https://science.nasa.gov/resource/radiation-measurements-on-mars/'
const POWER = 'https://science.nasa.gov/resource/insights-power-generation-after-landing-and-spring-2022/'
const SOIL = 'https://science.nasa.gov/mission/mars-phoenix/'
const RELAY = 'https://science.nasa.gov/resource/mars-report-earth-to-mars-how-nasa-keeps-curiosity-connected/'
const GEOLOGY = 'https://pubs.usgs.gov/publication/sim3292'
const JEZERO = 'https://science.nasa.gov/blog/linking-local-lithologies-to-a-larger-landscape/'
const MEDA = JEZERO_WEATHER.source

export const SCIENCE_DATA = [
  { name: 'USGS CTX elevation API', type: 'Stereo-derived terrain', scope: 'Mars regions with valid stereo coverage · about 20 m cells', revision: 'USGS STAC catalog · cached elevation windows', method: 'Finds numeric geoid-adjusted CTX models at your selected coordinates. Only the required terrain window is streamed. Missing pixels remain unknown; imagery is not used as elevation.', url: 'https://stac.astrogeology.usgs.gov/docs/data/mars/ctxdtms/' },
  { name: 'Viking color mosaic', type: 'Orbital imagery', scope: 'Global · 0.25°/pixel', revision: 'Viking-era observations', method: 'Caltech/JPL/USGS display mosaic.', url: 'https://maps.jpl.nasa.gov/tmaps/mars.html' },
  { name: 'Mars Trek WMTS', type: 'Map imagery', scope: 'Global and regional · varies by layer', revision: 'Remote service', method: 'Progressive tiles for MOLA shading and roughness, THEMIS daytime infrared and the Jezero CTX mosaic.', url: 'https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars' },
  { name: 'MOLA MEGDR', type: 'Gridded laser altimetry', scope: 'Global · 0.25° cells', revision: 'Mars Global Surveyor archive', method: 'Binned elevation with interpolation in gaps. Regional slopes cannot resolve small obstacles.', url: 'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html' },
  { name: 'Jezero CTX elevation', type: 'Stereo-derived terrain', scope: '12.8 × 12.8 km · 20 m cells', revision: 'Mars 2020 science investigation mosaic', method: 'Bundled crop used for local slope, roughness, terrain screening and A* routing.', url: 'https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic' },
  { name: 'SIM 3292 geology', type: 'Interpreted mapping', scope: 'Global · 1:20,000,000', revision: 'USGS, 2014', method: 'Regional map units and contacts. This scale does not resolve the properties of a landing ellipse.', url: GEOLOGY },
  { name: 'Robbins–Hynek crater catalog', type: 'Orbital-derived catalog', scope: 'Global · craters ≥1 km', revision: 'Published 2012', method: 'Crater centers and circular rim estimates. Smaller craters and noncircular margins are unresolved.', url: 'https://doi.org/10.1029/2011JE003966' },
  { name: 'Perseverance MEDA', type: 'Rover measurements', scope: 'Jezero rover traverse', revision: 'First 250 sols', method: 'Historical observations along the traverse. Point-specific current weather is unavailable.', url: MEDA },
  { name: 'SWIM · Water ice', type: 'Regional evidence', scope: 'Selected Martian latitudes', revision: 'NASA/JPL 2023 map', method: 'Regional ice evidence is useful for screening. Extraction depth and accessible water at the selected point are unverified.', url: SWIM },
  { name: 'HRSC / additional HiRISE products', type: 'External dataset', scope: 'Coverage varies by product', revision: 'Archive', method: 'The supplied ESP_052869_1660 quicklook is integrated separately. Other HiRISE products and HRSC remain external.', url: 'https://trek.nasa.gov/mars/' },
  { name: 'MarsPath MOLA MEGT90N000EB', type: 'Supplied elevation data', scope: 'Global · 3,705 m cells', revision: 'Source product 2003-04-03', method: 'Native Mars CRS COG sampled for regional elevation and slope. Too coarse for local obstacle screening.', url: '/mars-data/layers.json' },
  { name: 'HiRISE ESP_052869_1660_RED', type: 'Supplied quicklook imagery', scope: 'Partial footprint near 14° S, 63.3° W', revision: 'User-supplied pack', method: 'Only zoom 17 tiles are supplied; missing tiles remain transparent. Display placement comes from label bounds. No DTM or rock detection is inferred.', url: '/mars-data/integration-audit.json' },
  { name: 'USGS SIM 3464 · Jezero geology', type: 'Interpreted geologic map', scope: 'Jezero crater and Nili Planum · 1:75,000', revision: 'Sun & Stack, 2020 · retrieved 2026-11-14', method: '1,308 polygons in 14 map units, 285 surface features and 341 small craters. Point lookups return the published unit, description and interpretation. Not an obstacle inventory.', url: 'https://doi.org/10.3133/sim3464' },
  { name: 'Perseverance waypoints (MMGIS)', type: 'Rover localization', scope: 'Jezero traverse · 708 positions, sols 13–2022', revision: 'NASA/JPL Mars 2020 · retrieved 2026-11-14', method: 'Recorded rover positions with linked NASA panoramas. The nearest position and its distance are shown for a selection; the line is not a certified walking route.', url: 'https://science.nasa.gov/mission/mars-2020-perseverance/location-map/' },
  { name: 'IAU / USGS Mars names', type: 'Approved nomenclature', scope: 'Global · 2055 named features', revision: 'Retrieved 2026-11-15', method: 'Centers and diameters identify approximate regions; otherwise the nearest named feature is explicitly labeled. Not exact feature boundaries.', url: 'https://planetarynames.wr.usgs.gov/Page/MARS/target' },
]

export function survivalEvidence(point: Coordinates | null) {
  const region = point && identifyRegion(point)
  const jezero = region?.name === 'Jezero'
  const gale = region?.name === 'Gale'
  return [
    { topic: 'Water resources', status: 'Local estimate unavailable', detail: jezero ? 'Orbital and rover observations describe mineral deposits associated with ancient water. Extractable ice, depth, purity and yield remain unverified at this point.' : 'SWIM maps regional evidence of buried ice. Depth, purity and extractable water remain unverified at this point.', url: jezero ? JEZERO : SWIM },
    { topic: 'Temperature', status: jezero ? 'Historical rover observations' : 'Local temperature unavailable', detail: jezero ? `${JEZERO_WEATHER.temperature} during the study. Use the actual diurnal and seasonal range to size equipment thermal control.` : 'A site-specific day/night and seasonal series is needed to estimate equipment heating and cooling loads.', url: MEDA },
    { topic: 'Radiation', status: gale ? 'Regional instrument reference' : 'Local dose unavailable', detail: 'Curiosity RAD observations are from Gale crater. A site mission needs a dose estimate for its atmosphere column, duration and shielding geometry.', url: RAD },
    { topic: 'Atmosphere', status: jezero ? 'Historical rover observations' : 'Current weather unavailable', detail: jezero ? `MEDA daily mean pressure: ${JEZERO_WEATHER.pressure}; ${JEZERO_WEATHER.wind.toLowerCase()}. Current pressure, wind and dust at the selected point are unavailable.` : 'Local pressure, wind and dust are unavailable. Surface activity requires pressurized systems and dust management.', url: MEDA },
    { topic: 'Energy', status: 'Site yield unavailable', detail: 'InSight measured major solar output loss as dust accumulated. Solar estimates require terrain horizon, season, dust and a specified array.', url: POWER },
    { topic: 'Food and agriculture', status: 'Engineering context', detail: 'Phoenix detected perchlorates at its landing site. A controlled greenhouse needs water, temperature regulation and radiation protection. Local soil chemistry and crop yield are unverified.', url: SOIL },
    { topic: 'Communication', status: 'Site geometry unavailable', detail: 'Local terrain can block line of sight. Verify Earth geometry and relay passes for a mission date. One-way delay depends on Earth–Mars distance.', url: RELAY },
  ]
}

export interface Candidate {
  point: Coordinates
  assessment: Assessment
  savedAt: string
}

export function siteTitle(point: Coordinates) {
  return identifyRegion(point)?.feature ?? 'Unnamed site'
}
