import { fmtNum } from '../content/display'
import { useHud } from '../replay/store'
import { AbilityIcon, Bar } from './bits'

export function BossFrame() {
  const h = useHud()
  if (!h) return null
  const { s, t, engine } = h
  const boss = s.units.mortisar
  if (!boss) return null
  const pct = (100 * boss.hp) / boss.info.max_hp
  const cast = boss.cast
  const castInfo = cast ? engine.replay.abilities[cast.ability] : null
  const end = boss.lastCastEnd
  const flash = !cast && end && t - end.t < 900 ? end : null
  const adds = s.order.map((id) => s.units[id]).filter((u) => u.info.kind === 'add' && u.alive)
  const fury = !!boss.auras.hollow_fury
  return (
    <div className="w-[520px]">
      <div className="card px-3.5 pb-2.5 pt-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-fg">{boss.info.name}</span>
          {fury && <span className="rounded border border-bad/40 px-1 font-mono text-[10px] uppercase text-bad">enraged</span>}
          <span className="num ml-auto font-mono text-[11px] text-fg-faint">{fmtNum(boss.hp)} / {fmtNum(boss.info.max_hp)}</span>
          <span className="num w-[52px] text-right font-mono text-[13px] font-medium text-fg">{pct.toFixed(1)}%</span>
        </div>
        <Bar frac={boss.hp / boss.info.max_hp} color={boss.alive ? '#e5484d' : '#3f3f46'} height={6} className="mt-1.5" />
        <div className="mt-2 h-[20px]">
          {cast && castInfo ? (
            <div className="flex items-center gap-2">
              <AbilityIcon ability={cast.ability} info={castInfo} size={20} />
              <Bar
                frac={(t - cast.t0) / cast.castMs}
                color={cast.interruptible ? 'rgba(251,191,36,0.85)' : 'rgba(161,161,170,0.6)'}
                height={20}
                className="flex-1"
              >
                <span>{castInfo.name}</span>
                <span className="font-mono text-[10.5px]">{((cast.t0 + cast.castMs - t) / 1000).toFixed(1)}s</span>
              </Bar>
              <span className={`w-[92px] text-right font-mono text-[10.5px] uppercase ${cast.interruptible ? 'text-warn' : 'text-fg-faint'}`}>
                {cast.interruptible ? 'interruptible' : 'not kickable'}
              </span>
            </div>
          ) : flash ? (
            <div className={`flex h-[20px] items-center justify-center rounded-[3px] font-mono text-[11px] uppercase ${flash.how === 'interrupted' ? 'bg-info/10 text-info' : 'text-fg-faint'}`}>
              {flash.how === 'interrupted' ? `${engine.replay.abilities[flash.ability]?.name ?? 'cast'} interrupted` : `${engine.replay.abilities[flash.ability]?.name} cast`}
            </div>
          ) : (
            <div className="h-[20px] rounded-[3px] bg-white/[0.03]" />
          )}
        </div>
      </div>
      {adds.length > 0 && (
        <div className="mt-1.5 flex justify-center gap-1.5">
          {adds.map((a) => (
            <div key={a.info.id} className="card w-[140px] px-2.5 py-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-fg-muted">{a.info.name.replace('Risen ', '')}</span>
                <span className="num font-mono text-fg-faint">{Math.round((100 * a.hp) / a.info.max_hp)}%</span>
              </div>
              <Bar frac={a.hp / a.info.max_hp} color="#a3a3a3" height={3} className="mt-1" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
