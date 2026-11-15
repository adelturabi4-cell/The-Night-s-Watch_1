import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { routeKeyOf } from './render'
import type { Cell, Obstacle, Route, RouteKey, Site, TerrainData } from './types'
import { ROUTE_KEYS, ROUTE_STYLE } from './types'

interface Props {
  terrain: TerrainData
  base: HTMLCanvasElement
  routes: Partial<Record<RouteKey, Route>>
  visible: Record<RouteKey, boolean>
  selected: RouteKey
  start: Cell
  goal: Cell
  obstacles: Obstacle[]
  sites: Site[]
  traveler: [number, number] | null
  progress: number | null
  moving: boolean
  kind: string // "astronaut" | "rover"
  exaggeration: number
  follow: boolean
  autoRotate?: boolean
  intro?: boolean
  revealId?: string
  pickMode?: 'start' | 'goal' | null
  onPick?: (cell: Cell) => void
  onSelectRoute?: (route: RouteKey) => void
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>
  overlay: THREE.Group
  figure: THREE.Group
  beacon: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  size: THREE.Vector2
  extent: number
}

interface Anim {
  revealKey: string
  revealT0: number
  lines: { line: Line2; segments: number; order: number }[]
  pulsing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
  spinning: THREE.Object3D[]
  target: THREE.Vector3 | null
  heading: number
  moving: boolean
  follow: boolean
  progress: number | null
  trail: Line2 | null
}

const REVEAL_MS = 1400
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)

function disposeObjects(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) {
    if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose()
    material.dispose()
  }
}

/** A simple figure built from primitives. It is a marker, drawn far larger than life so it stays visible. */
function buildFigure(kind: string, s: number): THREE.Group {
  const g = new THREE.Group()
  const white = new THREE.MeshLambertMaterial({ color: '#f3f1ea' })
  const dark = new THREE.MeshLambertMaterial({ color: '#36352b' })
  const accent = new THREE.MeshLambertMaterial({ color: '#e0703a' })
  const gold = new THREE.MeshLambertMaterial({ color: '#f2b84b', emissive: '#6b4a10' })
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, name = '') => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x * s, y * s, z * s)
    m.name = name
    g.add(m)
    return m
  }
  if (kind === 'astronaut') {
    add(new THREE.CapsuleGeometry(0.2 * s, 0.34 * s, 6, 12), white, 0, 0.82, 0)
    add(new THREE.SphereGeometry(0.19 * s, 18, 14), white, 0, 1.27, 0)
    add(new THREE.SphereGeometry(0.135 * s, 16, 12), gold, 0, 1.27, 0.1)
    add(new THREE.BoxGeometry(0.34 * s, 0.46 * s, 0.17 * s), dark, 0, 0.88, -0.24)
    add(new THREE.BoxGeometry(0.12 * s, 0.1 * s, 0.05 * s), accent, 0, 0.9, 0.2)
    for (const side of [-1, 1]) {
      // Limbs pivot at the hip / shoulder so they can swing.
      const leg = new THREE.Group()
      leg.position.set(side * 0.11 * s, 0.56 * s, 0)
      leg.name = side < 0 ? 'legL' : 'legR'
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.085 * s, 0.36 * s, 4, 10), white)
      shin.position.y = -0.27 * s
      leg.add(shin)
      g.add(leg)
      const arm = new THREE.Group()
      arm.position.set(side * 0.29 * s, 1.02 * s, 0)
      arm.name = side < 0 ? 'armL' : 'armR'
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.065 * s, 0.3 * s, 4, 10), white)
      fore.position.y = -0.2 * s
      arm.add(fore)
      g.add(arm)
    }
  } else {
    add(new THREE.BoxGeometry(0.72 * s, 0.22 * s, 1.05 * s), white, 0, 0.5, 0)
    add(new THREE.BoxGeometry(0.6 * s, 0.05 * s, 0.5 * s), dark, 0, 0.64, -0.2)
    add(new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.6 * s, 8), dark, 0.2, 0.9, 0.34)
    add(new THREE.BoxGeometry(0.24 * s, 0.13 * s, 0.14 * s), white, 0.2, 1.24, 0.34)
    add(new THREE.SphereGeometry(0.045 * s, 10, 8), gold, 0.2, 1.24, 0.42)
    add(new THREE.BoxGeometry(0.3 * s, 0.16 * s, 0.24 * s), accent, 0, 0.6, -0.56)
    const wheel = new THREE.CylinderGeometry(0.17 * s, 0.17 * s, 0.13 * s, 14)
    wheel.rotateZ(Math.PI / 2)
    for (const side of [-1, 1]) for (const z of [-0.42, 0, 0.42]) add(wheel, dark, side * 0.46, 0.17, z, 'wheel')
  }
  return g
}

