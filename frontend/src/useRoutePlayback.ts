import { useEffect, useState } from 'react'

const PREVIEW_MS = 20_000
type Playback = { id: string; fraction: number; wantsToPlay: boolean; started: boolean; replay: number }

/** One clock drives both views. Changing only the view never restarts the traverse. */
export default function useRoutePlayback(id: string, eligible: boolean, suspended: boolean) {
  const [autoplay] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.motion !== 'reduced')
  const [visible, setVisible] = useState(() => !document.hidden)
  const [speed, setSpeed] = useState(1)
  const [state, setState] = useState<Playback>({ id: '', fraction: 0, wantsToPlay: false, started: false, replay: 0 })
  const current = state.id === id ? state : null
  const fraction = current?.fraction ?? 0
  const playing = eligible && Boolean(current?.wantsToPlay) && !suspended && visible

  useEffect(() => {
    const changed = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  useEffect(() => {
    setState({ id, fraction: 0, wantsToPlay: eligible && autoplay, started: false, replay: 0 })
  }, [id, eligible, autoplay])
  useEffect(() => {
    if (!playing) return
    let previous = performance.now(), frame = 0
    const tick = (now: number) => {
      const elapsed = Math.max(0, Math.min(120, now - previous))
      previous = now
      setState((value) => {
        if (value.id !== id || !value.wantsToPlay) return value
        const next = Math.min(1, value.fraction + elapsed * speed / PREVIEW_MS)
        return { ...value, fraction: next, wantsToPlay: next < 1, started: true }
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, id, speed])

  const play = () => {
    if (!eligible) return
    setState((value) => {
      const previous = value.id === id ? value : null
      const finished = previous?.fraction === 1
      return { id, fraction: finished ? 0 : previous?.fraction ?? 0, wantsToPlay: true, started: true,
        replay: (previous?.replay ?? 0) + (finished ? 1 : 0) }
    })
  }
  const pause = () => setState((value) => ({ ...value, wantsToPlay: false }))
  const restart = () => { if (eligible) setState((value) => ({ id, fraction: 0, wantsToPlay: true, started: true, replay: value.replay + 1 })) }
  const seek = (value: number) => { if (eligible) setState((previous) => ({ id, fraction: Math.max(0, Math.min(1, value)), wantsToPlay: false, started: true, replay: previous.replay })) }
  return { fraction, playing, started: current?.started ?? false, speed, setSpeed, play, pause, restart, seek,
    revealId: `${id}:${current?.replay ?? 0}`, autoplay }
}
