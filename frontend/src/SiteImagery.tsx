import { useEffect, useRef, useState } from 'react'
import { coordinatesLabel, wrapLongitude } from './mars'
import type { Coordinates } from './mars'
import { HIRISE_BOUNDS, JEZERO_IMAGE_BOUNDS, tileAt, tileUrl } from './planetLayers'

const inside = (p: Coordinates, b: typeof HIRISE_BOUNDS) => p.longitude >= b.west && p.longitude <= b.east && p.latitude >= b.south && p.latitude <= b.north

/** A geographically correct crop; imagery is never inferred from the place name. */
export default function SiteImagery({ point }: { point: Coordinates }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failedUrl, setFailedUrl] = useState('')
  const [baseFailed, setBaseFailed] = useState(false)
  const hirise = inside(point, HIRISE_BOUNDS)
  const ctx = inside(point, JEZERO_IMAGE_BOUNDS)
  const tile = tileAt(point, 11)
  const detailed = hirise ? '/mars-data/hirise/site-equirect.png' : ctx ? tileUrl('ctx', 11, tile.row, tile.column) : ''
  const showDetail = detailed && failedUrl !== detailed
  useEffect(() => {
    const image = new Image()
    let active = true
    image.onload = () => {
      if (!active) return
      const node = canvas.current
      const context = node?.getContext('2d')
      if (!node || !context) return
      const width = image.naturalWidth * 20 / 360
      const height = width * node.height / node.width
      const x = (wrapLongitude(point.longitude) + 180) / 360 * image.naturalWidth
      const y = (90 - point.latitude) / 180 * image.naturalHeight
      context.fillStyle = '#000'; context.fillRect(0, 0, node.width, node.height)
      for (const offset of [-image.naturalWidth, 0, image.naturalWidth]) {
        context.drawImage(image, (offset - x + width / 2) * node.width / width, -(y - height / 2) * node.height / height,
          image.naturalWidth * node.width / width, image.naturalHeight * node.height / height)
      }
    }
    image.onerror = () => { if (active) setBaseFailed(true) }
    image.src = '/mars/viking.jpg'
    return () => { active = false }
  }, [point.latitude, point.longitude])
  return <figure className="site-imagery">
    <div className="site-imagery-frame">
      <canvas ref={canvas} width={640} height={320} role="img" aria-label={`Viking orbital mosaic crop at ${coordinatesLabel(point)}`} />
      {showDetail && <img src={detailed} alt={hirise ? 'HiRISE orbital quicklook of the selected coverage footprint' : 'Real MRO CTX orbital image tile containing the selected coordinates'} onError={() => setFailedUrl(detailed)} />}
      <span className="imagery-stamp">{showDetail ? hirise ? 'HiRISE / MRO' : 'CTX / MRO' : 'VIKING / MARS'}</span>
      {baseFailed && !showDetail && <span className="imagery-failed" role="status">Image unavailable</span>}
    </div>
    <figcaption>{showDetail ? hirise ? 'Partial orbital image · gaps have no data · not an elevation model' : 'NASA Mars Trek / CTX · image tile contains the selected point' : 'Viking / NASA / JPL / USGS · regional view around the selected coordinates'}{failedUrl === detailed && detailed ? ' · detailed imagery currently unavailable' : ''}</figcaption>
  </figure>
}