export default function Terrain3D(p: Props) {
  const live = useRef(p)
  useEffect(() => { live.current = p })
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<Ctx | null>(null)
  const anim = useRef<Anim>({ revealKey: '', revealT0: 0, lines: [], pulsing: [], spinning: [], target: null, heading: 0, moving: false, follow: false, progress: null, trail: null })
  const { terrain: t } = p

  /** Grid cell (fractional) -> world position on the surface, bilinear in height. */
  const world = (row: number, col: number, lift = 0): THREE.Vector3 => {
    const r = Math.min(t.height - 1, Math.max(0, row))
    const c = Math.min(t.width - 1, Math.max(0, col))
    const r0 = Math.floor(r)
    const c0 = Math.floor(c)
    const r1 = Math.min(t.height - 1, r0 + 1)
    const c1 = Math.min(t.width - 1, c0 + 1)
    const h = (rr: number, cc: number) => {
      const z = t.elevation[rr * t.width + cc]
      return Number.isNaN(z) ? t.minElev : z
    }
    const fr = r - r0
    const fc = c - c0
    const z = (h(r0, c0) * (1 - fc) + h(r0, c1) * fc) * (1 - fr) + (h(r1, c0) * (1 - fc) + h(r1, c1) * fc) * fr
    return new THREE.Vector3((col - t.width / 2) * t.cell_size, (z - t.minElev) * p.exaggeration + lift, (row - t.height / 2) * t.cell_size)
  }

  // Scene setup (once per terrain)
  useEffect(() => {
    const el = host.current!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced'
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#050505')
    const extent = Math.max(t.width, t.height) * t.cell_size
    const camera = new THREE.PerspectiveCamera(45, 1, extent / 500, extent * 30)
    const home = new THREE.Vector3(-extent * 0.55, extent * 0.6, extent * 0.85)
    const far = new THREE.Vector3(-extent * 1.5, extent * 2.6, extent * 2.3)
    camera.position.copy(reduced || p.intro === false ? home : far)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.49
    controls.target.set(0, 0, 0)
    controls.autoRotate = !reduced && p.autoRotate !== false
    controls.autoRotateSpeed = 0.5
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sun = new THREE.DirectionalLight(0xffe8d0, 1.4)
    sun.position.set(-1, 1.2, -1)
    scene.add(sun)

    // Terrain mesh
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(t.width * t.height * 3)
    const uv = new Float32Array(t.width * t.height * 2)
    const idx: number[] = []
    for (let r = 0; r < t.height; r++) {
      for (let c = 0; c < t.width; c++) {
        const i = r * t.width + c
        uv[i * 2] = c / (t.width - 1)
        uv[i * 2 + 1] = 1 - r / (t.height - 1)
        if (r < t.height - 1 && c < t.width - 1) {
          // Skip triangles that touch missing data so holes stay visible.
          const q = [i, i + 1, i + t.width, i + t.width + 1]
          if (q.every((k) => !Number.isNaN(t.elevation[k]))) idx.push(i, i + t.width, i + 1, i + 1, i + t.width, i + t.width + 1)
        }
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }))
    scene.add(mesh)

    // Stars
    const starPos = new Float32Array(1600 * 3)
    for (let i = 0; i < 1600; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(extent * 12)
      v.y = Math.abs(v.y) * 0.9 + extent * 0.2
      starPos.set([v.x, v.y, v.z], i * 3)
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ebe7d9', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8 }))
    scene.add(stars)

    // Drifting dust (decorative, not a measured wind field)
    const DUST = 420
    const dustPos = new Float32Array(DUST * 3)
    for (let i = 0; i < DUST; i++) dustPos.set([(Math.random() - 0.5) * extent, Math.random() * extent * 0.14, (Math.random() - 0.5) * extent], i * 3)
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#e6b48c', size: extent / 420, transparent: true, opacity: 0.45, depthWrite: false }))
    dust.visible = !reduced
    scene.add(dust)

    const overlay = new THREE.Group()
    scene.add(overlay)

    const figure = new THREE.Group()
    figure.visible = false
    scene.add(figure)
    const beacon = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 40),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    )
    beacon.rotation.x = -Math.PI / 2
    beacon.visible = false
    scene.add(beacon)

    const size = new THREE.Vector2(1, 1)
    ctx.current = { renderer, scene, camera, controls, mesh, overlay, figure, beacon, size, extent }
    const pointerStart = new THREE.Vector2()
    const rememberPointer = (event: PointerEvent) => pointerStart.set(event.clientX, event.clientY)
    const pickTerrain = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return
      const q = live.current
      if (!q.onPick && !q.onSelectRoute) return
      const rect = renderer.domElement.getBoundingClientRect()
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
      const hit = ray.intersectObject(mesh)[0]
      if (!hit) return
      const row = Math.max(0, Math.min(t.height - 1, Math.round(hit.point.z / t.cell_size + t.height / 2)))
      const col = Math.max(0, Math.min(t.width - 1, Math.round(hit.point.x / t.cell_size + t.width / 2)))
      if (!q.pickMode && q.onSelectRoute) {
        const nearest = ROUTE_KEYS.filter((key) => q.visible[key] && q.routes[key]?.status === 'ok').map((key) => ({ key,
          distance: Math.min(...q.routes[key]!.path.map(([r, c]) => Math.hypot(r - row, c - col))) })).sort((a, b) => a.distance - b.distance)[0]
        if (nearest && nearest.distance <= 4) { q.onSelectRoute(nearest.key); return }
      }
      q.onPick?.([row, col])
    }
    renderer.domElement.addEventListener('pointerdown', rememberPointer)
    renderer.domElement.addEventListener('pointerup', pickTerrain)

    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      size.set(w, h)
      overlay.traverse((o) => {
        if (o instanceof Line2) o.material.resolution.set(w, h)
      })
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // The intro fly-in and idle rotation stop as soon as the user takes the camera.
    let intro = !reduced && p.intro !== false
    const introT0 = performance.now()
    const takeOver = () => {
      intro = false
      controls.autoRotate = false
    }
    controls.addEventListener('start', takeOver)

    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const time = now / 1000
      const a = anim.current
      if (a.trail) a.trail.geometry.instanceCount = Math.max(0, Math.floor(a.progress ?? 0))

      if (intro) {
        const k = easeOut((now - introT0) / 2600)
        camera.position.lerpVectors(far, home, k)
        if (k >= 1) intro = false
      }

      if (!reduced) {
        // Routes draw themselves on, one after another
        for (const { line, segments, order } of a.lines) {
          const f = easeOut((now - a.revealT0 - order * 220) / REVEAL_MS)
          line.geometry.instanceCount = Math.max(0, Math.round(f * segments))
        }
        for (const m of a.pulsing) m.material.opacity = 0.35 + 0.3 * Math.sin(time * 3.2)
        for (const o of a.spinning) o.rotation.y += dt * 1.2
        // Dust drifts across and wraps around
        const arr = dustGeo.getAttribute('position') as THREE.BufferAttribute
        for (let i = 0; i < DUST; i++) {
          let x = arr.getX(i) + dt * extent * 0.02
          if (x > extent / 2) x -= extent
          arr.setX(i, x)
        }
        arr.needsUpdate = true
        stars.rotation.y += dt * 0.004
      }

      // Traveler figure
      if (a.target) {
        figure.visible = true
        beacon.visible = true
        const stride = a.moving && !reduced ? time * 9 : 0
        const bob = a.moving && !reduced ? Math.abs(Math.sin(stride)) * extent / 900 : 0
        if (a.follow) {
          const delta = a.target.clone().sub(controls.target)
          controls.target.add(delta)
          camera.position.add(delta)
        }
        figure.position.set(a.target.x, a.target.y + bob, a.target.z)
        // Turn smoothly towards the direction of travel
        let d = a.heading - figure.rotation.y
        d = Math.atan2(Math.sin(d), Math.cos(d))
        figure.rotation.y += d * Math.min(1, dt * 8)
        const swing = Math.sin(stride) * 0.65
        for (const child of figure.children[0]?.children ?? []) {
          if (child.name === 'legL' || child.name === 'armR') child.rotation.x = swing
          else if (child.name === 'legR' || child.name === 'armL') child.rotation.x = -swing
          else if (child.name === 'wheel' && a.moving && !reduced) child.rotation.x += dt * 5
        }
        const phase = reduced || !a.moving ? 0.3 : (time * 0.9) % 1
        const r = extent / 70 + (extent / 22) * phase
        beacon.scale.setScalar(r)
        beacon.material.opacity = 0.75 * (1 - phase)
        beacon.position.set(a.target.x, a.target.y + extent / 600, a.target.z)
      } else {
        figure.visible = false
        beacon.visible = false
      }

      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', rememberPointer)
      renderer.domElement.removeEventListener('pointerup', pickTerrain)
      controls.removeEventListener('start', takeOver)
      controls.dispose()
      disposeObjects(scene)
      renderer.dispose()
      el.removeChild(renderer.domElement)
      ctx.current = null
    }
  }, [t])

  // Heights (depend on vertical exaggeration)
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    const pos = c.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let r = 0; r < t.height; r++) {
      for (let col = 0; col < t.width; col++) {
        const v = world(r, col)
        pos.setXYZ(r * t.width + col, v.x, v.y, v.z)
      }
    }
    pos.needsUpdate = true
    c.mesh.geometry.computeVertexNormals()
    c.mesh.geometry.computeBoundingSphere()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, p.exaggeration])

  // Texture = current 2D layer
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    const tex = new THREE.CanvasTexture(p.base)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    c.mesh.material.map?.dispose()
    c.mesh.material.map = tex
    c.mesh.material.needsUpdate = true
  }, [t, p.base])

  // Figure model follows the mobility profile
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    disposeObjects(c.figure)
    c.figure.clear()
    c.figure.add(buildFigure(p.kind, c.extent / 26))
  }, [t, p.kind])

  // Routes, pins, sites, obstacles
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    const a = anim.current
    const extent = c.extent
    const lift = extent / 400
    disposeObjects(c.overlay)
    c.overlay.clear()
    a.lines = []
    a.pulsing = []
    a.spinning = []
    a.trail = null

    const key = `${routeKeyOf(p.routes)}:${p.selected}:${p.revealId ?? ''}`
    const replay = key !== '' && key !== a.revealKey
    if (replay) {
      a.revealKey = key
      a.revealT0 = performance.now()
    }

    const order = [...ROUTE_KEYS.filter((k) => k !== p.selected), p.selected]
    order.forEach((k, n) => {
      const r = p.routes[k]
      if (!r || r.status !== 'ok' || !p.visible[k] || r.path.length < 2) return
      const pts: number[] = []
      for (const [row, col] of r.path) {
        const v = world(row, col, lift * (k === p.selected ? 1.6 : 1))
        pts.push(v.x, v.y, v.z)
      }
      const g = new LineGeometry()
      g.setPositions(pts)
      const st = ROUTE_STYLE[k]
      const m = new LineMaterial({
        color: st.color,
        linewidth: k === p.selected ? 5 : 2.5,
        dashed: st.dash.length > 0,
        dashSize: st.dash[0] ? st.dash[0] * t.cell_size * 0.5 : 1,
        gapSize: st.dash[1] ? st.dash[1] * t.cell_size * 0.5 : 0,
      })
      m.resolution.copy(c.size)
      const line = new Line2(g, m)
      line.computeLineDistances()
      c.overlay.add(line)
      a.lines.push({ line, segments: r.path.length - 1, order: n })
      if (k === p.selected) {
        const trailGeometry = new LineGeometry()
        trailGeometry.setPositions(pts)
        const trailMaterial = new LineMaterial({ color: '#ff8b3d', linewidth: 7, transparent: true, opacity: .95, depthWrite: false })
        trailMaterial.resolution.copy(c.size)
        const trail = new Line2(trailGeometry, trailMaterial)
        trail.renderOrder = 6
        trail.geometry.instanceCount = 0
        c.overlay.add(trail)
        a.trail = trail
      }
    })

    const beam = (cell: Cell, color: string) => {
      const h = extent / 9
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(extent / 260, extent / 260, h, 12, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
      )
      m.position.copy(world(cell[0], cell[1], h / 2))
      c.overlay.add(m)
      return m
    }
    beam(p.start, '#f4f1ea')
    a.pulsing.push(beam(p.goal, '#F0D66C'))
    for (const s of p.sites) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(extent / 130), new THREE.MeshBasicMaterial({ color: '#f4f1ea' }))
      m.position.copy(world(s.row, s.col, extent / 60))
      c.overlay.add(m)
      a.spinning.push(m)
    }
    for (const o of p.obstacles) {
      const rad = (o.radius + 0.5) * t.cell_size
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(rad, rad, extent / 40, 28, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ce4e35', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      )
      m.position.copy(world(o.row, o.col, extent / 80))
      c.overlay.add(m)
      a.pulsing.push(m)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, p.routes, p.visible, p.selected, p.start, p.goal, p.obstacles, p.sites, p.exaggeration, p.revealId])

  // Traveler target, heading and camera mode (applied in the render loop)
  useEffect(() => {
    const a = anim.current
    a.moving = p.moving
    a.follow = p.follow
    a.progress = p.progress
    if (!p.traveler) {
      a.target = null
      return
    }
    a.target = world(p.traveler[0], p.traveler[1])
    const r = p.routes[p.selected]
    if (r && r.status === 'ok' && p.progress !== null && r.path.length > 1) {
      const i = Math.min(r.path.length - 2, Math.max(0, Math.floor(p.progress)))
      a.heading = Math.atan2(r.path[i + 1][1] - r.path[i][1], r.path[i + 1][0] - r.path[i][0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, p.traveler, p.progress, p.moving, p.follow, p.routes, p.selected, p.exaggeration])

  return <div ref={host} className={'view3d' + (p.pickMode ? ' picking' : '')} aria-label="3D local terrain; drag to rotate, click to inspect or place the selected endpoint" />
}
