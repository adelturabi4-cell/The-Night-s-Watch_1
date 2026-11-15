/** Top-view mobility marker shared by the terrain map and the orbital map, so the
 * rover or astronaut looks the same wherever the route is shown. The marker is
 * deliberately oversized; its position follows the real path coordinates. */
export interface TravelerStyle {
  /** Screen-space heading in radians: 0 points right, positive turns clockwise. */
  angle: number
  kind?: string
  moving?: boolean
  /** Animation clock in seconds, used for the astronaut's stride. */
  time?: number
  reduced?: boolean
}

export function drawTraveler(ctx: CanvasRenderingContext2D, x: number, y: number, { angle, kind, moving = false, time = 0, reduced = false }: TravelerStyle) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.shadowColor = '#ff8b3d'
  ctx.shadowBlur = kind ? 12 : 0
  ctx.beginPath()
  ctx.moveTo(11, 0)
  ctx.lineTo(-7, 7)
  ctx.lineTo(-3, 0)
  ctx.lineTo(-7, -7)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#11120F'
  ctx.stroke()
  ctx.shadowBlur = 0
  if (kind) {
    ctx.fillStyle = '#ff8b3d'; ctx.strokeStyle = '#18100a'; ctx.lineWidth = 2
    if (kind === 'rover') {
      ctx.fillRect(-7, -5, 14, 10); ctx.strokeRect(-7, -5, 14, 10)
      ctx.fillStyle = '#f7e8d9'
      for (const xWheel of [-5, 0, 5]) { ctx.fillRect(xWheel - 2, -9, 4, 4); ctx.fillRect(xWheel - 2, 5, 4, 4) }
      ctx.fillStyle = '#27190e'; ctx.fillRect(2, -3, 4, 6)
    } else {
      const stride = moving && !reduced ? Math.sin(time * 10) * 2 : 0
      ctx.fillRect(-5, -4, 8, 8); ctx.strokeRect(-5, -4, 8, 8)
      ctx.fillStyle = '#fff1e3'; ctx.beginPath(); ctx.arc(6, 0, 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()
      ctx.fillRect(-9 + stride, -5, 5, 3); ctx.fillRect(-9 - stride, 2, 5, 3)
    }
  }
  ctx.restore()
}
