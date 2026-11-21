import { Skull } from 'lucide-react'
import { CLASS_COLORS, ROLE_LABEL, TRACKED_COOLDOWNS, fmtNum } from '../content/display'
import { useHud } from '../replay/store'
import { AbilityIcon, Bar, RoleIcon, secs } from './bits'

/** One card, five rows: the party at a glance. */
export function PartyFrames() {
  const h = useHud()
  if (!h) return null
  const { s, t, engine } = h
  const players = s.order.map((id) => s.units[id]).filter((u) => u.info.kind === 'player')
  return (
    <div className="card w-[272px] py-2">
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="label">Party</span>
        <span className="num font-mono text-meta text-fg-faint">{players.filter((u) => u.alive).length}/{players.length} alive</span>
      </div>
      {players.map((u) => {
        const col = CLASS_COLORS[u.info.class]
        const cls = engine.replay.classes[u.info.class]
        const hit = t - u.lastHitT < 180
        const pct = Math.round((100 * u.hp) / u.info.max_hp)
        const low = u.alive && pct < 35
        return (
          <div
            key={u.info.id}
            className={`relative px-3 py-1.5 transition-colors ${hit ? 'bg-bad/[0.08]' : ''} ${u.alive ? '' : 'opacity-50'}`}
          >
            <div className="flex items-center gap-2">
              <RoleIcon role={u.info.role} size={12} />
              <span className="text-[13px] font-medium leading-5" style={{ color: col }}>{u.info.name}</span>
              <span className="truncate text-meta text-fg-faint">{cls?.name} · {ROLE_LABEL[u.info.role]}</span>
              <span className={`num ml-auto font-mono text-meta ${!u.alive ? 'text-bad' : low ? 'text-warn' : 'text-fg-muted'}`}>
                {u.alive ? `${pct}%` : <span className="flex items-center gap-1"><Skull size={12} />Dead</span>}
              </span>
            </div>
            <Bar
              frac={u.hp / u.info.max_hp}
              absorbFrac={u.absorb / u.info.max_hp}
              color={u.alive ? col : '#3f3f46'}
              height={5}
              className="mt-1"
            />
            {u.cast ? (
              <Bar frac={(t - u.cast.t0) / u.cast.castMs} color="rgba(255,255,255,0.55)" height={2} className="mt-0.5" track="transparent" />
            ) : <div className="mt-0.5 h-[2px]" />}
            <div className="mt-1 flex items-center gap-1">
              {(TRACKED_COOLDOWNS[u.info.class] ?? []).map((ab) => {
                const info = engine.replay.abilities[ab]
                const rem = Math.max(0, (u.readyAt[ab] ?? 0) - t)
                return <AbilityIcon key={ab} ability={ab} info={info} size={18} remainingMs={rem} totalMs={info.cooldown_ms} label={rem > 0 ? secs(rem) : undefined} />
              })}
              <div className="ml-auto flex gap-1">
                {Object.entries(u.auras).slice(0, 4).map(([aid, a]) => {
                  const info = engine.replay.auras[aid]
                  const rem = a.t0 + a.dur - t
                  return (
                    <AbilityIcon key={aid} ability={aid} info={{ ...info, school: info.harmful ? 'shadow' : 'holy' }} harmful={info.harmful} size={18}
                      label={rem < 60000 ? secs(rem) : undefined} title={`${info.name}: ${info.description ?? ''}`} />
                  )
                })}
              </div>
            </div>
            {/* hp text kept for screen readers / hover */}
            <span className="sr-only">{fmtNum(u.hp)} health</span>
          </div>
        )
      })}
    </div>
  )
}
