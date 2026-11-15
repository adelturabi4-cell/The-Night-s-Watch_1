import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry, DoubleSide, Line, LineBasicMaterial, MathUtils, Mesh, Quaternion,
  SRGBColorSpace, Texture, TextureLoader, Vector2, Vector3,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLOBE_COLORS, LANDMARKS, MARS_RADIUS_KM, wrapLongitude } from './mars'
import type { Coordinates, Crater, SurfaceRoutes } from './mars'
import type { RouteKey } from './types'
import { HIRISE_BOUNDS, JEZERO_IMAGE_BOUNDS, PLANET_LAYERS, tileAt, tileBounds, tileUrl } from './planetLayers'
import type { PlanetLayer } from './planetLayers'

const vertexShader = /* glsl */ `
  varying vec3 eyeNormal;
  varying vec3 eyePosition;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    eyeNormal = normalize(normalMatrix * normal);
    eyePosition = -view.xyz;
    gl_Position = projectionMatrix * view;
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 eyeNormal;
  varying vec3 eyePosition;
  void main() {
    float edge = pow(1.0 - abs(dot(normalize(eyeNormal), normalize(eyePosition))), 4.0);
    gl_FragColor = vec4(0.77, 0.33, 0.17, edge * 0.36);
  }
`

function direction({ latitude, longitude }: Coordinates, radius = 1) {
  const phi = MathUtils.degToRad(latitude)
  const lambda = MathUtils.degToRad(longitude)
  return new Vector3(Math.cos(phi) * Math.cos(lambda), Math.sin(phi), -Math.cos(phi) * Math.sin(lambda)).multiplyScalar(radius)
}

interface Props {
  point: Coordinates
  marked: boolean
  onSelect: (point: Coordinates, distance?: number) => void
  hazard: Crater | null
  showHazard: boolean
  showSlopes: boolean
  showRelief: boolean
  layer: PlanetLayer
  grid: boolean
  showLandmarks?: boolean
  onTileStatus: (message: string) => void
  paths: SurfaceRoutes | null
  activeRoute: RouteKey
  focus: { sequence: number; distance: number }
  zoom: { sequence: number; direction: number }
}

