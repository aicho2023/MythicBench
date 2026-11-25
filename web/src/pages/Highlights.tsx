import { ArrowRight, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CLASS_COLORS, fmtTime, modelName } from '../content/display'
import { HIGHLIGHTS, KIND_LABEL, highlightPath, type Highlight, type HighlightKind, type Quote } from '../content/highlights'
import { Page } from '../site/Layout'
import { modelColor } from '../site/results'
import { useResults } from '../site/useResults'
import { Link } from '../site/router'
import { COLOR } from '../site/tokens'

/** The five characters, for quotes: portrait and class color. */
const CHAR: Record<string, { id: string; cls: string; role: string }> = {
  Rook: { id: 'rook', cls: 'guardian', role: 'tank' },
  Ivy: { id: 'ivy', cls: 'lightweaver', role: 'healer' },
  Brask: { id: 'brask', cls: 'berserker', role: 'melee' },
  Kit: { id: 'kit', cls: 'shadowblade', role: 'melee' },
  Wren: { id: 'wren', cls: 'ranger', role: 'ranged' },
}

/** A model's colour, the same as on the leaderboard and charts (by protocol order); grey until the results load. */
function useModelInk(): (model: string) => string {
  const { results } = useResults()
  return (m) => (results ? modelColor(results, m) : COLOR.fgFaint)
}

/** The moment's kind as quiet text: colour on these cards belongs to the model. */
function KindTag({ kind }: { kind: HighlightKind }) {
  return <span className="block text-[12px] text-fg-muted">{KIND_LABEL[kind]}</span>
}

/** Groups 1 to 6 are the ranked ones; a few models played extra groups for the memory test, which aren't on the leaderboard. */
const RANKED_GROUPS = 6
export const isRankedGroup = (h: Highlight) => h.episode < RANKED_GROUPS && h.memory !== false && h.tier !== 'normal'
function groupLabel(h: Highlight): string {
  return h.episode < RANKED_GROUPS ? `group ${h.episode + 1}` : `memory test group ${h.episode - RANKED_GROUPS + 1}`
}

function Where({ h }: { h: Highlight }) {
  const modelInk = useModelInk()
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
      <span className="flex items-center gap-1.5 text-fg">
        <span className="h-2 w-2 rounded-full" style={{ background: modelInk(h.model) }} aria-hidden />{modelName(h.model)}
      </span>
      <span className="text-fg-faint">
        {groupLabel(h)}, pull {h.pull}{h.memory === false ? ', memory off' : ''}{h.tier === 'normal' ? ', Normal' : ''}
      </span>
    </span>
  )
}

function QuoteLine({ q }: { q: Quote }) {
  const c = CHAR[q.who]
  const color = c ? CLASS_COLORS[c.cls] : COLOR.fg
  return (
    <li className="grid grid-cols-[28px_1fr] gap-3">
      {c
        ? <img src={`${import.meta.env.BASE_URL}portraits/${c.id}.png`} alt="" width={28} height={28} className="h-7 w-7 rounded-md" style={{ background: `${color}1f` }} />
        : <span className="h-7 w-7 rounded-md bg-surface-raised" />}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
          <span className="font-medium" style={{ color }}>{q.who}</span>
          <span className="text-fg-faint">{q.where}{q.t != null && <span className="ml-2">{fmtTime(q.t * 1000)}</span>}</span>
        </div>
        <p className={`mt-0.5 text-[15px] leading-6 text-fg ${q.where === 'thinking' ? 'italic' : ''}`}>“{q.text}”</p>
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
          <span className="relative block aspect-[16/8] overflow-hidden border-b border-line bg-scene">
            <img src={`${import.meta.env.BASE_URL}${h.image}`} alt="" loading="lazy" className="h-full w-full object-cover" />
          </span>
        )}
        <span className="flex flex-1 flex-col p-5">
        <KindTag kind={h.kind} />
        <h3 className="mt-1.5 text-[17px] font-medium leading-6 text-fg">{h.title}</h3>
        <div className="mt-1"><Where h={h} /></div>
        {q
          ? <p className="mt-3 text-[14px] leading-[22px] text-fg-muted"><span style={{ color: CHAR[q.who] ? CLASS_COLORS[CHAR[q.who].cls] : undefined }}>{q.who}:</span> “{q.text}”</p>
          : <p className="mt-3 text-[14px] leading-[22px] text-fg-muted">{h.summary}</p>}
        <span className="mt-auto flex items-center gap-1.5 pt-4 text-[13px] text-fg-muted transition-colors group-hover:text-fg">
          <Play size={13} /> Watch{h.t != null ? ` from ${fmtTime(h.t * 1000)}` : ''}
        </span>
        </span>
      </Link>
    )
  }
  return <FullCard h={h} to={to} />
}

