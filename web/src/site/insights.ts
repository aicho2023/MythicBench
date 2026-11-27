// What each pull did, beyond its score: Bone Pyre soaks, deaths by cause,
// chat lines. Data: web/public/insights/v1.json (scripts/build_insights.py).
import { useEffect, useState } from 'react'

export interface PullFacts {
  pull: number; score: number; dur: number; boss: number | null; deaths: number
  pyres: number; soaked: number; first_soak_s: number | null; kicks: [number, number]; chat: number
  pyre_inside?: number[]; pyre_t?: number[]; killed_by?: Record<string, number>
}
export interface GroupFacts { episode: number; ranked: boolean; pulls: PullFacts[] }
export interface Insights { source: string; tier: string; abilities?: Record<string, string>; models: Record<string, GroupFacts[]> }

let cache: Promise<Insights> | null = null
function fetchInsights(): Promise<Insights> {
  cache ??= fetch(`${import.meta.env.BASE_URL}insights/v1.json`).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })
  return cache
}
export function useInsights(): Insights | null {
  const [d, setD] = useState<Insights | null>(null)
  useEffect(() => { fetchInsights().then(setD, () => setD(null)) }, [])
  return d
}

// A crypt-fire ramp: cold violet for little, bone-white for a lot.
const STOPS: [number, [number, number, number]][] = [
  [0, [38, 22, 64]], [0.3, [96, 38, 120]], [0.55, [176, 58, 110]], [0.75, [232, 110, 72]], [0.9, [246, 180, 90]], [1, [250, 232, 180]],
]
/** The ramp's colour for a 0-1 value (the heat tables use it for shares). */
export function heat(v: number): string {
  const f = Math.max(0, Math.min(1, v))
  const k = STOPS.findIndex(([s]) => s >= f)
  if (k <= 0) return `rgb(${STOPS[0][1].join(',')})`
  const [s0, c0] = STOPS[k - 1]
  const [s1, c1] = STOPS[k]
  const u = (f - s0) / (s1 - s0)
  return `rgb(${c0.map((c, i) => Math.round(c + (c1[i] - c) * u)).join(',')})`
}