function Scene({ point, marked, onSelect, hazard, showHazard, showSlopes, showRelief, layer, grid, showLandmarks = true, onTileStatus, paths, activeRoute, focus, zoom }: Props) {
  const [vikingSource, relief, jezeroSource, steepSlopes] = useLoader(TextureLoader, ['/mars/viking.jpg', '/mars/mola-relief.png', '/mars/jezero-relief.png', '/mars/jezero-slopes.png'])
  const packSources = useLoader(TextureLoader, ['/mars-data/mola/globe-180.jpg','/mars-data/hirise/site-equirect.png'])
  const packTextures = useMemo(() => packSources.map((source) => { const texture=source.clone(); texture.colorSpace=SRGBColorSpace; texture.needsUpdate=true; return texture }),[packSources])
  useEffect(() => () => packTextures.forEach((texture) => texture.dispose()),[packTextures])
  const hirisePatch = useMemo(() => makePatch(HIRISE_BOUNDS.west,HIRISE_BOUNDS.south,HIRISE_BOUNDS.east,HIRISE_BOUNDS.north),[])
  const [texture, jezero] = useMemo(() => [vikingSource, jezeroSource].map((source) => {
    const copy = source.clone()
    copy.colorSpace = SRGBColorSpace
    copy.anisotropy = 8
    copy.needsUpdate = true
    return copy
  }), [vikingSource, jezeroSource])
  const controls = useRef<OrbitControls | null>(null)
  const marker = useRef<Mesh>(null)
  const atmosphere = useRef<Mesh>(null)
  const animation = useRef<{ start: Vector3; rotation: Quaternion; radius: number; targetRadius: number; startTime: number } | null>(null)
  const lastFocus = useRef(-1)
  const lastZoom = useRef(0)
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const press = useRef(new Vector2())
  const markerPosition = useMemo(() => direction(point, 1.00003), [point])
  const regionalMesh = useRef<Mesh>(null)
  const regionalMap = useMemo(() => {
    const segments = 20
    const bottom = 18.34205901384007
    const top = 18.55800275602395
    const west = 77.33609060769474
    const east = 77.56375685726432
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (let row = 0; row <= segments; row++) {
      for (let col = 0; col <= segments; col++) {
        const u = col / segments
        const v = row / segments
        positions.push(...direction({ latitude: MathUtils.lerp(bottom, top, v), longitude: MathUtils.lerp(west, east, u) }, 1.000005).toArray())
        uvs.push(u, v)
        if (row && col) {
          const current = row * (segments + 1) + col
          indices.push(current, current - 1, current - segments - 2, current, current - segments - 2, current - segments - 1)
        }
      }
    }
    return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) }
  }, [])

  useEffect(() => () => { texture.dispose(); jezero.dispose() }, [texture, jezero])

  useFrame(({ camera, gl, clock }) => {
    if (!controls.current) {
      const orbit = new OrbitControls(camera, gl.domElement)
      orbit.enablePan = false
      orbit.enableDamping = true
      orbit.dampingFactor = 0.12
      orbit.minDistance = 1.00018
      orbit.maxDistance = 7
      orbit.rotateSpeed = 0.45
      orbit.zoomSpeed = 0.6
      orbit.addEventListener('start', () => { animation.current = null })
      controls.current = orbit
    }
    const orbit = controls.current
    const now = clock.elapsedTime
    if (focus.sequence !== lastFocus.current || zoom.sequence !== lastZoom.current) {
      const radius = camera.position.length()
      const start = camera.position.clone().normalize()
      const focusing = focus.sequence !== lastFocus.current
      const targetRadius = focusing ? focus.distance : 1 + (radius - 1) * (zoom.direction > 0 ? 0.67 : 1.5)
      const target = focusing ? direction({ ...point, latitude: MathUtils.clamp(point.latitude, -89.95, 89.95) }) : start
      animation.current = {
        start, rotation: new Quaternion().setFromUnitVectors(start, target),
        radius, targetRadius: MathUtils.clamp(targetRadius, orbit.minDistance, orbit.maxDistance), startTime: now,
      }
      lastFocus.current = focus.sequence
      lastZoom.current = zoom.sequence
    }
    const motion = animation.current
    if (motion) {
      const t = reduced || document.documentElement.dataset.motion === 'reduced' ? 1 : MathUtils.clamp((now - motion.startTime) / 0.9, 0, 1)
      const eased = t * t * (3 - 2 * t)
      const radius = 1 + Math.exp(MathUtils.lerp(Math.log(motion.radius - 1), Math.log(motion.targetRadius - 1), eased))
      const turn = new Quaternion().slerp(motion.rotation, eased)
      camera.position.copy(motion.start).applyQuaternion(turn).multiplyScalar(radius)
      if (t === 1) animation.current = null
    }
    orbit.update()
    const near = Math.min(0.1, (camera.position.length() - 1) * 0.35)
    if ('near' in camera && Math.abs(camera.near - near) > near * 0.03) {
      camera.near = near
      camera.updateProjectionMatrix()
    }
    if (atmosphere.current) atmosphere.current.visible = camera.position.length() > 1.09
    if (regionalMesh.current) regionalMesh.current.visible = camera.position.length() < 1.012 && layer === 'natural'
    if (marker.current) {
      const distance = Math.max(0.00007, camera.position.distanceTo(markerPosition))
      marker.current.scale.setScalar(distance * 0.036)
    }
  })

  useEffect(() => () => {
    controls.current?.dispose()
    controls.current = null
  }, [])

  return (
    <>
      <hemisphereLight args={['#ffdfc5', '#673b31', 1.35]} />
      <directionalLight position={[4, 3, -2]} intensity={2.2} color="#ffdfc3" />
      <directionalLight position={[-3, 1, 4]} intensity={0.8} color="#f6c4ae" />
      <mesh
        onPointerDown={(e) => press.current.set(e.clientX, e.clientY)}
        onClick={(e) => {
          if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 5) return
          const n = e.point.clone().normalize()
          onSelect(
            { latitude: MathUtils.radToDeg(Math.asin(MathUtils.clamp(n.y, -1, 1))), longitude: wrapLongitude(MathUtils.radToDeg(Math.atan2(-n.z, n.x))) },
            Math.min(e.camera.position.length(), 2.85),
          )
        }}
      >
        <sphereGeometry args={[1, 144, 100]} />
        {layer === 'packMola' ? <meshBasicMaterial map={packTextures[0]} /> : layer === 'elevation'
          ? <meshBasicMaterial map={relief} color="#F0D66C" />
          : <meshStandardMaterial map={texture} bumpMap={showRelief ? relief : null} bumpScale={0.038} roughness={1} color="#ecc2a5" />}
      </mesh>
      <mesh ref={regionalMesh}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[regionalMap.positions, 3]} />
          <bufferAttribute attach="attributes-uv" args={[regionalMap.uvs, 2]} />
          <bufferAttribute attach="index" args={[regionalMap.indices, 1]} />
        </bufferGeometry>
        <meshBasicMaterial map={jezero} side={DoubleSide} />
      </mesh>
      <TiledSurface key={layer} layer={layer} onStatus={onTileStatus} />
      {layer === 'natural' && <TiledSurface layer="ctx" onStatus={onTileStatus} automatic />}
      {layer === 'natural' && <mesh renderOrder={20}><bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[hirisePatch.position,3]} />
        <bufferAttribute attach="attributes-uv" args={[hirisePatch.uv,2]} />
        <bufferAttribute attach="index" args={[hirisePatch.faces,1]} />
      </bufferGeometry><meshBasicMaterial map={packTextures[1]} transparent alphaTest={0.01} depthWrite={false} side={DoubleSide} /></mesh>}
      {layer === 'packHirise' && <mesh renderOrder={20}><bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[hirisePatch.position,3]} />
        <bufferAttribute attach="attributes-uv" args={[hirisePatch.uv,2]} />
        <bufferAttribute attach="index" args={[hirisePatch.faces,1]} />
      </bufferGeometry><meshBasicMaterial map={packTextures[1]} transparent alphaTest={0.01} depthWrite={false} side={DoubleSide} /></mesh>}
      {grid && <Graticule />}
      {showLandmarks && LANDMARKS.filter((region) => Math.abs(region.latitude - point.latitude) > 0.001 || Math.abs(region.longitude - point.longitude) > 0.001).map((region) => {
        const position = direction(region, 1.003)
        return <mesh key={region.name} position={position} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), position.clone().normalize())} onClick={(event) => { event.stopPropagation(); if (event.delta < 5) onSelect(region, 3.45) }}>
          <ringGeometry args={[0.012, 0.019, 28]} />
          <meshBasicMaterial color="#D6B94D" side={DoubleSide} />
        </mesh>
      })}
      <mesh ref={atmosphere} scale={1.011}>
        <sphereGeometry args={[1, 64, 48]} />
        <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} transparent depthWrite={false} side={DoubleSide} />
      </mesh>
      {showSlopes && <mesh renderOrder={21}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[regionalMap.positions, 3]} />
          <bufferAttribute attach="attributes-uv" args={[regionalMap.uvs, 2]} />
          <bufferAttribute attach="index" args={[regionalMap.indices, 1]} />
        </bufferGeometry>
        <meshBasicMaterial map={steepSlopes} alphaTest={0.02} transparent depthWrite={false} side={DoubleSide} />
      </mesh>}
      {marked && <mesh ref={marker} renderOrder={26} position={markerPosition} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), markerPosition.clone().normalize())}>
        <ringGeometry args={[0.43, 0.54, 40]} />
        <meshBasicMaterial color="#F0D66C" transparent depthWrite={false} side={DoubleSide} />
      </mesh>}
      {showHazard && hazard && <CraterRim hazard={hazard} />}
      {paths && Object.entries(paths.routes).map(([key, route]) => (
        <SurfaceLine key={key} positions={route.points} color={GLOBE_COLORS[key as RouteKey]} emphasized={key === activeRoute} />
      ))}
    </>
  )
}

