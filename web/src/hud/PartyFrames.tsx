import { HeartPulse, Shield, Skull, Swords } from 'lucide-react'
import { CLASS_COLORS, ROLE_LABEL, TRACKED_COOLDOWNS, fmtNum } from '../content/display'
import { useHud } from '../replay/store'
import { AbilityIcon, Bar, secs } from './bits'

const ROLE_ICON = { tank: Shield, healer: HeartPulse, dps: Swords } as const

export function PartyFrames() {
  const h = useHud()
  if (!h) return null
  const { s, t, engine } = h
  const players = s.order.map((id) => s.units[id]).filter((u) => u.info.kind === 'player')
  return (
    <div className="flex w-[268px] flex-col gap-1.5">
      {players.map((u) => {
        const col = CLASS_COLORS[u.info.class]
        const RoleIcon = ROLE_ICON[u.info.role as keyof typeof ROLE_ICON] ?? Swords
        const cls = engine.replay.classes[u.info.class]
        const hit = t - u.lastHitT < 180
        const cast = u.cast ? engine.replay.abilities[u.cast.ability] : null
        return (
          <div
            key={u.info.id}
            className={`panel flex gap-2 p-1.5 transition-all ${u.alive ? '' : 'opacity-60 grayscale'} ${hit ? 'ring-1 ring-red-500/70' : ''}`}
          >
            <div
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full ring-2"
              style={{ background: `radial-gradient(circle at 35% 30%, ${col}, ${col}55 70%, #0008)`, boxShadow: `0 0 10px ${col}55` }}
            >
              <span className="font-display text-lg font-bold text-ink-900">{u.info.name[0]}</span>
              <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ink-900 ring-1 ring-gold-500">
                <RoleIcon size={11} className="text-gold-300" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between leading-none">
                <span className="font-display text-[13px] font-bold" style={{ color: col }}>{u.info.name}</span>
                <span className="font-body text-[10px] uppercase tracking-wide text-white/50">
                  {cls?.name} · {ROLE_LABEL[u.info.role]}
                </span>
              </div>
              <Bar frac={u.hp / u.info.max_hp} absorbFrac={u.absorb / u.info.max_hp} color={u.alive ? col : '#555'} height={15} className="mt-1">
                {u.alive ? (
                  <>
                    <span>{fmtNum(u.hp)}</span>
                    <span>{Math.round((100 * u.hp) / u.info.max_hp)}%</span>
                  </>
                ) : (
                  <span className="flex items-center gap-1 text-red-300"><Skull size={11} /> Dead</span>
                )}
              </Bar>
              {cast && u.cast ? (
                <Bar frac={(t - u.cast.t0) / u.cast.castMs} color="#e9c46a" height={8} className="mt-0.5" />
              ) : (
                <div className="mt-0.5 h-2" />
              )}
              <div className="mt-1 flex items-center gap-1">
                {(TRACKED_COOLDOWNS[u.info.class] ?? []).map((ab) => {
                  const info = engine.replay.abilities[ab]
                  const rem = Math.max(0, (u.readyAt[ab] ?? 0) - t)
                  return <AbilityIcon key={ab} ability={ab} info={info} size={20} remainingMs={rem} totalMs={info.cooldown_ms} label={rem > 0 ? secs(rem) : undefined} />
                })}
                <div className="ml-auto flex gap-0.5">
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
            </div>
          </div>
        )
      })}
    </div>
  )
}
