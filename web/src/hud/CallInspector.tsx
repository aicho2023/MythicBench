import { Copy, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { CLASS_COLORS, fmtNum, fmtTime } from '../content/display'
import { usePlayback } from '../replay/store'
import type { ModelCall } from '../replay/types'

/** Which call the inspector shows: the agent's latest call at or before `t`. */
export const useInspector = create<{ open: boolean; agent: string | null; t: number | null; show: (agent?: string | null, t?: number | null) => void; close: () => void }>((set) => ({
  open: false, agent: null, t: null,
  show: (agent = null, t = null) => set({ open: true, agent, t }),
  close: () => set({ open: false }),
}))

/** The call that set an agent's orders at time t: its latest call at or before t. */
export function callAt(calls: ModelCall[], agent: string | null, t: number): number {
  let best = -1
  calls.forEach((c, i) => { if ((!agent || c.agent === agent) && c.t <= t) best = i })
  return best >= 0 ? best : calls.findIndex((c) => !agent || c.agent === agent)
}

function pretty(text: string | undefined) {
  if (!text) return ''
  const m = text.match(/\{[\s\S]*\}/)
  try {
    if (!m) return text
    // Keep short arrays ([ability, target], [x, z]) on one line.
    return JSON.stringify(JSON.parse(m[0]), null, 1).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner: string) => `[${inner.replace(/\s*\n\s*/g, ' ')}]`)
  } catch { return text }
}

function Block({ title, children, mono = true }: { title: string; children: string; mono?: boolean }) {
  return (
    <section className="mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-label text-fg-faint">{title}</h3>
        <button onClick={() => navigator.clipboard?.writeText(children)} className="icon-btn !h-6 !w-6" title="Copy"><Copy size={12} /></button>
      </div>
      <pre className={`mt-1 max-h-[340px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-raised p-3 text-[12px] leading-[18px] text-fg-muted ${mono ? 'font-mono' : 'font-sans'}`}>{children}</pre>
    </section>
  )
}

/**
 * Every model call of a pull: what the agent saw (the exact prompt), why it was
 * asked, what it replied, and its reasoning summary. For auditing decisions.
 */
