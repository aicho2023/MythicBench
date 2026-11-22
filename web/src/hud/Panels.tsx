import { bossOf } from '../replay/engine'
import { AlertTriangle, Megaphone } from 'lucide-react'
import { useState } from 'react'
import type { ReplayMeta } from '../replay/types'
import { CLASS_COLORS, WARN_CASTS, dungeonProgress, dungeonScore, fmtNum, fmtTime, runScore } from '../content/display'
import { usePlayback, useHud } from '../replay/store'
import { useInspector } from './CallInspector'

// ---------------------------------------------------------------------------
// Scorecard: the eval's metrics, live as the replay plays.
// ---------------------------------------------------------------------------
export function Scorecard() {
  const h = useHud()
  if (!h) return null
  const { s, engine } = h
  const t = s.ended ? Math.min(h.t, s.ended.t) : h.t // timer stops on kill/wipe
  const m = engine.replay.meta
  const limit = m.time_limit_ms
  const boss = bossOf(s)
  const bossPct = boss ? (100 * boss.hp) / boss.info.max_hp : 0
  const avoidable = Object.values(s.avoidableTaken).reduce((a, b) => a + b, 0)
  const dungeon = m.mode === 'dungeon'
  const timer = t + (dungeon ? s.penaltyMs : 0) // revive penalties count against the run timer
  const progress = dungeon ? dungeonProgress(s.units) : 0
  const score = dungeon
    ? dungeonScore(s.ended?.outcome ?? null, (s.ended?.t ?? t) + s.penaltyMs, progress, limit)
    : runScore(s.ended?.outcome ?? null, s.ended?.t ?? 0, bossPct, limit)
  const packs = engine.replay.arena.packs ?? []
  const outcome = !s.ended ? { text: 'In progress', cls: 'text-fg-muted' }
    : s.ended.outcome === 'victory' ? { text: 'Clear', cls: 'text-good' }
      : s.ended.outcome === 'timeout' ? { text: 'Out of time', cls: 'text-bad' } : { text: 'Wipe', cls: 'text-bad' }
  return (
    <div className="card w-[272px]">
      <div className="flex items-center justify-between px-3 pb-2 pt-2">
        <span className="label">Scorecard</span>
        <span className={`text-label font-medium ${outcome.cls}`}>{outcome.text}</span>
      </div>
      <div className="px-3">
        <div className="flex items-baseline justify-between">
          <span className={`num font-mono text-[20px] leading-7 ${timer > limit ? 'text-bad' : 'text-fg'}`}>{fmtTime(timer)}</span>
          <span className="num font-mono text-meta text-fg-faint">
            {dungeon && s.penaltyMs > 0 && <span className="mr-2 text-bad">+{s.penaltyMs / 1000}s</span>}
            limit {fmtTime(limit)}
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full bg-fg/70" style={{ width: `${Math.min(100, (timer / limit) * 100)}%` }} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-line px-3 pb-1 pt-2"
        title={dungeon
          ? 'Score 0-100. A wipe earns up to 70 for progress (each pack 15%, Oruth 70%); a clear earns 70 plus up to 30 for speed (full 30 with a quarter of the timer left; revive penalties count).'
          : 'Score 0-100. A wipe earns up to 70 for boss health removed; a kill earns 70 plus up to 30 for speed (full 30 with a quarter of the timer left).'}>
        <span className="text-[12px] text-fg-muted">Score{!s.ended && <span className="text-fg-faint"> so far</span>}</span>
        <span className="num font-mono text-[20px] leading-7 text-fg">{score.toFixed(1)}</span>
      </div>
      <dl className="px-3 pb-2">
        {dungeon && <>
          <Metric label="Run progress" value={`${progress.toFixed(1)}%`} tone={progress >= 100 ? 'good' : 'plain'} />
          {packs.map((p) => (
            <Metric key={p.id} label={p.name}
              value={s.cleared[p.id] !== undefined ? 'cleared' : s.pulled[p.id] !== undefined ? 'fighting' : 'not pulled'}
              tone={s.cleared[p.id] !== undefined ? 'good' : 'plain'} />
          ))}
        </>}
        <Metric label={dungeon ? 'Oruth' : 'Boss health left'}
          value={dungeon && !boss?.engaged ? 'asleep' : `${bossPct.toFixed(1)}% left`.replace(dungeon ? '' : ' left', '')}
          tone={bossPct === 0 ? 'good' : 'plain'} />
        <Metric label="Interrupts" value={`${s.kicks.interrupted} / ${s.kicks.casts}`}
          tone={s.kicks.casts === 0 ? 'plain' : s.kicks.interrupted === s.kicks.casts ? 'good' : 'bad'} />
        <Metric label={dungeon ? 'Party deaths (revives)' : 'Party deaths'} value={`${s.deaths}`} tone={s.deaths === 0 ? 'good' : 'bad'} />
        <Metric label="Pool damage taken" value={fmtNum(avoidable)} tone={avoidable === 0 ? 'good' : 'bad'} />
      </dl>
      <Reproduce />
    </div>
  )
}

