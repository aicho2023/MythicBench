import { Crown, ShieldOff, Skull, Zap } from 'lucide-react'
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
    <div className="w-[560px]">
      <div className="panel px-3 pb-2 pt-1.5">
        <div className="mb-1 flex items-center gap-2">
          <Skull size={16} className="text-red-400" />
          <span className="font-display text-[15px] font-bold tracking-wide text-gold-300">{boss.info.name}</span>
          <Crown size={14} className="text-cyan-300" />
          {fury && <span className="rounded bg-red-600/80 px-1.5 font-body text-[10px] font-extrabold uppercase text-white">Enraged</span>}
          <span className="ml-auto font-body text-xs font-bold text-white/70">
            {fmtNum(boss.hp)} / {fmtNum(boss.info.max_hp)}
          </span>
        </div>
        <Bar frac={boss.hp / boss.info.max_hp} color={boss.alive ? '#d23a5a' : '#444'} height={22}>
          <span />
          <span className="text-[13px]">{pct.toFixed(1)}%</span>
          <span />
        </Bar>
        <div className="mt-1.5 h-[22px]">
          {cast && castInfo ? (
            <div className="flex items-center gap-1.5">
              <AbilityIcon ability={cast.ability} info={castInfo} size={22} />
              <div className="relative flex-1">
                <Bar
                  frac={(t - cast.t0) / cast.castMs}
                  color={cast.interruptible ? '#f2b636' : '#8b8ba0'}
                  height={18}
                >
                  <span className="flex items-center gap-1">
                    {cast.interruptible ? <Zap size={11} className="text-yellow-200" /> : <ShieldOff size={11} />}
                    {castInfo.name}
                  </span>
                  <span>{((cast.t0 + cast.castMs - t) / 1000).toFixed(1)}s</span>
                </Bar>
              </div>
              {cast.interruptible && (
                <span className="animate-pulse rounded bg-yellow-400 px-1.5 py-0.5 font-body text-[10px] font-black uppercase text-ink-900">Kick!</span>
              )}
            </div>
          ) : flash ? (
            <div className={`flex h-[18px] items-center justify-center rounded font-display text-[12px] font-bold uppercase tracking-widest ${flash.how === 'interrupted' ? 'bg-sky-500/30 text-sky-200 ring-1 ring-sky-400/60' : 'bg-white/5 text-white/40'}`}>
              {flash.how === 'interrupted' ? 'Interrupted!' : engine.replay.abilities[flash.ability]?.name}
            </div>
          ) : null}
        </div>
      </div>
      {adds.length > 0 && (
        <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
          {adds.map((a) => (
            <div key={a.info.id} className="panel w-[150px] px-2 py-1">
              <div className="font-body text-[10px] font-bold text-lime-200/90">{a.info.name}</div>
              <Bar frac={a.hp / a.info.max_hp} color="#86c95a" height={9} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