export function CallInspector() {
  const { open, agent: wantAgent, t: wantT, close } = useInspector()
  const engine = usePlayback((p) => p.engine)
  const seek = usePlayback((p) => p.seek)
  const calls = useMemo(() => engine?.replay.calls ?? [], [engine])
  const units = engine?.replay.units ?? []
  const names: Record<string, { name: string; cls: string }> = Object.fromEntries(units.map((u) => [u.id, { name: u.name, cls: u.class }]))
  const agents = useMemo(() => [...new Set(calls.map((c) => c.agent))], [calls])
  const [agent, setAgent] = useState<string | null>(null)
  const [sel, setSel] = useState(-1)
  const [rules, setRules] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    // Keep the selected call in view (set scrollTop: scrollIntoView would also scroll the viewer behind).
    const ol = listRef.current
    const el = ol?.querySelector<HTMLElement>('[aria-current="true"]')
    if (ol && el && (el.offsetTop < ol.scrollTop || el.offsetTop > ol.scrollTop + ol.clientHeight - 40)) {
      ol.scrollTop = el.offsetTop - ol.clientHeight / 2
    }
  }, [sel, agent, open])

  useEffect(() => {
    if (!open) return
    const a = wantAgent && agents.includes(wantAgent) ? wantAgent : null
    setAgent(a)
    setSel(callAt(calls, a, wantT ?? usePlayback.getState().t))
    setRules(false)
  }, [open, wantAgent, wantT, calls, agents])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open || !engine) return null
  const list = calls.map((c, i) => ({ c, i })).filter(({ c }) => !agent || c.agent === agent)
  const c = calls[sel]
  const who = (id: string) => names[id]?.name ?? id
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex justify-end bg-black/50" onClick={close}>
      <aside className="flex h-full w-[920px] max-w-full animate-[slidein_300ms_cubic-bezier(0.22,1,0.36,1)] flex-col border-l border-line bg-surface"
        onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-line px-5 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-fg">Model calls <span className="text-fg-faint">({calls.length})</span></span>
            <button onClick={close} className="icon-btn -mr-2" title="Close (Esc)"><X size={16} /></button>
          </div>
          {calls.length > 0 && (
            <div className="seg mt-3" role="group" aria-label="Agent">
              <button aria-pressed={agent === null} onClick={() => setAgent(null)}>Everyone</button>
              {agents.map((a) => (
                <button key={a} aria-pressed={agent === a} onClick={() => { setAgent(a); setSel(callAt(calls, a, c?.t ?? 0)) }}>
                  <span style={{ color: CLASS_COLORS[names[a]?.cls] }}>{who(a)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {calls.length === 0 ? (
          <p className="px-5 py-4 text-[13px] leading-5 text-fg-muted">
            This replay has no recorded model calls. Runs from harness 0.9 on keep every call with the replay.
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,30%)_minmax(0,1fr)] sm:grid-cols-[260px_1fr] sm:grid-rows-1">
            <ol ref={listRef} className="relative overflow-y-auto border-b border-line py-2 sm:border-b-0 sm:border-r">
              {list.map(({ c: x, i }) => (
                <li key={i}>
                  <button onClick={() => setSel(i)} aria-current={i === sel}
                    className="grid w-full grid-cols-[44px_1fr] gap-x-2 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.05] aria-[current=true]:bg-white/[0.08]">
                    <span className="num font-mono text-meta leading-5 text-fg-faint">{fmtTime(x.t)}</span>
                    <span className="min-w-0 text-[12px] leading-5">
                      <span className="font-medium" style={{ color: CLASS_COLORS[names[x.agent]?.cls] }}>{who(x.agent)}</span>
                      {(x.error || x.refused || x.problems?.length) && <span className="ml-1 text-bad">!</span>}
                      <span className="block truncate text-fg-faint">{x.why.join('; ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="min-w-0 overflow-y-auto px-4 pb-6 pt-3 sm:px-5">
              {c && (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[14px] text-fg">
                      <span className="font-medium" style={{ color: CLASS_COLORS[names[c.agent]?.cls] }}>{who(c.agent)}</span>
                      <span className="text-fg-muted"> at {fmtTime(c.t)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="num font-mono text-meta text-fg-faint">
                        {fmtNum(c.input_tokens ?? 0)} in{c.cache_read_tokens ? ` (${fmtNum(c.cache_read_tokens)} cached)` : ''} / {fmtNum(c.output_tokens ?? 0)} out
                      </span>
                      <button onClick={() => { seek(c.t); close() }} className="rounded-md border border-line px-2 py-1 text-meta text-fg-muted transition-colors hover:text-fg">Watch this moment</button>
                    </div>
                  </div>
                  <p className="mt-2 text-[13px] leading-5 text-fg-muted"><span className="text-fg-faint">Asked because: </span>{c.why.join('; ')}</p>
                  {(c.error || c.refused || c.truncated || c.problems?.length) && (
                    <p className="mt-2 text-[13px] leading-5 text-bad">
                      {c.error ?? (c.refused ? 'The provider refused to answer; the character kept its orders.' : '')}
                      {c.truncated ? ' The reply was cut off at the output limit.' : ''}
                      {c.problems?.length ? ` Dropped: ${c.problems.join('; ')}` : ''}
                    </p>
                  )}
                  {c.reply !== undefined && <Block title="Reply">{pretty(c.reply)}</Block>}
                  {c.thinking && <Block title="Reasoning summary (from the provider)" mono={false}>{c.thinking}</Block>}
                  <Block title="What it saw (the prompt)">{c.prompt}</Block>
                  <button onClick={() => setRules((v) => !v)} className="mt-4 text-meta text-fg-faint transition-colors hover:text-fg">
                    {rules ? 'Hide' : 'Show'} {who(c.agent)}'s rules and notes (system prompt)
                  </button>
                  {rules && <Block title="Rules and notes">{engine.replay.agents?.[c.agent]?.system ?? '(not recorded)'}</Block>}
                </>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
