import { CLASS_COLORS, fmtNum } from '../content/display'
import { useHud } from '../replay/store'
import { AbilityIcon, Bar } from './bits'

export function BossFrame() {
  const h = useHud()
  if (!h) return null
  const { s, t, engine } = h
  const boss = s.units.mortisar
  if (!boss) return null
  if (engine.replay.meta.mode === 'dungeon' && !boss.engaged) return <PackFrame />
  const pct = (100 * boss.hp) / boss.info.max_hp
  const cast = s.ended ? null : boss.cast // nothing is "being cast" once the fight is over
  const castInfo = cast ? engine.replay.abilities[cast.ability] : null
  const end = boss.lastCastEnd
  const flash = !cast && end && t - end.t < 900 ? end : null
  const adds = s.order.map((id) => s.units[id]).filter((u) => u.info.kind === 'add' && u.alive)
  const fury = !!boss.auras.hollow_fury
  return (
    <div className="relative w-[520px] max-w-[calc((100vw-32px)/var(--hud))]">
      <div className="card px-3 pb-3 pt-2">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium leading-5 text-fg">{boss.info.name}</span>
          {fury && <span className="text-label font-medium text-bad">Enraged</span>}
          <span className="num ml-auto shrink-0 font-mono text-meta text-fg-faint">{fmtNum(boss.hp)} / {fmtNum(boss.info.max_hp)}</span>
          <span className="num w-14 shrink-0 text-right font-mono text-[13px] text-fg">{pct.toFixed(1)}%</span>
        </div>
        <Bar frac={boss.hp / boss.info.max_hp} color={boss.alive ? '#e5484d' : '#3f3f46'} height={8} className="mt-1" />
        <div className="mt-2 h-5">
          {cast && castInfo ? (
            <div className="flex items-center gap-2">
              <AbilityIcon ability={cast.ability} info={castInfo} size={20} />
              <Bar
                frac={(t - cast.t0) / cast.castMs}
                color={cast.interruptible ? 'rgba(251,191,36,0.85)' : 'rgba(161,161,170,0.6)'}
                height={20}
                className="min-w-0 flex-1"
              >
                <span className="truncate">{castInfo.name}</span>
                <span className="font-mono text-meta">{((cast.t0 + cast.castMs - t) / 1000).toFixed(1)} s</span>
              </Bar>
              <span className={`w-24 shrink-0 text-right text-label ${cast.interruptible ? 'text-warn' : 'text-fg-faint'}`}>
                {cast.interruptible ? 'Interruptible' : 'Can’t interrupt'}
              </span>
            </div>
          ) : flash ? (
            <div className={`flex h-5 items-center justify-center rounded-[3px] text-label ${flash.how === 'interrupted' ? 'bg-info/10 text-info' : 'text-fg-faint'}`}>
              {flash.how === 'interrupted' ? `${engine.replay.abilities[flash.ability]?.name ?? 'Cast'} interrupted` : `${engine.replay.abilities[flash.ability]?.name} completed`}
            </div>
          ) : (
            <div className="h-5 rounded-[3px] bg-white/[0.03]" />
          )}
        </div>
      </div>
      {adds.length > 0 && (
        <div className="absolute inset-x-0 top-full mt-2 flex flex-wrap justify-center gap-2">
          {adds.map((a) => (
            <div key={a.info.id} className="card w-32 shrink-0 px-2 py-1">
              <div className="flex justify-between gap-2 text-meta">
                <span style={{ color: CLASS_COLORS[a.info.class] ?? undefined }} className="truncate">{a.info.name.replace('Risen ', '')}</span>
                <span className="num font-mono text-fg-faint">{Math.round((100 * a.hp) / a.info.max_hp)}%</span>
              </div>
              <Bar frac={a.hp / a.info.max_hp} color="#e5484d" height={4} className="mt-1" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


/** Dungeon runs before the boss: the pack being fought (or the next one). */
function PackFrame() {
  const h = useHud()
  if (!h) return null
  const { s, t, engine } = h
  const packs = engine.replay.arena.packs ?? []
  const current = packs.find((p) => s.pulled[p.id] !== undefined && s.cleared[p.id] === undefined)
  const next = current ?? packs.find((p) => s.pulled[p.id] === undefined)
  const units = next ? next.members.map((id) => s.units[id]).filter(Boolean) : []
  return (
    <div className="w-[520px] max-w-[calc((100vw-32px)/var(--hud))]">
      <div className="card px-3 pb-3 pt-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium leading-5 text-fg">{next ? next.name : 'Mortisar, the Hollow King'}</span>
          <span className={`text-label ${current ? 'text-bad' : 'text-fg-faint'}`}>
            {current ? 'In combat' : next ? 'Up next, not pulled' : 'Up next, asleep on his throne'}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
          {units.map((u) => {
            const cast = u.cast && !s.ended ? engine.replay.abilities[u.cast.ability] : null
            return (
              <div key={u.info.id} className={u.alive ? '' : 'opacity-40'}>
                <div className="flex justify-between text-meta">
                  <span className={u.info.class === 'bonewalker' ? 'text-fg-muted' : 'text-warn'}>{u.info.name}</span>
                  <span className="num font-mono text-fg-faint">{u.alive ? `${Math.round((100 * u.hp) / u.info.max_hp)}%` : 'Dead'}</span>
                </div>
                <Bar frac={u.hp / u.info.max_hp} color={u.alive ? '#e5484d' : '#3f3f46'} height={4} className="mt-1" />
                {cast && u.cast && (
                  <Bar frac={(t - u.cast.t0) / u.cast.castMs} color={cast.interruptible ? 'rgba(251,191,36,0.85)' : 'rgba(161,161,170,0.6)'}
                    height={16} className="mt-1">
                    <span className="truncate text-meta">{cast.name}</span>
                    {cast.interruptible && <span className="text-meta">Kick</span>}
                  </Bar>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
