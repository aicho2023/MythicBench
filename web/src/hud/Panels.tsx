import { Brain, CheckCircle2, Circle, Hourglass, Skull } from 'lucide-react'
import { useState } from 'react'
import { CLASS_COLORS, WARN_CASTS, fmtNum, fmtTime } from '../content/display'
import { usePlayback, useHud } from '../replay/store'

// ---------------------------------------------------------------------------
// Dungeon timer ("Sigil" = our keystone level)
// ---------------------------------------------------------------------------
export function DungeonTimer() {
  const h = useHud()
  if (!h) return null
  const { s, engine } = h
  const t = s.ended ? Math.min(h.t, s.ended.t) : h.t // timer stops on kill/wipe
  const m = engine.replay.meta
  const limit = m.time_limit_ms
  const over = t > limit
  const won = s.ended?.outcome === 'victory'
  return (
    <div className="panel w-[260px] p-3">
      <div className="flex items-center justify-between">
        <span className="font-display text-[15px] font-bold text-gold-300">Gravecrown Crypt</span>
        <span className="rounded bg-gradient-to-b from-purple-500 to-purple-800 px-2 py-0.5 font-display text-xs font-black text-white ring-1 ring-purple-300/60">
          +{m.sigil_level}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <Hourglass size={14} className={over ? 'text-red-400' : 'text-gold-400'} />
        <span className={`font-display text-2xl font-bold tabular-nums ${over ? 'text-red-400' : 'text-white'}`}>{fmtTime(t)}</span>
        <span className="font-body text-sm text-white/50">/ {fmtTime(limit)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/60">
        <div className="h-full bg-gradient-to-r from-gold-500 to-gold-300" style={{ width: `${Math.min(100, (t / limit) * 100)}%` }} />
      </div>
      <div className="mt-2.5 space-y-1 font-body text-[12px] text-white/80">
        <div className="flex items-center gap-1.5">
          {won ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Circle size={13} className="text-white/40" />}
          <span className={won ? 'text-emerald-300 line-through decoration-emerald-500/60' : ''}>Defeat Mortisar, the Hollow King</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Skull size={13} className="text-red-300/80" />
          <span>Party deaths: <b className="text-white">{s.deaths}</b></span>
        </div>
      </div>
      <div className="mt-2.5 border-t border-white/10 pt-2 font-mono text-[10px] leading-relaxed text-white/45">
        policy <span className="text-white/70">{m.policy}</span> · seed <span className="text-white/70">{m.seed}</span><br />
        sim v{m.sim_version} · content v{m.content_version}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Damage meter
// ---------------------------------------------------------------------------
type Tab = 'damage' | 'healing' | 'mechanics'
export function DamageMeter() {
  const [tab, setTab] = useState<Tab>('damage')
  const h = useHud()
  if (!h) return null
  const { s, t } = h
  const players = s.order.map((id) => s.units[id]).filter((u) => u.info.kind === 'player')
  const src = tab === 'damage' ? s.damageDone : s.healingDone
  const rows = players.map((u) => ({ u, v: src[u.info.id] ?? 0 })).sort((a, b) => b.v - a.v)
  const max = Math.max(1, ...rows.map((r) => r.v))
  const sec = Math.max(1, t / 1000)
  return (
    <div className="panel w-[300px] p-2">
      <div className="mb-1.5 flex gap-1">
        {(['damage', 'healing', 'mechanics'] as Tab[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded px-1 py-0.5 font-display text-[11px] font-bold capitalize transition ${tab === k ? 'bg-gold-500/25 text-gold-300 ring-1 ring-gold-500/60' : 'text-white/50 hover:text-white/80'}`}
          >
            {k}
          </button>
        ))}
      </div>
      {tab !== 'mechanics' ? (
        <div className="space-y-1">
          {rows.map(({ u, v }) => (
            <div key={u.info.id} className="relative h-[19px] overflow-hidden rounded-[3px] bg-black/50">
              <div className="absolute inset-y-0 left-0" style={{ width: `${(v / max) * 100}%`, background: `linear-gradient(90deg, ${CLASS_COLORS[u.info.class]}cc, ${CLASS_COLORS[u.info.class]}77)` }} />
              <div className="absolute inset-0 flex items-center justify-between px-1.5 font-body text-[11px] font-bold text-white [text-shadow:0_1px_1px_#000]">
                <span>{u.info.name}</span>
                <span className="tabular-nums">{fmtNum(v)} <span className="text-white/60">({fmtNum(v / sec)})</span></span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5 font-body text-[12px] text-white/85">
          <Row label="Interrupts" value={`${s.kicks.interrupted} / ${s.kicks.casts}`} good={s.kicks.interrupted === s.kicks.casts} />
          <Row label="Party deaths" value={`${s.deaths}`} good={s.deaths === 0} />
          <div className="pt-1 text-[10px] uppercase tracking-wider text-white/40">Avoidable damage taken (Desecrate)</div>
          {players.map((u) => (
            <div key={u.info.id} className="flex justify-between">
              <span style={{ color: CLASS_COLORS[u.info.class] }}>{u.info.name}</span>
              <span className={`tabular-nums ${(s.avoidableTaken[u.info.id] ?? 0) > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                {fmtNum(s.avoidableTaken[u.info.id] ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={`font-bold tabular-nums ${good ? 'text-emerald-300' : 'text-red-300'}`}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Raid warnings and boss yells (center screen)
// ---------------------------------------------------------------------------
export function RaidWarnings() {
  const h = useHud()
  if (!h) return null
  const { t, engine, s } = h
  const items: { key: number; text: string; style: 'warning' | 'yell'; age: number; dur: number }[] = []
  for (const { e, i } of engine.eventsBetween(t - 6000, t)) {
    const age = t - e.t
    if (e.type === 'emote') {
      const dur = e.style === 'yell' ? 5000 : 2500
      if (age < dur) items.push({ key: i, text: e.style === 'yell' ? `Mortisar yells: ${e.text}` : e.text, style: e.style, age, dur })
    } else if (e.type === 'cast_start' && WARN_CASTS[e.ability] && s.units[e.unit]?.cast?.t0 === e.t) {
      const tgt = e.target ? s.units[e.target]?.info.name ?? '' : ''
      items.push({ key: i, text: WARN_CASTS[e.ability].replace('{target}', tgt), style: 'warning', age, dur: e.cast_ms + 10000 })
    } else if (e.type === 'ground_spawn' && age < 1500 && e.target === undefined) {
      // (pools are announced below via Desecrate cast)
    } else if (e.type === 'cast_success' && e.ability === 'desecrate' && age < 2000) {
      items.push({ key: i, text: 'Desecrate! Move out of the swirls!', style: 'warning', age, dur: 2000 })
    }
  }
  const shown = items.slice(-3)
  return (
    <div className="flex flex-col items-center gap-1">
      {shown.map((w) => {
        const fade = Math.min(1, (w.dur - w.age) / 400)
        const pop = w.age < 150 ? 1.15 - (w.age / 150) * 0.15 : 1
        return (
          <div
            key={w.key}
            style={{ opacity: fade, transform: `scale(${pop})` }}
            className={w.style === 'yell'
              ? 'max-w-[640px] text-center font-body text-[15px] font-bold italic text-rose-300 [text-shadow:0_2px_4px_#000,0_0_8px_#000]'
              : 'whitespace-nowrap text-center font-display text-[20px] font-black tracking-wide text-yellow-300 [text-shadow:0_2px_0_#7a3c00,0_0_12px_#000,0_0_3px_#000]'}
          >
            {w.text}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Decision log: what the agents did and WHY (their stated reason)
// ---------------------------------------------------------------------------
export function DecisionLog() {
  const h = useHud()
  const seek = usePlayback((p) => p.seek)
  if (!h) return null
  const { t, engine, s } = h
  const rows: { key: number; t: number; who: string; cls: string; text: string; sub?: string; tone: 'info' | 'bad' | 'good' }[] = []
  for (const { e, i } of engine.eventsBetween(t - 40000, t)) {
    if (e.type === 'decision') {
      const u = s.units[e.unit]
      rows.push({ key: i, t: e.t, who: u?.info.name ?? e.unit, cls: u?.info.class ?? '', text: e.action, sub: e.reason, tone: 'info' })
    } else if (e.type === 'death' && s.units[e.unit]?.info.kind === 'player') {
      const u = s.units[e.unit]
      rows.push({ key: i, t: e.t, who: u.info.name, cls: u.info.class, text: `died to ${engine.replay.abilities[e.ability]?.name ?? engine.replay.auras[e.ability]?.name ?? e.ability}`, tone: 'bad' })
    } else if (e.type === 'cast_success' && e.ability === 'requiem_of_bones') {
      rows.push({ key: i, t: e.t, who: 'Mortisar', cls: 'boss', text: 'Requiem of Bones went off!', sub: 'Nobody interrupted it.', tone: 'bad' })
    }
  }
  const shown = rows.slice(window.innerHeight < 840 ? -3 : -6).reverse()
  return (
    <div className="panel w-[340px] p-2">
      <div className="mb-1 flex items-center gap-1.5 font-display text-[12px] font-bold text-gold-300">
        <Brain size={13} /> Agent decisions
        <span className="ml-auto font-body text-[10px] font-normal text-white/40">click to rewind</span>
      </div>
      <div className="space-y-1">
        {shown.length === 0 && <div className="font-body text-[11px] text-white/40">Waiting for the pull…</div>}
        {shown.map((r) => (
          <button
            key={r.key}
            onClick={() => seek(r.t - 2000)}
            className={`block w-full rounded px-1.5 py-1 text-left font-body leading-tight transition hover:bg-white/10 ${r.tone === 'bad' ? 'bg-red-900/30' : 'bg-white/[0.03]'}`}
          >
            <div className="flex gap-1.5 text-[11px]">
              <span className="tabular-nums text-white/40">{fmtTime(r.t)}</span>
              <span className="font-bold" style={{ color: CLASS_COLORS[r.cls] ?? '#ff8a8a' }}>{r.who}</span>
              <span className={r.tone === 'bad' ? 'text-red-300' : 'text-white/85'}>{r.text}</span>
            </div>
            {r.sub && <div className="pl-9 text-[10.5px] italic text-white/50">“{r.sub}”</div>}
          </button>
        ))}
      </div>
    </div>
  )
}
