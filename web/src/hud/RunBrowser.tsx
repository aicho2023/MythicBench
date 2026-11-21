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
    <div className="pointer-events-auto absolute inset-0 z-20 flex justify-end bg-black/40" onClick={onClose}>
      <aside className="flex h-full w-[460px] max-w-full animate-[slidein_0.25s_ease-out] flex-col border-l border-line bg-[#0c0c0f]"
        onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-line px-5 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <span className="label">Model runs · {shown.length === runs.length ? runs.length : `${shown.length} of ${runs.length}`}</span>
            <button onClick={onClose} className="icon-btn -mr-2" title="Close (Esc)"><X size={16} /></button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5">
            <Search size={14} className="text-fg-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model, name, tag, run id"
              className="h-8 w-full bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-faint" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px]">
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="filter">
              {providers.map((p) => <option key={p} value={p}>{p === 'any' ? 'All providers' : p}</option>)}
            </select>
            <select value={effort} onChange={(e) => setEffort(e.target.value as (typeof EFFORTS)[number])} className="filter">
              {EFFORTS.map((x) => <option key={x} value={x}>{x === 'any' ? 'Any effort' : `effort: ${x}`}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="filter">
              <option value="newest">Newest first</option>
              <option value="best">Best score</option>
              <option value="model">By model</option>
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 text-fg-muted">
              <input type="checkbox" checked={showLegacy} onChange={(e) => setShowLegacy(e.target.checked)} className="accent-[#a78bfa]" />
              legacy
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {runs.length === 0 && (
            <p className="px-2 py-6 text-[12.5px] leading-[19px] text-fg-muted">
              No model runs yet. Play some with <code className="font-mono text-fg">python -m mythicsim llm --model …</code>; each run shows up here.
            </p>
          )}
          {runs.length > 0 && shown.length === 0 && <p className="px-2 py-6 text-[12.5px] text-fg-faint">No runs match.</p>}
          {shown.map((r) => {
            const t = title(r)
            const isOpen = open.has(r.run_id)
            const prog = r.mode === 'progression'
            const episodes = prog ? [...new Set(r.items.map((i) => i.episode ?? 0))] : []
            const wins = prog ? episodes.filter((e) => r.items.some((i) => i.episode === e && i.outcome === 'victory')).length
              : r.items.filter((i) => i.outcome === 'victory').length
            const stale = r.harness_version !== catalog?.current_harness_version
            return (
              <div key={r.run_id} className={`mb-1.5 rounded-lg border ${currentRun === r.run_id ? 'border-white/20 bg-white/[0.05]' : 'border-transparent hover:bg-white/[0.03]'}`}>
                <button onClick={() => toggle(r.run_id)} className="flex w-full items-start gap-2 px-2.5 py-2 text-left">
                  <span className="mt-[3px] text-fg-faint">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-fg">{t.main}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10.5px] text-fg-faint">
                      {t.sub && <span className="text-fg-muted">{t.sub}</span>}
                      <span>{r.provider}</span>
                      <span className="text-fg-muted">+{r.level ?? 12}</span>
                      <span>{when(r.created)}</span>
                      <span className={stale ? 'rounded border border-warn/40 px-1 text-warn' : ''}
                        title={stale ? `Played on harness ${r.harness_version}; current is ${catalog?.current_harness_version}. Not directly comparable.` : 'Current harness'}>
                        harness {r.harness_version ?? '?'}
                      </span>
                      {prog && <span className="rounded border border-accent/40 px-1 text-accent">learning · {r.knowledge ?? 'blind'} · memory {r.memory === false ? 'off' : 'on'}</span>}
                      {r.summary.cost_usd != null && (
                        <span title="What this run costs to play from scratch at list prices (replaying the recording is free)">
                          {usd(r.summary.cost_usd)}
                        </span>
                      )}
                      {r.status === 'stopped' && (
                        <span className="rounded border border-warn/40 px-1 text-warn" title={r.note ?? 'Stopped at its spend budget'}>stopped at budget</span>
                      )}
                      {r.tags.map((tag) => <span key={tag} className="text-accent">#{tag}</span>)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="num block font-mono text-[15px] text-fg">{r.summary.score_mean?.toFixed(1) ?? '–'}</span>
                    <span className={`num block font-mono text-[10.5px] ${wins ? 'text-good' : 'text-fg-faint'}`}>
                      {prog ? `${wins}/${episodes.length} killed · ${r.summary.pulls_to_kill_mean ?? '–'} pulls` : `${wins}/${r.items.length} kills`}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="px-2.5 pb-2.5 pl-8">
                    {prog ? episodes.map((e) => {
                      const pulls = r.items.filter((i) => i.episode === e).sort((a, b) => (a.pull ?? 0) - (b.pull ?? 0))
                      return (
                        <div key={e} className="mb-1.5 flex items-center gap-1.5">
                          <span className="w-10 shrink-0 font-mono text-[10px] text-fg-faint">ep {e}</span>
                          <div className="flex flex-wrap gap-1">
                            {pulls.map((it) => <ItemChip key={it.pull} run={r} it={it} current={current} load={load} />)}
                          </div>
                        </div>
                      )
                    }) : (
                      <div className="flex flex-wrap gap-1.5">
                        {r.items.map((it) => <ItemChip key={it.seed} run={r} it={it} current={current} load={load} />)}
                      </div>
                    )}
                    <div className="mt-2 font-mono text-[10px] text-fg-faint">
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
      className={`rounded-md border px-2 py-1 text-left transition-colors ${current === id ? 'border-fg/60 bg-white/[0.1]' : 'border-white/10 hover:bg-white/[0.06]'}`}>
      <span className="block font-mono text-[10px] text-fg-faint">{head}{win && it.pull !== undefined ? ' ✓' : ''}</span>
      <span className={`num block font-mono text-[12px] ${win ? 'text-good' : 'text-bad'}`}>{it.score.toFixed(1)}</span>
    </button>
  )
}

function usd(x: number): string {
  return '$' + (x < 0.1 ? x.toFixed(3) : x.toFixed(2))
}
