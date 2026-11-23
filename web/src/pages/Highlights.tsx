import { ArrowRight, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CLASS_COLORS, modelName } from '../content/display'
import { HIGHLIGHTS, KIND_LABEL, highlightPath, type Highlight, type HighlightKind, type Quote } from '../content/highlights'
import { Page } from '../site/Layout'
import { SERIES } from '../site/results'
import { Link } from '../site/router'

/** The five characters, for quotes: portrait and class color. */
const CHAR: Record<string, { id: string; cls: string; role: string }> = {
  Rook: { id: 'rook', cls: 'guardian', role: 'tank' },
  Ivy: { id: 'ivy', cls: 'lightweaver', role: 'healer' },
  Brask: { id: 'brask', cls: 'berserker', role: 'melee' },
  Kit: { id: 'kit', cls: 'shadowblade', role: 'melee' },
  Wren: { id: 'wren', cls: 'ranger', role: 'ranged' },
}

const KIND_COLOR: Record<HighlightKind, string> = {
  eureka: '#e6d3a3', argument: '#f0a35e', clutch: '#7dd3fc', teamwork: '#4ade80',
  blunder: '#f87171', funny: '#f0abfc', reasoning: '#a5b4fc', record: '#fbbf24',
}

// Fixed colors per model, matching the leaderboard (protocol order).
const MODEL_ORDER = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'gpt-6-luna', 'gpt-6.2-sol']
const modelInk = (m: string) => SERIES[Math.max(0, MODEL_ORDER.indexOf(m)) % SERIES.length]

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function KindTag({ kind }: { kind: HighlightKind }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: KIND_COLOR[kind] }}>
      <span className="h-1.5 w-1.5 rotate-45 rounded-[1px]" style={{ background: KIND_COLOR[kind] }} aria-hidden />
      {KIND_LABEL[kind]}
    </span>
  )
}

function Where({ h }: { h: Highlight }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
      <span className="flex items-center gap-1.5 text-fg">
        <span className="h-2 w-2 rounded-full" style={{ background: modelInk(h.model) }} aria-hidden />{modelName(h.model)}
      </span>
      <span className="text-fg-faint">
        group {h.episode + 1}, pull {h.pull}{h.memory === false ? ', memory off' : ''}{h.tier === 'normal' ? ', Normal' : ''}
      </span>
    </span>
  )
}

function QuoteLine({ q }: { q: Quote }) {
  const c = CHAR[q.who]
  const color = c ? CLASS_COLORS[c.cls] : '#ededef'
  return (
    <li className="grid grid-cols-[28px_1fr] gap-3">
      {c
        ? <img src={`${import.meta.env.BASE_URL}portraits/${c.id}.png`} alt="" width={28} height={28} className="h-7 w-7 rounded-md" style={{ background: `${color}1f` }} />
        : <span className="h-7 w-7 rounded-md bg-surface-raised" />}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
          <span className="font-medium" style={{ color }}>{q.who}</span>
          <span className="text-fg-faint">{q.where}{q.t != null ? ` · ${clock(q.t)}` : ''}</span>
        </div>
        <p className={`mt-0.5 text-[15px] leading-6 text-[#d4d4d8] ${q.where === 'thinking' ? 'italic' : ''}`}>“{q.text}”</p>
      </div>
    </li>
  )
}

