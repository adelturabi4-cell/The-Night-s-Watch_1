import { useEffect, useState } from 'react'
import type { Coordinates } from './mars'
import { fetchSiteReport } from './siteIntel'
import type { SiteReport } from './siteIntel'

export default function useSiteReport(point: Coordinates, profile = 'astronaut_eva') {
  const [attempt, setAttempt] = useState(0)
  const [response, setResponse] = useState<{ key: string; data?: SiteReport; error?: string; at?: string } | null>(null)
  const key = `${point.latitude},${point.longitude},${profile},${attempt}`
  useEffect(() => {
    const controller = new AbortController()
    let timer = 0, polls = 0
    const load = async () => {
      try {
        const data = await fetchSiteReport(point, profile, controller.signal)
        if (controller.signal.aborted) return
        setResponse({ key, data, at: new Date().toISOString() })
        if (data.elevationLookup?.status === 'pending' && polls++ < 40) timer = window.setTimeout(load, 1500)
      } catch (error) {
        if (!controller.signal.aborted) setResponse((previous) => previous?.key === key && previous.data
          ? previous : { key, error: error instanceof Error ? error.message : 'Site data unavailable.' })
      }
    }
    void load()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [key, point, profile])
  return { ...(response?.key === key ? response : {}), retry: () => setAttempt((value) => value + 1) }
}