function makePatch(west: number, south: number, east: number, north: number) {
  const segments = Math.max(4, Math.ceil((east - west) / 1.5))
  const angularStep = MathUtils.degToRad((east - west) / segments)
  const radius = 1 + Math.max(0.000008, angularStep ** 2 * 0.29)
  const position: number[] = []
  const uv: number[] = []
  const faces: number[] = []
  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      const u = col / segments
      const v = row / segments
      position.push(...direction({ latitude: MathUtils.lerp(south, north, v), longitude: MathUtils.lerp(west, east, u) }, radius).toArray())
      uv.push(u, v)
      if (row && col) {
        const end = row * (segments + 1) + col
        faces.push(end, end - 1, end - segments - 2, end, end - segments - 2, end - segments - 1)
      }
    }
  }
  return { position: new Float32Array(position), uv: new Float32Array(uv), faces: new Uint16Array(faces) }
}

function TilePatch({ product, level, row, column, onResult }: { product: string; level: number; row: number; column: number; onResult: (loaded: boolean) => void }) {
  const material = useRef<import('three').MeshBasicMaterial>(null)
  const bounds = tileBounds(level, row, column)
  const shape = useMemo(() => makePatch(bounds.west, bounds.south, bounds.east, bounds.north), [bounds.west, bounds.south, bounds.east, bounds.north])
  useEffect(() => {
    let cancelled = false
    let texture: Texture | undefined
    new TextureLoader().load(tileUrl(product, level, row, column), (result) => {
      if (cancelled || !material.current) {
        result.dispose()
        return
      }
      texture = result
      texture.colorSpace = SRGBColorSpace
      material.current.map = texture
      material.current.opacity = 1
      material.current.needsUpdate = true
      onResult(true)
    }, undefined, () => { if (!cancelled) onResult(false) })
    return () => {
      cancelled = true
      texture?.dispose()
    }
  }, [product, level, row, column, onResult])

  return <mesh renderOrder={level + 1}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[shape.position, 3]} />
      <bufferAttribute attach="attributes-uv" args={[shape.uv, 2]} />
      <bufferAttribute attach="index" args={[shape.faces, 1]} />
    </bufferGeometry>
    <meshBasicMaterial ref={material} alphaTest={0.02} transparent opacity={0} depthWrite={false} />
  </mesh>
}