/** The command that rebuilds this exact replay, from the commit that made it. */
export function reproduceCommand(m: ReplayMeta): string {
  const tier = m.tier ?? 'plus10'
  const mode = m.mode ?? 'boss'
  const r = m.run
  const lines = r?.git_commit ? [`git checkout ${r.git_commit.replace(/-dirty$/, '')}`] : []
  if (!r || !m.progress) {
    if (m.policy.startsWith('scripted-')) {
      lines.push(`cd sim && python -m mythicsim run --policy ${m.policy.slice(9)} --seed ${m.seed} --tier ${tier} --mode ${mode} --out replay.json`)
    } else if (r) {
      lines.push(`cd sim && python -m mythicsim llm --model ${r.label} --seeds ${m.seed} --tier ${tier} --mode ${mode} --offline`)
    }
    return lines.join('\n')
  }
  const p = m.progress
  lines.push(`cd sim && python -m mythicsim progress --model ${r.label} --episodes ${p.episode} --max-pulls ${r.max_pulls ?? p.pull}`
    + ` --tier ${tier} --mode ${mode} --knowledge ${p.knowledge} --memory ${p.memory ? 'on' : 'off'} --offline`
    + (r.campaign ? ` --cache-dir ../web/public/results/${r.campaign}/recordings` : ''))
  return lines.join('\n')
}