/** A card in the highlights grid: the whole story, every quote shown. */
function FullCard({ h, to }: { h: Highlight; to: string }) {
  return (
    <article id={h.id} className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-surface">
      {h.image && (
        <Link to={to} className="group relative block aspect-[16/8] overflow-hidden border-b border-line bg-scene" aria-label={`Watch: ${h.title}`}>
          <img src={`${import.meta.env.BASE_URL}${h.image}`} alt="" loading="lazy" className="h-full w-full object-cover" />
          <span className="absolute inset-0 bg-gradient-to-t from-[rgba(10,10,12,0.7)] via-transparent to-transparent" aria-hidden />
          <span className="absolute bottom-3 left-4 grid h-10 w-10 place-items-center rounded-full bg-fg text-bg transition-colors group-hover:bg-white">
            <Play size={16} className="translate-x-[1px]" fill="currentColor" />
          </span>
        </Link>
      )}
      <div className="p-5 sm:p-6">
        <KindTag kind={h.kind} />
        <h2 className="mt-1.5 text-[17px] font-medium leading-6 text-fg sm:text-[20px] sm:leading-7">{h.title}</h2>
        <div className="mt-1.5"><Where h={h} /></div>
        <p className="mt-4 text-[15px] leading-[26px] text-fg-muted">{h.summary}</p>
        {h.quotes.length > 0 && <ul className="mt-5 space-y-4 border-l-2 border-line pl-4">{h.quotes.map((q, i) => <QuoteLine key={i} q={q} />)}</ul>}
        <div className="mt-6">
          <Link to={to} className="btn h-10 px-4 text-[14px]">
            <Play size={14} /> Watch{h.t != null ? ` from ${fmtTime(h.t * 1000)}` : ' the pull'} <ArrowRight size={14} className="text-fg-muted" />
          </Link>
        </div>
      </div>
    </article>
  )
}

/** /highlights: the moments worth seeing, for people who won't sit through whole replays. */
export function Highlights() {
  const kinds = useMemo(() => [...new Set(HIGHLIGHTS.map((h) => h.kind))], [])
  const modelInk = useModelInk()
  const { results } = useResults()
  // In protocol order once the results load (the order of the leaderboard's colours).
  const models = useMemo(() => {
    const seen = [...new Set(HIGHLIGHTS.map((h) => h.model))]
    const order = results?.protocol.models ?? []
    return seen.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  }, [results])
  const [kind, setKind] = useState<HighlightKind | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const shown = HIGHLIGHTS.filter((h) => (!kind || h.kind === kind) && (!model || h.model === model))
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-[13px] transition-colors ${on ? 'border-white/30 bg-surface-raised text-fg' : 'border-line text-fg-muted hover:text-fg'}`
  return (
    <Page>
      <div className="mx-auto max-w-[1120px] py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">Highlights</h1>
        </header>

        <div className="mt-8 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by kind">
          <span className="w-14 text-[12px] text-fg-faint">Kind</span>
          <button className={chip(!kind)} aria-pressed={!kind} onClick={() => setKind(null)}>All</button>
          {kinds.map((k) => (
            <button key={k} className={chip(kind === k)} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by model">
          <span className="w-14 text-[12px] text-fg-faint">Model</span>
          {models.map((m) => (
            <button key={m} className={`${chip(model === m)} flex items-center gap-2`} aria-pressed={model === m} onClick={() => setModel(model === m ? null : m)}>
              <span className="h-2 w-2 rounded-full" style={{ background: modelInk(m) }} aria-hidden />{modelName(m)}
            </button>
          ))}
        </div>

        <div className="mt-10 grid items-start gap-6 md:grid-cols-2">
          {shown.map((h) => <HighlightCard key={h.id} h={h} />)}
          {!shown.length && <p className="text-[14px] text-fg-faint">Nothing matches both filters.</p>}
        </div>
      </div>
    </Page>
  )
}