function TiledSurface({ layer, onStatus, automatic = false }: { layer: PlanetLayer; onStatus: (message: string) => void; automatic?: boolean }) {
  const config = PLANET_LAYERS[layer]
  const current = useRef('')
  const summary = useRef({ loaded: 0, failed: 0 })
  const nextUpdate = useRef(0)
  const [tiles, setTiles] = useState<{ level: number; row: number; column: number }[]>([])
  const baseLevel = layer === 'geology' ? 1 : 0
  const baseRows = 2 ** baseLevel
  const baseTiles = useMemo(() => Array.from({ length: baseRows ** 2 * 2 }, (_, i) => ({
    level: baseLevel, row: Math.floor(i / (baseRows * 2)), column: i % (baseRows * 2),
  })), [baseRows, baseLevel])
  const ignoreResult = useCallback(() => {}, [])
  const onResult = useCallback((loaded: boolean) => {
    if (loaded) summary.current.loaded++
    else summary.current.failed++
    const { loaded: count, failed } = summary.current
    if (count + failed >= tiles.length) {
      onStatus(count === 0 ? 'Detailed imagery unavailable · showing Viking imagery' : `${count} / ${tiles.length} tiles · ${layer === 'ctx' ? 'NASA CTX' : PLANET_LAYERS[layer].source} · level ${tiles[0]?.level}`)
    }
  }, [onStatus, tiles, layer])

  useFrame(({ camera, clock }) => {
    if (!('product' in config) || clock.elapsedTime < nextUpdate.current) return
    nextUpdate.current = clock.elapsedTime + 0.3
    const height = camera.position.length() - 1
    const n = camera.position.clone().normalize()
    const point = { latitude: MathUtils.radToDeg(Math.asin(MathUtils.clamp(n.y, -1, 1))), longitude: MathUtils.radToDeg(Math.atan2(-n.z, n.x)) }
    const local = config.product === 'ctx'
    const inCoverage = point.latitude >= JEZERO_IMAGE_BOUNDS.south && point.latitude <= JEZERO_IMAGE_BOUNDS.north &&
      point.longitude >= JEZERO_IMAGE_BOUNDS.west && point.longitude <= JEZERO_IMAGE_BOUNDS.east
    const base = baseLevel
    const level = MathUtils.clamp(Math.floor(Math.log2(1 / Math.max(height, 0.00018))) + 1, base, config.max)
    const { row, column } = tileAt(point, level)
    const key = local && (!inCoverage || level < 8 || (automatic && height > 0.012)) ? 'outside' : level === base ? `base-${level}` : `${level}/${row}/${column}`
    if (current.current === key) return
    current.current = key
    const rowCount = 2 ** level
    const colCount = rowCount * 2
    let next: typeof tiles = []
    if (key !== 'outside') {
      const offsets = [-1, 0, 1]
      next = level === base
        ? baseTiles
        : offsets.flatMap((y) => offsets.map((x) => ({ level, row: row + y, column: (column + x + colCount) % colCount }))).filter((tile) => tile.row >= 0 && tile.row < rowCount)
    }
    summary.current = { loaded: 0, failed: 0 }
    setTiles(next)
    if (next.length || !automatic) onStatus(next.length ? 'Loading orbital imagery…' : 'Zoom into Jezero for CTX coverage')
  })

  if (!('product' in config)) return null
  const isBase = tiles[0]?.level === baseLevel
  return <group>
    {config.product !== 'ctx' && tiles.length > 0 && baseTiles.map(({ level, row, column }) =>
      <TilePatch key={`base/${row}/${column}`} product={config.product} level={level} row={row} column={column} onResult={isBase ? onResult : ignoreResult} />)}
    {!isBase && tiles.map(({ level, row, column }) =>
      <TilePatch key={`${level}/${row}/${column}`} product={config.product} level={level} row={row} column={column} onResult={onResult} />)}
  </group>
}