function Reproduce() {
  const engine = usePlayback((p) => p.engine)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!engine) return null
  const m = engine.replay.meta
  const r = m.run
  const cmd = reproduceCommand(m)
  return (
    <div className="pointer-events-auto border-t border-line px-3 py-2 font-mono text-meta text-fg-faint">
      <dl>
        <div className="flex justify-between gap-4"><dt>Policy</dt><dd className="truncate text-fg-muted">{m.policy}</dd></div>
        <div className="flex justify-between gap-4"><dt>Seed</dt><dd className="num text-fg-muted">{m.seed}</dd></div>
        {r && <div className="flex justify-between gap-4"><dt>Harness</dt><dd className="num text-fg-muted">v{r.harness_version}{r.prompt_hash ? ` (${r.prompt_hash})` : ''}</dd></div>}
        <div className="flex justify-between gap-4"><dt>Sim / content</dt><dd className="num text-fg-muted">v{m.sim_version} / v{m.content_version}</dd></div>
        {r?.git_commit && <div className="flex justify-between gap-4"><dt>Commit</dt><dd className="num text-fg-muted">{r.git_commit}</dd></div>}
      </dl>
      {cmd && (
        <button onClick={() => setOpen((v) => !v)} className="mt-1 font-sans text-fg-faint transition-colors hover:text-fg">
          {open ? 'Hide' : 'Reproduce this replay'}
        </button>
      )}
      {open && cmd && (
        <div className="mt-1">
          <pre className="overflow-x-auto whitespace-pre rounded-md border border-line bg-surface-raised p-2 text-[11px] leading-4 text-fg-muted">{cmd}</pre>
          <p className="mt-1 font-sans leading-4">
            {m.progress ? 'Replays the recorded model replies (free, no API key). Without --offline it calls the model again.' : 'Bots are deterministic: same seed, same replay.'}
          </p>
          <button onClick={() => { navigator.clipboard?.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
            className="mt-1 font-sans text-fg-faint transition-colors hover:text-fg">{copied ? 'Copied' : 'Copy command'}</button>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'plain' }) {
  return (
    <div className="flex h-6 items-center justify-between">
      <dt className="text-[12px] text-fg-muted">{label}</dt>
      <dd className={`num font-mono text-[12px] ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-fg'}`}>{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Damage / healing meter
// ---------------------------------------------------------------------------
type Tab = 'damage' | 'healing'
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
    <div className="card w-[272px] pb-3">
      <div className="flex items-center justify-between px-3 pb-2 pt-2">
        <span className="label" title="Each row shows the total, then the amount per second">Meter</span>
        <div className="seg">
          {(['damage', 'healing'] as Tab[]).map((k) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className="!py-0.5 capitalize">{k}</button>
          ))}
        </div>
      </div>
      <div className="space-y-2 px-3">
        {rows.map(({ u, v }) => (
          <div key={u.info.id}>
            <div className="flex items-baseline justify-between text-[12px]">
              <span style={{ color: CLASS_COLORS[u.info.class] }}>{u.info.name}</span>
              <span className="num font-mono text-meta text-fg">
                {fmtNum(v)} <span className="inline-block w-10 text-right text-fg-faint">{fmtNum(v / sec)}</span>
              </span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: CLASS_COLORS[u.info.class] }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Callouts: boss warnings and yells (center screen)
// ---------------------------------------------------------------------------
export function RaidWarnings() {
  const h = useHud()
  if (!h) return null
  const { t, engine, s } = h
  const items: { key: number; text: string; style: 'warning' | 'yell'; age: number; dur: number }[] = []
  const over = s.ended ? s.ended.t : Infinity // only the final yell after a kill/wipe
  for (const { e, i } of engine.eventsBetween(t - 6000, t)) {
    const age = t - e.t
    if (e.type === 'emote') {
      const dur = e.style === 'yell' ? 5000 : 2500
      if (age < dur) items.push({ key: i, text: e.style === 'yell' ? e.text : e.text, style: e.style, age, dur })
    } else if (e.type === 'cast_start' && t < over && WARN_CASTS[e.ability] && s.units[e.unit]?.cast?.t0 === e.t) {
      const tgt = e.target ? s.units[e.target]?.info.name ?? '' : ''
      items.push({ key: i, text: WARN_CASTS[e.ability].replace('{target}', tgt), style: 'warning', age, dur: e.cast_ms + 10000 })
    } else if (e.type === 'cast_success' && e.ability === 'desecrate' && age < 2000) {
      items.push({ key: i, text: 'Desecrate: move out of the pools', style: 'warning', age, dur: 2000 })
    }
  }
  const shown = items.slice(-3)
  return (
    <div className="flex flex-col items-center gap-2">
      {shown.map((w) => {
        const fade = Math.max(0, Math.min(1, (w.dur - w.age) / 400))
        return (
          <div key={w.key} style={{ opacity: fade }} className="animate-[fadein_200ms_cubic-bezier(0.22,1,0.36,1)]">
            {w.style === 'yell' ? (
              <div className="flex w-max max-w-[min(560px,calc(100vw-32px))] items-start gap-2 rounded-lg bg-[rgba(17,17,19,0.85)] px-3 py-2 text-[13px] leading-5 text-fg">
                <Megaphone size={14} className="mt-0.5 shrink-0 text-fg-faint" />
                <span><span className="text-fg-muted">Oruth:</span> {w.text}</span>
              </div>
            ) : (
              <div className="flex w-max max-w-[calc(100vw-32px)] items-center gap-2 rounded-lg border border-warn/30 bg-[rgba(17,17,19,0.88)] px-3 py-2 text-[13px] font-medium leading-5 text-warn">
                <AlertTriangle size={14} className="shrink-0" />
                {w.text}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Decision log: what the agents did and WHY (their stated reason)
// ---------------------------------------------------------------------------
/** WoW's party-chat colour, for the message text. */
const PARTY_CHAT = '#aab4ff'

export function DecisionLog() {
  const h = useHud()
  const seek = usePlayback((p) => p.seek)
  const inspect = useInspector((p) => p.show)
  const hasChat = usePlayback((p) => !!p.engine?.replay.events.some((e) => e.type === 'chat'))
  const [tab, setTab] = useState<'chat' | 'decisions' | null>(null)
  if (!h) return null
  const view = tab ?? (hasChat ? 'chat' : 'decisions')
  const hasCalls = (h.engine.replay.calls?.length ?? 0) > 0
  const { t, engine, s } = h
  const rows: { key: number; t: number; who: string; unit?: string; cls: string; text: string; sub?: string; tone: 'info' | 'bad' | 'chat' }[] = []
  for (const { e, i } of engine.eventsBetween(t - (view === 'chat' ? 90000 : 40000), t)) {
    if (view === 'chat') {
      if (e.type === 'chat') {
        const u = s.units[e.unit]
        rows.push({ key: i, t: e.t, who: u?.info.name ?? e.unit, unit: e.unit, cls: u?.info.class ?? '', text: e.text, tone: 'chat' })
      }
      continue
    }
    if (e.type === 'decision') {
      const u = s.units[e.unit]
      rows.push({ key: i, t: e.t, who: u?.info.name ?? e.unit, unit: e.unit, cls: u?.info.class ?? '', text: e.action, sub: hasChat ? undefined : e.reason, tone: 'info' })
    } else if (e.type === 'death' && s.units[e.unit]?.info.kind === 'player') {
      const u = s.units[e.unit]
      rows.push({ key: i, t: e.t, who: u.info.name, unit: e.unit, cls: u.info.class, text: `died to ${engine.replay.abilities[e.ability]?.name ?? engine.replay.auras[e.ability]?.name ?? e.ability}`, tone: 'bad' })
    } else if (e.type === 'cast_success' && e.ability === 'requiem_of_bones') {
      rows.push({ key: i, t: e.t, who: 'Oruth', cls: 'boss', text: 'Requiem of Bones not interrupted', tone: 'bad' })
    }
  }
  const shown = rows.slice(window.innerHeight < 840 ? -4 : view === 'chat' ? -7 : -6).reverse()
  return (
    <div className="card w-[340px] max-w-[calc((100vw-32px)/var(--hud))] py-2">
      <div className="flex items-center justify-between px-3 pb-1">
        {hasChat ? (
          <div className="flex gap-1" role="tablist" aria-label="Log">
            {(['chat', 'decisions'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setTab(k)}
                className="rounded-md px-1.5 py-0.5 text-label text-fg-faint transition-colors hover:text-fg aria-selected:bg-white/[0.08] aria-selected:text-fg">
                {k === 'chat' ? 'Party chat' : 'Decisions'}
              </button>
            ))}
          </div>
        ) : <span className="label">Agent decisions</span>}
        {hasCalls
          ? <button onClick={() => inspect(null, t)} className="text-meta text-fg-faint transition-colors hover:text-fg">All model calls</button>
          : <span className="text-meta text-fg-faint">Click a row to rewind</span>}
      </div>
      {shown.length === 0 && <div className="px-3 py-2 text-[12px] text-fg-faint">{view === 'chat' ? 'Nobody has said anything yet' : 'Nothing yet, waiting for the pull'}</div>}
      <div className={view === 'chat' ? 'max-h-[min(200px,calc(100vh-640px))] min-h-[90px] overflow-y-auto' : ''}>
      {shown.map((r) => (
        <div key={r.key} className="group relative">
        <button
          onClick={() => seek(r.t - 2000)}
          title="Rewind to this moment"
          className="grid w-full grid-cols-[36px_1fr] gap-x-2 px-3 py-1 text-left transition-colors hover:bg-white/[0.05]"
        >
          <span className="num font-mono text-meta leading-5 text-fg-faint">{fmtTime(r.t)}</span>
          {r.tone === 'chat' ? (
            <span className="text-[12px] leading-[18px]" style={{ color: PARTY_CHAT }}>
              [<span style={{ color: CLASS_COLORS[r.cls] ?? '#ededef' }}>{r.who}</span>]: {r.text}
            </span>
          ) : (
            <span className="text-[12px] leading-5">
              <span className="font-medium" style={{ color: r.tone === 'bad' && r.cls === 'boss' ? '#f87171' : CLASS_COLORS[r.cls] ?? '#ededef' }}>{r.who}</span>{' '}
              <span className={r.tone === 'bad' ? 'text-bad' : 'text-fg'}>{r.text}</span>
              {r.sub && <span className="block text-[12px] leading-4 text-fg-faint">{r.sub}</span>}
            </span>
          )}
        </button>
        {hasCalls && r.unit && (
          <button onClick={() => inspect(r.unit, r.t)} title="See what this agent saw and replied"
            className="absolute right-2 top-1 rounded-md bg-surface-raised px-1.5 py-0.5 text-meta text-fg-faint opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100">
            Why?
          </button>
        )}
        </div>
      ))}
      </div>
    </div>
  )
}
