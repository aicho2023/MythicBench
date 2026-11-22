import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fmtTime, modelName } from '../content/display'
import { runItemId, usePlayback } from '../replay/store'
import type { CatalogItem, CatalogRun, ReplayIndexEntry } from '../replay/types'
import { SHOW_REFERENCE_RUNS } from '../site/config'

type Sort = 'newest' | 'best'

const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', mock: 'Mock' }

function when(iso: string) {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function tierName(r: CatalogRun) {
  return r.tier ? (r.tier === 'plus10' ? '+10' : 'Normal') : `+${r.level ?? 12} (old)`
}

/** One plain sentence about how the run was set up. */
function setup(r: CatalogRun) {
  const prog = r.mode === 'progression'
  const parts = [tierName(r)]
  if (r.dungeon_mode !== 'dungeon') parts.push('boss fight only')
  if (prog) {
    parts.push(r.knowledge === 'full' ? 'full boss guide' : 'blind')
    parts.push(`up to ${r.max_pulls ?? '?'} pulls`)
    if (r.memory === false) parts.push('memory off')
  } else parts.push(`${r.items.length} ${r.items.length === 1 ? 'fight' : 'fights'}`)
  return parts.join(', ')
}

function outcome(r: CatalogRun) {
  if (r.mode === 'progression') {
    const eps = [...new Set(r.items.map((i) => i.episode ?? 0))]
    // A clear is a timed clear (a kill after the timer is a depleted key).
    const cleared = eps.filter((e) => r.items.some((i) => i.episode === e && i.outcome === 'victory' && i.in_time !== false)).length
    return { text: cleared ? `Cleared ${cleared} of ${eps.length}` : eps.length === 1 ? 'Not cleared' : `None of ${eps.length} cleared`, good: cleared > 0 }
  }
  const wins = r.items.filter((i) => i.outcome === 'victory').length
  return { text: `${wins} of ${r.items.length} won`, good: wins > 0 }
}

/**
 * Side drawer listing every run saved on this machine (catalog.json), plus the
 * scripted bots as a reference. Built for hundreds of runs: search, filters,
 * sorting, and per-pull chips.
 */
export function RunBrowser({ onClose, initialQuery = '' }: { onClose: () => void; initialQuery?: string }) {
  const catalog = usePlayback((p) => p.catalog)
  const index = usePlayback((p) => p.index)
  const current = usePlayback((p) => p.currentId)
  const load = usePlayback((p) => p.load)
  const [q, setQ] = useState(initialQuery)
  const [provider, setProvider] = useState('any')
  // Older-harness runs are hidden by default, unless they're all there is.
  const [showOld, setShowOld] = useState(() => !(catalog?.runs ?? []).some((r) => r.harness_version === catalog?.current_harness_version))
  const [sort, setSort] = useState<Sort>('newest')
  const currentRun = current?.split('/')[0] // item ids are <run_id>/<seed-N or eE-pP>
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentRun ? [currentRun] : []))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const runs = catalog?.runs ?? []
  const currentHarness = catalog?.current_harness_version
  const providers = useMemo(() => ['any', ...new Set(runs.map((r) => r.provider))], [runs])
  const oldCount = runs.filter((r) => r.harness_version !== currentHarness).length
  const shown = useMemo(() => {
    // Every word must match somewhere (model, name, tags, run id): "sonnet leaderboard".
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/^#/, ''))
    let out = runs.filter((r) => {
      const hay = [r.run_id, r.label, modelName(r.model), r.name ?? '', ...r.tags].join(' ').toLowerCase()
      return (provider === 'any' || r.provider === provider)
        && (showOld || r.harness_version === currentHarness)
        && words.every((w) => hay.includes(w))
    })
    if (sort === 'best') out = [...out].sort((a, b) => (b.summary.score_mean ?? -1) - (a.summary.score_mean ?? -1))
    return out
  }, [runs, q, provider, showOld, sort, currentHarness])
  // The scripted bots are a reference for local work, not shown to visitors.
  const bots = SHOW_REFERENCE_RUNS ? index.filter((r) => !r.local && !r.id.startsWith('featured:')) : []

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex justify-end bg-black/50" onClick={onClose}>
      <aside className="flex h-full w-[480px] max-w-full animate-[slidein_300ms_cubic-bezier(0.22,1,0.36,1)] flex-col border-l border-line bg-surface"
        onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-line px-5 pb-4 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-fg">Runs</span>
            <button onClick={onClose} className="icon-btn -mr-2" title="Close (Esc)"><X size={16} /></button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 focus-within:border-white/20">
            <Search size={16} className="shrink-0 text-fg-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models, names, tags" aria-label="Search model, name, tag or run id"
              className="h-9 w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:outline-none" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {providers.length > 2 && (
              <div className="seg" role="group" aria-label="Provider">
                {providers.map((p) => (
                  <button key={p} aria-pressed={provider === p} onClick={() => setProvider(p)}>
                    {p === 'any' ? 'All' : PROVIDER_NAMES[p] ?? p}
                  </button>
                ))}
              </div>
            )}
            <div className="seg" role="group" aria-label="Sort">
              <button aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}>Newest</button>
              <button aria-pressed={sort === 'best'} onClick={() => setSort('best')}>Best score</button>
            </div>
            {oldCount > 0 && (
              <div className="seg" role="group" aria-label="Older versions">
                <button aria-pressed={showOld} onClick={() => setShowOld((v) => !v)}
                  title="Runs played on an older version of the harness. Their scores aren't directly comparable.">
                  Older versions ({oldCount})
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {runs.length === 0 && (
            <p className="px-2 py-4 text-[13px] leading-5 text-fg-muted">
              No model runs yet. Play some with <code className="font-mono text-fg">python -m mythicsim progress --model …</code> and they show up here.
            </p>
          )}
          {runs.length > 0 && shown.length === 0 && (
            <p className="px-2 py-4 text-[13px] leading-5 text-fg-faint">
              No runs match.{!showOld && oldCount > 0 ? ' Older versions are hidden.' : ''}
            </p>
          )}
          {shown.map((r) => {
            const isOpen = open.has(r.run_id)
            const prog = r.mode === 'progression'
            const episodes = prog ? [...new Set(r.items.map((i) => i.episode ?? 0))] : []
            const res = outcome(r)
            const stale = r.harness_version !== currentHarness
            return (
              <div key={r.run_id} className={`mb-1 rounded-lg border transition-colors ${currentRun === r.run_id ? 'border-white/15 bg-surface-raised' : 'border-transparent hover:bg-white/[0.03]'}`}>
                <button onClick={() => toggle(r.run_id)} aria-expanded={isOpen} className="flex w-full items-start gap-2 rounded-lg px-3 py-3 text-left">
                  <span className="mt-0.5 text-fg-faint">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[14px] font-medium leading-5 text-fg">{modelName(r.model)}</span>
                      {r.effort && <span className="shrink-0 text-[12px] text-fg-faint">{r.effort === 'none' ? 'thinking off' : `${r.effort} effort`}</span>}
                    </span>
                    <span className="mt-1 block text-[13px] leading-5 text-fg-muted">{setup(r)}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] leading-5 text-fg-faint">
                      <span>{when(r.created)}</span>
                      {r.summary.cost_usd != null && (
                        <span title="What this run costs to play from scratch at list prices (replaying the recording is free)">{usd(r.summary.cost_usd)}</span>
                      )}
                      {stale && (
                        <span className="text-warn" title={`Played on harness ${r.harness_version}; current is ${currentHarness}. Not directly comparable.`}>
                          older version
                        </span>
                      )}
                      {r.status === 'stopped' && <span className="text-warn" title={r.note ?? undefined}>stopped at budget</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block font-mono text-[18px] leading-6 text-fg">{r.summary.score_mean?.toFixed(1) ?? '–'}</span>
                    <span className={`block text-[12px] leading-5 ${res.good ? 'text-good' : 'text-fg-faint'}`}>{res.text}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pl-9">
                    {prog ? episodes.map((e) => {
                      const pulls = r.items.filter((i) => i.episode === e).sort((a, b) => (a.pull ?? 0) - (b.pull ?? 0))
                      return (
                        <div key={e} className="mb-2 flex items-center gap-2">
                          <span className="w-16 shrink-0 text-[12px] text-fg-faint" title="A fresh party with up to five pulls, learning between them">Group {e + 1}</span>
                          <div className="flex flex-wrap gap-1">
                            {pulls.map((it) => <ItemChip key={it.pull} run={r} it={it} current={current} load={load} />)}
                          </div>
                        </div>
                      )
                    }) : (
                      <div className="flex flex-wrap gap-1">
                        {r.items.map((it) => <ItemChip key={it.seed} run={r} it={it} current={current} load={load} />)}
                      </div>
                    )}
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] leading-5">
                      {r.name && <><dt className="text-fg-faint">Name</dt><dd className="text-fg-muted">{r.name}</dd></>}
                      {prog && r.summary.curve_mean && <><dt className="text-fg-faint">Score by pull</dt><dd className="num font-mono text-fg-muted">{r.summary.curve_mean.join(', ')}</dd></>}
                      {r.summary.usd_per_fight != null && <><dt className="text-fg-faint">Cost per {prog ? 'pull' : 'fight'}</dt><dd className="text-fg-muted">{usd(r.summary.usd_per_fight)}</dd></>}
                      {r.summary.reference_means && (
                        <><dt className="text-fg-faint">Bots, same seeds</dt><dd className="text-fg-muted">expert {r.summary.reference_means.expert}, competent {r.summary.reference_means.competent}</dd></>
                      )}
                      {r.tags.length > 0 && <><dt className="text-fg-faint">Tags</dt><dd className="text-fg-muted">{r.tags.join(', ')}</dd></>}
                      <dt className="text-fg-faint">Run id</dt><dd className="truncate font-mono text-fg-faint">{r.run_id}</dd>
                    </dl>
                  </div>
                )}
              </div>
            )
          })}

          {bots.length > 0 && (
            <section className="mt-4 border-t border-line px-2 pt-4">
              <h3 className="text-[13px] font-medium text-fg">Reference: scripted bots</h3>
              <p className="mt-1 text-[12px] leading-5 text-fg-faint">Hand-written players at three skill levels, on the same dungeon. They show what good and bad play look like.</p>
              <div className="mt-2">
                {bots.map((b) => <BotRow key={b.id} b={b} current={current} load={load} />)}
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}

function BotRow({ b, current, load }: { b: ReplayIndexEntry; current: string | null; load: (id: string) => void }) {
  const win = b.outcome === 'victory'
  return (
    <button onClick={() => load(b.id)} title={b.blurb}
      className={`flex w-full items-baseline justify-between rounded-md px-2 py-2 text-left transition-colors ${current === b.id ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}>
      <span className="text-[13px] text-fg">{b.label}</span>
      <span className={`text-[12px] ${win ? 'text-good' : 'text-fg-faint'}`}>
        {win ? 'Cleared' : 'Wiped'} at {fmtTime(b.duration_s * 1000)}{b.score != null ? `, ${b.score.toFixed(1)}` : ''}
      </span>
    </button>
  )
}

function ItemChip({ run, it, current, load }: { run: CatalogRun; it: CatalogItem; current: string | null; load: (id: string) => void }) {
  const id = runItemId(run.run_id, it)
  const win = it.outcome === 'victory'
  const head = it.pull !== undefined ? `Pull ${it.pull}` : `Seed ${it.seed}`
  return (
    <button onClick={() => load(id)}
      title={`${head} (seed ${it.seed}): ${win ? 'cleared' : 'wiped'} at ${fmtTime(it.duration_s * 1000)}, score ${it.score}`}
      className={`w-16 rounded-md border px-2 py-1 text-left transition-colors ${current === id ? 'border-fg/50 bg-white/[0.1]' : 'border-line hover:bg-white/[0.06]'}`}>
      <span className="block text-[11px] leading-4 text-fg-faint">{head}</span>
      <span className={`num block font-mono text-[13px] ${win ? 'text-good' : 'text-bad'}`}>{it.score.toFixed(1)}</span>
    </button>
  )
}

function usd(x: number): string {
  return '$' + (x < 0.1 ? x.toFixed(3) : x.toFixed(2))
}