function Graticule() {
  const lines = useMemo(() => {
    const angles = Array.from({ length: 721 }, (_, i) => i / 2)
    const scans = [
      ...[-60, -30, 0, 30, 60].map((latitude) => angles.map((a) => ({ latitude, longitude: a - 180 }))),
      ...Array.from({ length: 12 }, (_, i) => angles.slice(0, 361).map((a) => ({ latitude: a - 90, longitude: i * 30 - 180 }))),
    ]
    const material = new LineBasicMaterial({ color: '#F0D66C', opacity: 0.32, transparent: true, depthWrite: false })
    return scans.map((points) => {
      const line = new Line(new BufferGeometry().setFromPoints(points.map((point) => direction(point, 1.000013))), material)
      line.renderOrder = 20
      return line
    })
  }, [])
  useEffect(() => () => { lines.forEach((line) => line.geometry.dispose()); lines[0].material.dispose() }, [lines])
  return <group>{lines.map((line) => <primitive key={line.uuid} object={line} />)}</group>
}

function CraterRim({ hazard }: { hazard: Crater }) {
  const line = useMemo(() => {
    const normal = direction(hazard)
    const east = new Vector3(-Math.sin(MathUtils.degToRad(hazard.longitude)), 0, -Math.cos(MathUtils.degToRad(hazard.longitude)))
    const north = new Vector3().crossVectors(normal, east)
    const angle = hazard.diameterKm / (2 * MARS_RADIUS_KM)
    const points = Array.from({ length: 97 }, (_, index) => {
      const bearing = index * Math.PI / 48
      return normal.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(east, Math.sin(angle) * Math.cos(bearing))
        .addScaledVector(north, Math.sin(angle) * Math.sin(bearing)).multiplyScalar(1.000045)
    })
    const result = new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: '#F08A55', transparent: true, opacity: 0.85 }))
    result.renderOrder = 23
    return result
  }, [hazard])
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose() }, [line])
  return <primitive object={line} />
}

function SurfaceLine({ positions, color, emphasized }: { positions: [number, number][]; color: string; emphasized: boolean }) {
  const line = useMemo(() => {
    const points = positions.map(([latitude, longitude]) => direction({ latitude, longitude }, emphasized ? 1.000028 : 1.000017))
    const geometry = new BufferGeometry().setFromPoints(points)
    geometry.setDrawRange(0, 0)
    const result = new Line(geometry, new LineBasicMaterial({ color, transparent: true, opacity: emphasized ? 1 : 0.7 }))
    result.renderOrder = emphasized ? 25 : 24
    return result
  }, [positions, color, emphasized])
  const elapsed = useRef(0)
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose() }, [line])
  useFrame((_, delta) => {
    elapsed.current += delta
    const fraction = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(elapsed.current / 0.65, 1)
    line.geometry.setDrawRange(0, Math.ceil(positions.length * fraction))
  })
  return <primitive object={line} />
}

export default function MarsGlobe(props: Props) {
  const start = useMemo(() => direction({ latitude: 9, longitude: 24 }, 4.5).toArray(), [])
  return (
    <Canvas dpr={[1, 1.65]} gl={{ antialias: true, alpha: true }} camera={{ position: start, fov: 36, near: 0.00001, far: 30 }}
      fallback={<p className="mars-globe-fallback">3D requires WebGL. Enter coordinates to continue exploring.</p>}>
      <Scene {...props} />
    </Canvas>
  )
}
