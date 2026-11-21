import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fmtTime } from '../content/display'
import { runItemId, usePlayback } from '../replay/store'
import type { CatalogItem, CatalogRun } from '../replay/types'

type Sort = 'newest' | 'best' | 'model'

const EFFORTS = ['any', 'default', 'none', 'low', 'medium', 'high'] as const

function title(r: CatalogRun) {
  const model = `${r.model}${r.effort ? `@${r.effort}` : ''}`
  return r.name ? { main: r.name, sub: model } : { main: model, sub: null }
}

function when(iso: string) {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Side drawer listing every model run saved on this machine (catalog.json).
 * Built for hundreds of runs: search, filters, sorting, and per-seed chips.
 */
export function RunBrowser({ onClose }: { onClose: () => void }) {
  const catalog = usePlayback((p) => p.catalog)
  const current = usePlayback((p) => p.currentId)
  const load = usePlayback((p) => p.load)
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState('any')
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]>('any')
  const [showLegacy, setShowLegacy] = useState(true)
  const [sort, setSort] = useState<Sort>('newest')
  const currentRun = current?.split('/')[0] // item ids are <run_id>/<seed-N or eE-pP>
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentRun ? [currentRun] : []))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const runs = catalog?.runs ?? []
  const providers = useMemo(() => ['any', ...new Set(runs.map((r) => r.provider))], [runs])
  const shown = useMemo(() => {
    // Every word must match somewhere (model, name, tags, run id): "sonnet leaderboard".
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/^#/, ''))
    let out = runs.filter((r) => {
      const hay = [r.run_id, r.label, r.name ?? '', ...r.tags].join(' ').toLowerCase()
      return (provider === 'any' || r.provider === provider)
        && (effort === 'any' || (r.effort ?? 'default') === effort)
        && (showLegacy || r.harness_version !== 'legacy')
        && words.every((w) => hay.includes(w))
    })
    if (sort === 'best') out = [...out].sort((a, b) => (b.summary.score_mean ?? -1) - (a.summary.score_mean ?? -1))
    if (sort === 'model') out = [...out].sort((a, b) => a.label.localeCompare(b.label) || b.created.localeCompare(a.created))
    return out
  }, [runs, q, provider, effort, showLegacy, sort])

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
            <span className="text-[15px] font-medium text-fg">
              Model runs <span className="num ml-1 font-mono text-meta font-normal text-fg-faint">{shown.length === runs.length ? runs.length : `${shown.length} of ${runs.length}`}</span>
            </span>
            <button onClick={onClose} className="icon-btn -mr-2" title="Close (Esc)"><X size={16} /></button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 focus-within:border-white/20">
            <Search size={16} className="shrink-0 text-fg-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search model, name, tag or run id"
              title="Matches model, name, tag and run id"
              className="h-8 w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:outline-none" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="filter">
              {providers.map((p) => <option key={p} value={p}>{p === 'any' ? 'All providers' : p}</option>)}
            </select>
            <select value={effort} onChange={(e) => setEffort(e.target.value as (typeof EFFORTS)[number])} className="filter">
              {EFFORTS.map((x) => <option key={x} value={x}>{x === 'any' ? 'Any effort' : `Effort ${x}`}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="filter">
              <option value="newest">Newest first</option>
              <option value="best">Best score</option>
              <option value="model">By model</option>
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-fg-muted">
              <input type="checkbox" checked={showLegacy} onChange={(e) => setShowLegacy(e.target.checked)} className="accent-[#d4d4d8]" />
              Show legacy
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {runs.length === 0 && (
            <p className="px-2 py-6 text-[13px] leading-5 text-fg-muted">
              No model runs yet. Play some with <code className="font-mono text-fg">python -m mythicsim llm --model …</code>; each run shows up here.
            </p>
          )}
          {runs.length > 0 && shown.length === 0 && <p className="px-2 py-6 text-[13px] text-fg-faint">No runs match</p>}
          {shown.map((r) => {
            const t = title(r)
            const isOpen = open.has(r.run_id)
            const prog = r.mode === 'progression'
            const episodes = prog ? [...new Set(r.items.map((i) => i.episode ?? 0))] : []
            const wins = prog ? episodes.filter((e) => r.items.some((i) => i.episode === e && i.outcome === 'victory')).length
              : r.items.filter((i) => i.outcome === 'victory').length
            const stale = r.harness_version !== catalog?.current_harness_version
            return (
              <div key={r.run_id} className={`mb-1 rounded-lg border transition-colors ${currentRun === r.run_id ? 'border-white/15 bg-surface-raised' : 'border-transparent hover:bg-white/[0.03]'}`}>
                <button onClick={() => toggle(r.run_id)} aria-expanded={isOpen} className="flex w-full items-start gap-2 rounded-lg p-3 text-left">
                  <span className="mt-0.5 text-fg-faint">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-5 text-fg">{t.main}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-meta text-fg-faint">
                      {t.sub && <span className="text-fg-muted">{t.sub}</span>}
                      <span>{r.provider}</span>
                      <span>+{r.level ?? 12}</span>
                      <span>{when(r.created)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 font-mono text-meta text-fg-faint">
                      <span className={stale ? 'text-warn' : ''}
                        title={stale ? `Played on harness ${r.harness_version}; current is ${catalog?.current_harness_version}. Not directly comparable.` : 'Current harness'}>
                        harness {r.harness_version ?? '?'}
                      </span>
                      {prog && <span className="text-accent">learning, {r.knowledge ?? 'blind'}, memory {r.memory === false ? 'off' : 'on'}</span>}
                      {r.summary.cost_usd != null && (
                        <span className="num" title="What this run costs to play from scratch at list prices (replaying the recording is free)">
                          {usd(r.summary.cost_usd)}
                        </span>
                      )}
                      {r.status === 'stopped' && (
                        <span className="text-warn" title={r.note ?? 'Stopped at its spend budget'}>stopped at budget</span>
                      )}
                      {r.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block font-mono text-[15px] leading-5 text-fg">{r.summary.score_mean?.toFixed(1) ?? '–'}</span>
                    <span className={`num mt-1 block font-mono text-meta ${wins ? 'text-good' : 'text-fg-faint'}`}>
                      {prog ? `${wins}/${episodes.length} killed · ${r.summary.pulls_to_kill_mean ?? '–'} pulls` : `${wins}/${r.items.length} kills`}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pl-9">
                    {prog ? episodes.map((e) => {
                      const pulls = r.items.filter((i) => i.episode === e).sort((a, b) => (a.pull ?? 0) - (b.pull ?? 0))
                      return (
                        <div key={e} className="mb-2 flex items-center gap-2">
                          <span className="w-10 shrink-0 font-mono text-meta text-fg-faint">ep {e}</span>
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
                    <div className="mt-2 font-mono text-meta leading-5 text-fg-faint">
                      {r.run_id}
                      {r.summary.usd_per_fight != null && <span className="ml-2">· {usd(r.summary.usd_per_fight)} per {prog ? 'pull' : 'fight'}</span>}
                      {prog && r.summary.curve_mean && <span className="ml-2">· mean score by pull: {r.summary.curve_mean.join(' → ')}</span>}
                      {r.summary.reference_means && (
                        <span className="ml-2">· bots on these seeds: expert {r.summary.reference_means.expert}, competent {r.summary.reference_means.competent}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

function ItemChip({ run, it, current, load }: { run: CatalogRun; it: CatalogItem; current: string | null; load: (id: string) => void }) {
  const id = runItemId(run.run_id, it)
  const win = it.outcome === 'victory'
  const head = it.pull !== undefined ? `pull ${it.pull}` : `seed ${it.seed}`
  return (
    <button onClick={() => load(id)}
      title={`${head} (seed ${it.seed}): ${win ? 'kill' : 'wipe'} at ${fmtTime(it.duration_s * 1000)}, score ${it.score}`}
      className={`w-16 rounded-md border px-2 py-1 text-left transition-colors ${current === id ? 'border-fg/50 bg-white/[0.1]' : 'border-line hover:bg-white/[0.06]'}`}>
      <span className="block font-mono text-meta text-fg-faint">{head}</span>
      <span className={`num block font-mono text-[13px] ${win ? 'text-good' : 'text-bad'}`}>{it.score.toFixed(1)}</span>
    </button>
  )
}

function usd(x: number): string {
  return '$' + (x < 0.1 ? x.toFixed(3) : x.toFixed(2))
}
