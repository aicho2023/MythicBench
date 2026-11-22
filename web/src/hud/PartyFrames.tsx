import { Skull } from 'lucide-react'
import { CLASS_COLORS, ROLE_LABEL, SCHOOL_COLORS, fmtNum } from '../content/display'
import { useHud } from '../replay/store'
import { TipTarget } from './AbilityTip'
import { AbilityIcon, Bar, RoleIcon } from './bits'

/** How long an instant ability stays highlighted after it's used. */
const USED_MS = 1200

/** One card, five rows: the party at a glance, with every ability (cooldowns
 * swept) and the one in use highlighted. */
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
        // What this character is doing: its cast, or the ability it used in the last moment.
        const active = u.alive ? (u.cast?.ability ?? (u.lastAction && t - u.lastAction.t < USED_MS ? u.lastAction.ability : null)) : null
        const activeInfo = active ? engine.replay.abilities[active] : null
        return (
          <div
            key={u.info.id}
            className={`relative px-3 py-1.5 transition-colors ${hit ? 'bg-bad/[0.08]' : ''} ${u.alive ? '' : 'opacity-50'}`}
          >
            <div className="flex items-center gap-2">
              <RoleIcon role={u.info.role} size={12} />
              <span className="text-[13px] font-medium leading-5" style={{ color: col }}>{u.info.name}</span>
              {activeInfo ? (
                <span className="truncate text-meta" style={{ color: SCHOOL_COLORS[activeInfo.school] ?? '#ededef' }}>
                  {u.cast ? `Casting ${activeInfo.name}` : activeInfo.name}
                </span>
              ) : (
                <span className="truncate text-meta text-fg-faint" title={`${cls?.name}, ${ROLE_LABEL[u.info.role]?.toLowerCase()}`}>{cls?.name}</span>
              )}
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
            <div className="mt-1.5 flex items-center gap-1">
              {(cls?.abilities ?? []).map((ab) => {
                const info = engine.replay.abilities[ab]
                const rem = Math.max(0, (u.readyAt[ab] ?? 0) - t)
                const on = ab === active
                return (
                  <TipTarget key={ab} kind="ability" id={ab} unit={u.info.id}>
                    <span className="rounded transition-shadow" style={on ? { boxShadow: `0 0 0 1.5px ${col}` } : undefined}>
                      <AbilityIcon ability={ab} info={info} size={22} remainingMs={u.alive ? rem : 0} totalMs={info.cooldown_ms}
                        label={u.alive && rem >= 1000 ? String(Math.ceil(rem / 1000)) : undefined} title="" />
                    </span>
                  </TipTarget>
                )
              })}
              <div className="ml-auto flex gap-1">
                {Object.entries(u.auras).slice(0, 3).map(([aid, a]) => {
                  const info = engine.replay.auras[aid]
                  return (
                    <TipTarget key={aid} kind="aura" id={aid} unit={u.info.id}>
                      <AbilityIcon ability={aid} info={{ ...info, school: info.harmful ? 'shadow' : 'holy' }} harmful={info.harmful} size={18}
                        label={a.stacks && a.stacks > 1 ? String(a.stacks) : undefined} title="" />
                    </TipTarget>
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
