import catalog from './regionCatalog.json'

export function lookupRegion(latitude: number, longitude: number) {
  let best: typeof catalog.features[number] | undefined
  let bestDistance = Infinity
  let smallest = Infinity
  let contained = false
  for (const feature of catalog.features) {
    const rad = Math.PI/180
    const a = Math.sin((feature.latitude-latitude)*rad/2)**2 + Math.cos(latitude*rad)*Math.cos(feature.latitude*rad)*Math.sin((feature.longitude-longitude)*rad/2)**2
    const distance = 6792.38*Math.asin(Math.sqrt(Math.min(1,a)))
    const radius = Math.max(.1,feature.diameter/2)
    if (distance <= radius && radius < smallest) { best=feature; bestDistance=distance; smallest=radius; contained=true }
    else if (!contained && distance < bestDistance) { best=feature; bestDistance=distance }
  }
  if (!best) return undefined
  const title = best.type === 'Crater, craters' ? best.name + ' crater' : best.name
  return { ...best, radiusKm:best.diameter/2, feature:contained ? title : 'Near ' + title,
    match:contained ? 'approximate_extent' : 'nearest_named_feature', distanceKm:bestDistance }
}