export function HighlightCard({ h, compact = false }: { h: Highlight; compact?: boolean }) {
  const to = highlightPath(h)
  if (compact) {
    const q = h.quotes[0]
    return (
      <Link to={to} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-white/20">
        {h.image && (
          <span className="relative block aspect-[16/8] overflow-hidden border-b border-line bg-[#0d0a18]">
            <img src={`${import.meta.env.BASE_URL}${h.image}`} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          </span>
        )}
        <span className="flex flex-1 flex-col p-5">
        <KindTag kind={h.kind} />
        <h3 className="mt-2 text-[17px] font-medium leading-6 text-fg">{h.title}</h3>
        <div className="mt-1"><Where h={h} /></div>
        {q
          ? <p className="mt-3 line-clamp-3 text-[14px] leading-[22px] text-fg-muted"><span style={{ color: CHAR[q.who] ? CLASS_COLORS[CHAR[q.who].cls] : undefined }}>{q.who}:</span> “{q.text}”</p>
          : <p className="mt-3 line-clamp-3 text-[14px] leading-[22px] text-fg-muted">{h.summary}</p>}
        <span className="mt-auto flex items-center gap-1.5 pt-4 text-[13px] text-fg-muted transition-colors group-hover:text-fg">
          <Play size={13} /> Watch{h.t != null ? ` from ${clock(h.t)}` : ''}
        </span>
        </span>
      </Link>
    )
  }
  return (
    <article id={h.id} className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-surface">
      {h.image && (
        <Link to={to} className="group relative block aspect-[16/7] overflow-hidden border-b border-line bg-[#0d0a18]" aria-label={`Watch: ${h.title}`}>
          <img src={`${import.meta.env.BASE_URL}${h.image}`} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
          <span className="absolute inset-0 bg-gradient-to-t from-[rgba(10,10,12,0.7)] via-transparent to-transparent" aria-hidden />
          <span className="absolute bottom-3 left-4 grid h-10 w-10 place-items-center rounded-full bg-fg text-bg transition-transform group-hover:scale-110">
            <Play size={16} className="translate-x-[1px]" fill="currentColor" />
          </span>
        </Link>
      )}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <KindTag kind={h.kind} />
          {h.stat && <span className="font-mono text-[13px] text-fg">{h.stat}</span>}
        </div>
        <h2 className="mt-2 text-[22px] font-medium leading-7 text-fg">{h.title}</h2>
        <div className="mt-1.5"><Where h={h} /></div>
        <p className="mt-4 text-[15px] leading-[26px] text-fg-muted">{h.summary}</p>
        {h.quotes.length > 0 && <ul className="mt-5 space-y-4 border-l-2 border-line pl-4">{h.quotes.map((q, i) => <QuoteLine key={i} q={q} />)}</ul>}
        <Link to={to} className="btn mt-6 h-10 px-4 text-[14px]">
          <Play size={14} /> Watch{h.t != null ? ` from ${clock(h.t)}` : ' the pull'} <ArrowRight size={14} className="text-fg-muted" />
        </Link>
      </div>
    </article>
  )
}

/** /highlights: the moments worth seeing, for people who won't sit through whole replays. */
export function Highlights() {
  const kinds = useMemo(() => [...new Set(HIGHLIGHTS.map((h) => h.kind))], [])
  const models = useMemo(() => MODEL_ORDER.filter((m) => HIGHLIGHTS.some((h) => h.model === m)), [])
  const [kind, setKind] = useState<HighlightKind | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const shown = HIGHLIGHTS.filter((h) => (!kind || h.kind === kind) && (!model || h.model === model))
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-[13px] transition-colors ${on ? 'border-white/30 bg-surface-raised text-fg' : 'border-line text-fg-muted hover:text-fg'}`
  return (
    <Page>
      <div className="mx-auto max-w-[860px] py-12 md:py-16">
        <header>
          <h1 className="text-[32px] font-normal leading-[1.12] text-fg sm:text-[40px]">Highlights</h1>
          <p className="mt-4 max-w-[640px] text-[17px] leading-7 text-fg-muted">
            The moments worth seeing from 420 pulls: breakthroughs, arguments, clutch saves and spectacular wipes.
            Each one opens in the <Link to="/watch" className="text-fg underline decoration-accent/50 underline-offset-4 hover:decoration-accent">replay viewer</Link> at the moment it happens.
          </p>
        </header>

        <div className="mt-8 flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
          <button className={chip(!kind)} aria-pressed={!kind} onClick={() => setKind(null)}>All</button>
          {kinds.map((k) => (
            <button key={k} className={chip(kind === k)} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Filter by model">
          {models.map((m) => (
            <button key={m} className={`${chip(model === m)} flex items-center gap-2`} aria-pressed={model === m} onClick={() => setModel(model === m ? null : m)}>
              <span className="h-2 w-2 rounded-full" style={{ background: modelInk(m) }} aria-hidden />{modelName(m)}
            </button>
          ))}
        </div>

        <div className="mt-10 space-y-6">
          {shown.map((h) => <HighlightCard key={h.id} h={h} />)}
          {!shown.length && <p className="text-[14px] text-fg-faint">Nothing matches both filters.</p>}
        </div>
      </div>
    </Page>
  )
}
