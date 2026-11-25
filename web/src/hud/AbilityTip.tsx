import type { ReactNode } from 'react'
import { create } from 'zustand'
import { SCHOOL_COLORS, TOOLTIP_GOLD } from '../content/display'
import { useHud } from '../replay/store'
import { AbilityIcon } from './bits'
import { COLOR } from '../site/tokens'

/**
 * WoW-style spell tooltips for the viewer's HUD. Hovering an ability or aura
 * icon shows its name, cast time, cooldown and description, and (live, as the
 * replay plays) whether it's ready. One tooltip layer for the whole HUD, so
 * the party frames can re-render every frame without losing the hover.
 */
interface Tip { kind: 'ability' | 'aura'; id: string; unit: string; x: number; y: number }

const useTip = create<{ tip: Tip | null; show: (t: Tip) => void; hide: () => void }>((set) => ({
  tip: null,
  show: (tip) => set({ tip }),
  hide: () => set({ tip: null }),
}))

/** Wrap an icon to give it a tooltip. */
export function TipTarget({ kind, id, unit, children }: { kind: Tip['kind']; id: string; unit: string; children: ReactNode }) {
  const show = useTip((s) => s.show)
  const hide = useTip((s) => s.hide)
  return (
    <span
      className="pointer-events-auto inline-flex cursor-help"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        show({ kind, id, unit, x: r.right, y: r.top })
      }}
      onMouseLeave={hide}
    >
      {children}
    </span>
  )
}

function secsText(ms: number) {
  return ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${+(ms / 1000).toFixed(1)} s`
}

export function TipLayer() {
  const tip = useTip((s) => s.tip)
  const h = useHud()
  if (!tip || !h) return null
  const { engine, s, t } = h
  const u = s.units[tip.unit]
  let body: ReactNode
  if (tip.kind === 'ability') {
    const a = engine.replay.abilities[tip.id]
    if (!a) return null
    const rem = Math.max(0, (u?.readyAt[tip.id] ?? 0) - t)
    const casting = u?.cast?.ability === tip.id
    body = (
      <>
        <div className="flex items-center gap-2">
          <AbilityIcon ability={tip.id} info={a} size={28} />
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-fg">{a.name}</div>
            <div className="text-meta text-fg-faint">
              {a.cast_ms ? `${secsText(a.cast_ms)} cast` : 'Instant'}
              {a.cooldown_ms ? `, ${secsText(a.cooldown_ms)} cooldown` : ''}
            </div>
          </div>
        </div>
        <p className="mt-2 text-[13px] leading-5" style={{ color: TOOLTIP_GOLD }}>{a.description}</p>
        <div className={`mt-2 text-meta ${casting ? 'text-info' : rem > 0 ? 'text-fg-muted' : 'text-good'}`}>
          {casting ? `${u?.info.name} is casting this now` : rem > 0 ? `Ready in ${secsText(Math.ceil(rem / 100) * 100)}` : 'Ready'}
        </div>
      </>
    )
  } else {
    const a = engine.replay.auras[tip.id]
    const on = u?.auras[tip.id]
    if (!a) return null
    body = (
      <>
        <div className="text-[14px] font-medium" style={{ color: a.harmful ? COLOR.bad : SCHOOL_COLORS.holy }}>{a.name}</div>
        {a.description && <p className="mt-1 text-[13px] leading-5" style={{ color: TOOLTIP_GOLD }}>{a.description}</p>}
        {on && (
          <div className="mt-2 text-meta text-fg-muted">
            {on.stacks && on.stacks > 1 ? `${on.stacks} stacks, ` : ''}{secsText(Math.max(0, on.t0 + on.dur - t))} left
          </div>
        )}
      </>
    )
  }
  return (
    <div
      className="pointer-events-none fixed z-50 w-[260px] rounded-lg border border-white/15 bg-surface px-3 py-2.5 shadow-xl"
      style={{ left: tip.x + 10, top: Math.max(8, tip.y - 8) }}
      role="tooltip"
    >
      {body}
    </div>
  )
}
