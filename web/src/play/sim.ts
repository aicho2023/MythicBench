// The page's side of the game worker: one promise per call, in order.
import type { ReplayEvent } from '../replay/types'
import type { Replay } from '../replay/types'

export interface Obs {
  t: number
  self: { id: string; pos: [number, number]; alive: boolean; cooldowns: Record<string, number>; gcd_ms?: number; moving: boolean; casting: unknown }
  party: { id: string; class: string; hp_pct: number; alive: boolean; pos: [number, number] }[]
  enemies: { id: string; name: string; role: string; alive: boolean; hp_pct: number; pos: [number, number]; engaged?: boolean; casting: { ability: string; interruptible: boolean; remaining_ms: number; target?: string } | null }[]
  ground: { id: string; kind: string; pos: [number, number]; radius: number; armed: boolean; detonates_in_ms?: number }[]
}

export interface Orders { move_to: [number, number] | string | null; priority: [string, string][] }

export interface Ask {
  kind: 'ask'; t: number; why: string[]; prompt: string; obs: Obs; orders: Orders | null
  chat: [number, string, string][]; events: ReplayEvent[]
}
export interface Metrics { score: number; outcome: string; in_time: boolean; duration_s: number; progress_pct?: number; deaths: { unit: string; t: number; ability: string }[] }
export interface End { kind: 'end'; events: ReplayEvent[]; metrics: Metrics; debrief: string }
export type Step = Ask | End
export type Start = Step & { rules: string; replay_head: Replay }

let worker: Worker | null = null
let next = 0
const waiting = new Map<number, { ok: (v: string) => void; fail: (e: Error) => void }>()

function call(op: string, ...args: unknown[]): Promise<string> {
  worker ??= (() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: string; error?: string }>) => {
      const p = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      if (e.data.ok) p?.ok(e.data.value!)
      else p?.fail(new Error(e.data.error))
    }
    return w
  })()
  const id = next++
  return new Promise((ok, fail) => { waiting.set(id, { ok, fail }); worker!.postMessage({ id, op, args }) })
}

export const sim = {
  boot: () => call('boot'),
  start: async (seat: string, seed: number, tier: string, pull: number) => JSON.parse(await call('js_start', seat, seed, tier, pull)) as Start,
  answer: async (text: string) => JSON.parse(await call('js_answer', text)) as Step,
  replay: async () => JSON.parse(await call('js_replay')) as Replay,
  expert: async (seed: number, tier: string) => JSON.parse(await call('js_expert', seed, tier)) as Metrics,
}
