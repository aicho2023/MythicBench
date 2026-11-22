// The analysis export, in the browser: the same files as
// `python -m mythicsim export` (sim/mythicsim/analysis.py), zipped for
// download, for one run or many. Read-only: it only reads replays.
import type { CatalogItem, CatalogRun, Replay, ReplayEvent } from '../replay/types'

type Row = Record<string, unknown>

const PULL_COLS = ['model', 'provider', 'effort', 'tier', 'role', 'memory', 'group', 'pull', 'seed', 'run_id',
  'outcome', 'in_time', 'score', 'progress_pct', 'boss_hp_left_pct', 'duration_s', 'penalty_s',
  'revives', 'deaths', 'first_death_s', 'first_death', 'pack1_cleared_s', 'pack2_cleared_s',
  'boss_pulled_s', 'boss_kicks', 'boss_kickable', 'trash_kicks', 'trash_kickable', 'pyres',
  'pyres_soaked', 'pyre_mean_inside', 'marks', 'mark_allies_hit', 'avoidable_damage', 'party_dps',
  'healing', 'chat_lines', 'calls', 'input_tokens', 'output_tokens', 'usd', 'refusals',
  'unusable_replies', 'truncated_replies', 'api_errors', 'out_of_calls']
const KEY_COLS = ['model', 'effort', 'tier', 'role', 'memory', 'group', 'pull']
const GROUP_COLS = ['model', 'provider', 'effort', 'tier', 'role', 'memory', 'group', 'run_id', 'pulls_played',
  'cleared_on', 'group_score', 'first_score', 'best_score', 'last_score', 'scores', 'usd']
const DEATH_COLS = [...KEY_COLS, 't_s', 'unit', 'player_role', 'ability', 'killer', 'last_5s']
const MECH_COLS = [...KEY_COLS, 't_s', 'mechanic', 'caster', 'ok', 'detail']
const DMG_COLS = [...KEY_COLS, 'unit', 'ability', 'amount', 'hits']
const ROLE_ORDER = ['ranked', 'paired', 'control', 'sanity', 'effort', 'baseline', 'campaign', 'run']

/** One pull to export: where it came from, and how to fetch its replay. */
export interface PullRef {
  model: string; provider: string; effort: string | null; tier: string; role: string; memory: boolean
  group: number; pull: number; run_id: string; url: string; stats: Record<string, unknown>
}

/** The pulls of the given runs. ``urlOf`` turns a run's item into its replay's URL. */
export function pullRefs(runs: CatalogRun[], urlOf: (run: CatalogRun, it: CatalogItem) => string): PullRef[] {
  return runs.flatMap((r) => r.items.map((it) => ({
    model: r.model, provider: r.provider, effort: r.effort, tier: r.tier ?? '', memory: r.memory !== false,
    // A results dataset says which part of the protocol a run is; a local run says only whether it's a campaign's.
    role: r.role ?? (r.tags.some((t) => t.startsWith('campaign')) ? 'campaign' : 'run'),
    group: it.episode ?? 0, pull: it.pull ?? 1, run_id: it.run_id ?? r.run_id, url: urlOf(r, it),
    stats: { ...(it.stats ?? {}), usd: it.usd ?? (it.stats as { usd?: number } | undefined)?.usd ?? null },
  })))
}

const roleIdx = (r: string) => (ROLE_ORDER.includes(r) ? ROLE_ORDER.indexOf(r) : 99)
const cmp = (a: unknown[], b: unknown[]) => {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as string | number
    const y = b[i] as string | number
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}
const sortKey = (r: PullRef) => [String(r.model), String(r.effort), String(r.tier), roleIdx(r.role), r.run_id, r.group, r.pull]

/**
 * Python's rounding, so these files match the command line's byte for byte:
 * ``format(x, '.Nf')`` and ``round(x, N)`` round an exact tie to even (5.25 -> 5.2),
 * where ``toFixed`` rounds it up. Anything that isn't an exact tie rounds the same.
 */
export function pyFixed(x: number, d: number): string {
  const t = Math.abs(x).toFixed(d + 30) // the binary value's exact decimal digits
  const [ip, fp = ''] = t.split('.')
  if (!/^50*$/.test(fp.slice(d))) return x.toFixed(d)
  let n = BigInt(ip + fp.slice(0, d))
  if (n % 2n === 1n) n += 1n
  const digits = n.toString().padStart(d + 1, '0')
  return (x < 0 ? '-' : '') + (d ? `${digits.slice(0, -d)}.${digits.slice(-d)}` : digits)
}
export const pyRound = (x: number, d: number) => Number(pyFixed(x, d))
/** Python's integer-percent rule here: the nearest whole percent, a half rounding up. */
const percent = (a: number, b: number) => Math.floor((200 * a + b) / (2 * b))

const sec = (ms: number | null | undefined) => (ms == null ? null : pyRound(ms / 1000, 1))
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${pyFixed((ms % 60000) / 1000, 1).padStart(4, '0')}`

interface Mech {
  t: number; mechanic: string; caster: string | null; ok: boolean; detail: string
  inside?: string[]; hit?: string[]; marked?: string | null
}

/** One replay, read once. Mirrors analysis.Pull. */
export class Pull {
  ref: PullRef
  m: Record<string, unknown>
  meta: Replay['meta']
  units: Record<string, { name?: string; kind?: string; role?: string }>
  events: ReplayEvent[]
  abil: Replay['abilities']
  players: string[]
  boss: string | null
  packs: Record<string, string>
  mech: Mech[] = []
  calls: Replay['calls']

  constructor(ref: PullRef, rep: Replay) {
    this.ref = ref
    this.meta = rep.meta
    this.m = (rep.meta.metrics ?? {}) as unknown as Record<string, unknown>
    this.units = Object.fromEntries((rep.units ?? []).map((u) => [u.id, u]))
    this.events = rep.events ?? []
    for (const e of this.events) {
      if (e.type === 'spawn' && e.unit && typeof e.unit === 'object' && !(e.unit.id in this.units)) this.units[e.unit.id] = e.unit
    }
    this.abil = rep.abilities ?? {}
    this.players = Object.entries(this.units).filter(([, u]) => u.kind === 'player').map(([id]) => id)
    const start = this.events.find((e) => e.type === 'encounter_start') as { boss?: string } | undefined
    this.boss = start?.boss ?? null
    this.packs = Object.fromEntries((rep.arena?.packs ?? []).map((p) => [p.id, p.name]))
    this.calls = rep.calls
    this.mechanics()
  }

  name(uid: unknown): string { return this.units[String(uid)]?.name ?? String(uid) }
  ability(aid: unknown): string { return this.abil[String(aid)]?.name ?? String(aid) }
  isPlayer(u: unknown) { return this.players.includes(String(u)) }

  private mechanics() {
    const out: Mech[] = []
    const pending = new Map<string, Extract<ReplayEvent, { type: 'cast_start' }>>()
    const marked = new Map<number, string>()
    const markHits = new Map<number, string[]>()
    for (const e of this.events) {
      const t = e.t
      if (e.type === 'cast_start' && !this.isPlayer(e.unit) && e.interruptible) pending.set(e.unit, e)
      else if (e.type === 'cast_interrupted' && pending.has(e.unit)) {
        const s = pending.get(e.unit)!
        pending.delete(e.unit)
        out.push({ t: s.t, mechanic: 'kick', caster: e.unit, ok: e.reason === 'interrupt',
          detail: this.ability(s.ability) + (e.by ? `, kicked by ${this.name(e.by)}` : `, stopped (${e.reason})`) })
      } else if (e.type === 'cast_success' && pending.has(e.unit) && pending.get(e.unit)!.ability === e.ability) {
        const s = pending.get(e.unit)!
        pending.delete(e.unit)
        out.push({ t: s.t, mechanic: 'kick', caster: e.unit, ok: false, detail: `${this.ability(s.ability)}, not kicked` })
      } else if (e.type === 'death' && pending.has(e.unit)) pending.delete(e.unit) // died mid-cast: neither
      else if (e.type === 'pyre_detonate') {
        const inside = e.inside ?? []
        out.push({ t, mechanic: 'bone_pyre', caster: this.boss, ok: !!e.soaked, inside,
          detail: inside.length ? `${inside.length} inside: ${inside.map((u) => this.name(u)).join(', ')}` : 'nobody inside' })
      } else if (e.type === 'aura_apply' && e.aura === 'grave_mark') marked.set(t + (e.duration_ms ?? 0), e.unit)
      else if (e.type === 'damage' && e.ability === 'grave_mark' && this.isPlayer(e.target)) {
        if (!markHits.has(t)) markHits.set(t, [])
        markHits.get(t)!.push(e.target)
      }
    }
    for (const [t, hit] of markHits) {
      let who = marked.get(t) ?? null
      if (who == null) for (const [tt, u] of marked) if (Math.abs(tt - t) <= 200) { who = u; break }
      const others = hit.filter((u) => u !== who)
      out.push({ t, mechanic: 'grave_mark', caster: this.boss, ok: !others.length, marked: who, hit: others,
        detail: `on ${this.name(who)}` + (others.length ? `, also hit ${others.map((u) => this.name(u)).join(', ')}` : ', nobody else hit') })
    }
    this.mech = out.sort((a, b) => cmp([a.t, a.mechanic], [b.t, b.mechanic]))
  }

  key(): Row {
    const r = this.ref
    return { model: r.model, effort: r.effort, tier: r.tier, role: r.role, memory: r.memory, group: r.group, pull: r.pull }
  }

  deaths(): Row[] {
    const rows: Row[] = []
    for (const e of this.events) {
      if (e.type !== 'death' || !this.isPlayer(e.unit)) continue
      const hits = new Map<string, number>()
      for (const d of this.events) {
        if (d.type === 'damage' && d.target === e.unit && e.t - 5000 < d.t && d.t <= e.t) {
          hits.set(d.ability, (hits.get(d.ability) ?? 0) + (d.amount ?? 0) + (d.absorbed ?? 0))
        }
      }
      const top = [...hits].sort((a, b) => b[1] - a[1])
      rows.push({ ...this.key(), t_s: sec(e.t), unit: e.unit, player_role: this.units[e.unit]?.role, ability: e.ability,
        killer: e.killer, last_5s: top.map(([a, n]) => `${this.ability(a)} ${n}`).join('; ') })
    }
    return rows
  }

  damageTaken(): Row[] {
    const tot = new Map<string, { unit: string; ability: string; amount: number; hits: number }>()
    for (const d of this.events) {
      if (d.type !== 'damage' || !this.isPlayer(d.target)) continue
      const k = `${d.target}\u0000${d.ability}`
      const x = tot.get(k) ?? { unit: d.target, ability: d.ability, amount: 0, hits: 0 }
      x.amount += (d.amount ?? 0) + (d.absorbed ?? 0)
      x.hits += 1
      tot.set(k, x)
    }
    return [...tot.values()].sort((a, b) => cmp([a.unit, -a.amount], [b.unit, -b.amount])).map((x) => ({ ...this.key(), ...x }))
  }

  row(): Row {
    const m = this.m as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const st = this.ref.stats as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const ev = this.events
    const first = ev.find((e) => e.type === 'death' && this.isPlayer(e.unit)) as Extract<ReplayEvent, { type: 'death' }> | undefined
    const cleared: Record<string, number> = {}
    for (const e of ev) if (e.type === 'pack_cleared') cleared[e.pack] = e.t
    const bp = ev.find((e) => e.type === 'pull' && e.pack === 'boss')
    const bossPull = bp ? bp.t : this.meta.boss_engaged_ms
    const kicks = this.mech.filter((x) => x.mechanic === 'kick')
    const bk = kicks.filter((x) => x.caster === this.boss)
    const tk = kicks.filter((x) => x.caster !== this.boss)
    const pyres = this.mech.filter((x) => x.mechanic === 'bone_pyre')
    const marks = this.mech.filter((x) => x.mechanic === 'grave_mark')
    const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0)
    const dps = m.dps as Record<string, number> | undefined
    const r = this.ref
    return {
      model: r.model, provider: r.provider, effort: r.effort, tier: r.tier, role: r.role, memory: r.memory, group: r.group,
      pull: r.pull, run_id: r.run_id,
      seed: this.meta.seed, outcome: m.outcome, in_time: m.in_time, score: m.score, progress_pct: m.progress_pct,
      boss_hp_left_pct: m.boss_hp_pct_remaining, duration_s: m.duration_s, penalty_s: m.penalty_s, revives: m.revives,
      deaths: (m.deaths ?? []).length, first_death_s: first ? sec(first.t) : null,
      first_death: first ? `${first.unit}: ${first.ability}` : '',
      pack1_cleared_s: sec(cleared.pack1), pack2_cleared_s: sec(cleared.pack2), boss_pulled_s: sec(bossPull),
      boss_kicks: bk.filter((x) => x.ok).length, boss_kickable: bk.length,
      trash_kicks: tk.filter((x) => x.ok).length, trash_kickable: tk.length,
      pyres: pyres.length, pyres_soaked: pyres.filter((x) => x.ok).length,
      pyre_mean_inside: pyres.length ? pyRound(pyres.reduce((a, x) => a + x.inside!.length, 0) / pyres.length, 2) : null,
      marks: marks.length, mark_allies_hit: marks.reduce((a, x) => a + x.hit!.length, 0),
      avoidable_damage: sum(m.avoidable_damage_taken), party_dps: dps && Object.keys(dps).length ? sum(dps) : null,
      healing: sum(m.healing_done) || null, chat_lines: ev.filter((e) => e.type === 'chat').length,
      calls: st.calls ?? (this.calls ?? []).length, input_tokens: st.input_tokens, output_tokens: st.output_tokens,
      usd: st.usd, refusals: st.refusals, unusable_replies: st.unusable_replies, truncated_replies: st.truncated_replies,
      api_errors: st.api_errors, out_of_calls: st.budget_exhausted,
    }
  }

  mechanicRows(): Row[] {
    return this.mech.map((x) => ({ ...this.key(), t_s: sec(x.t), mechanic: x.mechanic, caster: x.caster, ok: x.ok, detail: x.detail }))
  }

  callRows(): Row[] {
    return (this.calls ?? []).map((c) => ({ ...this.key(), t_s: sec(c.t), agent: c.agent, why: c.why, reply: c.reply,
      thinking: c.thinking ?? '', input_tokens: c.input_tokens, output_tokens: c.output_tokens }))
  }

  between(): Row | null {
    const p = this.meta.progress
    if (!p) return null
    return { ...this.key(), debrief: p.debrief ?? '', talk: p.talk ?? [], notes_before: p.notes_before ?? {}, notes_after: p.notes_after ?? {} }
  }

  timeline(): string[] {
    const lines: [number, string][] = []
    const mechAt = new Set(this.mech.filter((x) => x.mechanic === 'kick').map((x) => `${x.t}|${x.caster}`))
    for (const e of this.events) {
      const t = e.t
      if (e.type === 'chat') lines.push([t, `${this.name(e.unit)}: "${e.text ?? ''}"`])
      else if (e.type === 'pull') {
        const what = e.pack === 'boss' ? this.name(this.boss) : this.packs[e.pack] ?? e.pack
        lines.push([t, `${this.name(e.by)} pulls ${what}`])
      } else if (e.type === 'pack_cleared') lines.push([t, `${this.packs[e.pack] ?? e.pack} cleared`])
      else if ((e.type === 'cast_start' || e.type === 'cast_success') && e.unit === this.boss) {
        const a = e.ability
        if (a === 'hollow_strike' || a === 'auto_attack' || (e.type === 'cast_success' && this.abil[a]?.cast_ms)) continue
        if (mechAt.has(`${t}|${e.unit}`)) continue
        lines.push([t, `${this.name(e.unit)}: ${this.ability(a)}` + (e.target ? ` on ${this.name(e.target)}` : '')])
      } else if (e.type === 'death' && this.isPlayer(e.unit)) lines.push([t, `DEATH ${this.name(e.unit)} (${this.ability(e.ability)})`])
      else if (e.type === 'revive') lines.push([t, `${this.name(e.unit)} revived (+${sec(e.penalty_ms ?? 0)} s on the timer)`])
      else if (e.type === 'spawn' && typeof e.unit === 'object' && e.unit.kind === 'add') lines.push([t, `add rises: ${e.unit.name}`])
      else if (e.type === 'encounter_end') lines.push([t, `END: ${e.outcome}`])
    }
    for (const x of this.mech) {
      if (x.mechanic === 'kick') {
        if (x.caster !== this.boss && x.ok) continue
        lines.push([x.t, `${this.name(x.caster)}: ${x.detail}`])
      } else if (x.mechanic === 'bone_pyre') {
        lines.push([x.t, `Bone Pyre goes off: ${x.detail} -> ${x.ok ? 'soaked' : 'NOT soaked, whole party hit'}`])
      } else lines.push([x.t, `Grave Mark ${x.detail}`])
    }
    const out: string[] = []
    let last = ''
    for (const [t, s] of lines.sort((a, b) => a[0] - b[0])) {
      const k = `${t}|${s}`
      if (s.startsWith('add rises') && k === last) continue
      last = k
      out.push(`${clock(t)} ${s}`)
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const cellName = (r: PullRef) => (r.effort ? `${r.model}@${r.effort}_${r.tier}` : `${r.model}_${r.tier}`)

function csv(rows: Row[], cols: string[]): string {
  const cell = (v: unknown) => {
    if (v == null) return ''
    const s = typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}

function groupScore(items: { pull: number; score: number }[], maxPulls: number) {
  const by = new Map(items.map((i) => [i.pull, i]))
  let last = 0
  let total = 0
  for (let k = 1; k <= maxPulls; k++) {
    if (by.has(k)) last = by.get(k)!.score
    total += last
  }
  return total / maxPulls
}

function groupStory(pulls: Pull[], g: Row): string {
  const r = pulls[0].ref
  const out = [`# ${r.model}${r.effort ? ` @ ${r.effort}` : ''}, ${r.tier}, ${r.role} group ${r.group}${r.memory ? '' : ' (memory off)'}`, '',
    `Group score ${g.group_score}; pull scores ${g.scores}; ${g.cleared_on ? `cleared on pull ${g.cleared_on}.` : 'no clear.'}`, '']
  for (const p of pulls) {
    const m = p.m as Record<string, unknown>
    out.push(`## Pull ${p.ref.pull}: ${m.outcome} at ${m.duration_s} s, score ${m.score}, ${p.name(p.boss)} at ${m.boss_hp_pct_remaining}% (seed ${p.meta.seed})`,
      '', '### The fight', '', '```', ...p.timeline(), '```', '')
    const b = p.meta.progress
    if (!b) continue
    const notes = (typeof b.notes_before === 'object' ? b.notes_before : {}) as Record<string, string>
    if (Object.values(notes).some(Boolean)) {
      out.push('### Notes going in', '', ...Object.entries(notes).filter(([, n]) => n).map(([u, n]) => `- **${p.name(u)}**: ${n}`), '')
    }
    if (b.debrief) out.push('### The debrief the party read after it', '', '```', b.debrief, '```', '')
    const talk = (b.talk ?? []).filter((x) => x.message)
    if (talk.length) {
      out.push('### The talk', '', ...talk.map((x) => `- r${x.round} **${p.name(x.agent)}**${x.ready ? ' (ready)' : ''}: ${x.message}`), '')
    }
  }
  return out.join('\n') + '\n'
}

function byPullTable(rows: Row[], maxPulls: number): string[] {
  const out = ['| pull | groups | score | deaths | boss kicks | trash kicks | pyres soaked | mark hit allies | avoidable dmg |',
    '|---|---|---|---|---|---|---|---|---|']
  const pct = (a: number, b: number) => (b ? `${a}/${b} (${percent(a, b)}%)` : '-')
  const s = (rs: Row[], k: string) => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  for (let k = 1; k <= maxPulls; k++) {
    const rs = rows.filter((r) => r.pull === k)
    if (!rs.length) continue
    const n = rs.length
    out.push(`| ${k} | ${n} | ${pyFixed(s(rs, 'score') / n, 1)} | ${pyFixed(s(rs, 'deaths') / n, 1)} | `
      + `${pct(s(rs, 'boss_kicks'), s(rs, 'boss_kickable'))} | ${pct(s(rs, 'trash_kicks'), s(rs, 'trash_kickable'))} | `
      + `${pct(s(rs, 'pyres_soaked'), s(rs, 'pyres'))} | ${pyFixed(s(rs, 'mark_allies_hit') / n, 1)} | `
      + `${pyFixed(s(rs, 'avoidable_damage') / n, 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} |`)
  }
  return out
}

function overview(source: string, pullRows: Row[], groupRows: Row[], deathRows: Row[], maxPulls: number): string {
  const ck = (r: Row) => JSON.stringify([r.model, r.effort, r.tier, r.role, r.memory])
  const cells = new Map<string, Row[]>()
  for (const g of groupRows) {
    if (!cells.has(ck(g))) cells.set(ck(g), [])
    cells.get(ck(g))!.push(g)
  }
  const keys = [...cells.keys()].sort((a, b) => {
    const x = JSON.parse(a)
    const y = JSON.parse(b)
    return cmp([String(x[0]), String(x[1]), String(x[2]), roleIdx(x[3])], [String(y[0]), String(y[1]), String(y[2]), roleIdx(y[3])])
  })
  const out = [`# MythicBench analysis: ${source}`, '',
    `${pullRows.length} pulls in ${groupRows.length} groups. Up to ${maxPulls} pulls per group. `
    + 'Roles: ranked = the leaderboard\'s groups, paired = extra memory-on groups for the learning effect, '
    + 'control = memory off, sanity = Normal, effort = an effort sweep, baseline = the scripted commander; '
    + 'from local run folders, campaign = a campaign\'s run and run = any other run.', '',
    '## Cells', '',
    '| model | effort | tier | role | memory | groups | mean group score | clears | mean pulls to clear | $ / group | reply problems / calls |',
    '|---|---|---|---|---|---|---|---|---|---|---|']
  for (const key of keys) {
    const gs = cells.get(key)!
    const [model, effort, tier, role, mem] = JSON.parse(key)
    const clears = gs.map((g) => g.cleared_on as number | null).filter((c): c is number => !!c)
    const usd = gs.map((g) => g.usd as number | null).filter((u): u is number => u != null)
    const prs = pullRows.filter((r) => ck(r) === key)
    const probs = prs.reduce((a, r) => a + (Number(r.refusals) || 0) + (Number(r.unusable_replies) || 0), 0)
    const calls = prs.reduce((a, r) => a + (Number(r.calls) || 0), 0)
    out.push('| ' + [model, effort || '-', tier, role, mem ? 'on' : 'off', gs.length,
      pyFixed(gs.reduce((a, g) => a + (g.group_score as number), 0) / gs.length, 1), `${clears.length}/${gs.length}`,
      clears.length ? pyFixed(clears.reduce((a, b) => a + b, 0) / clears.length, 1) : '-',
      usd.length ? pyFixed(usd.reduce((a, b) => a + b, 0) / usd.length, 2) : '-', `${probs}/${calls}`].join(' | ') + ' |')
  }
  out.push('', '## Pull by pull', '',
    'Averages over each cell\'s groups, by pull number. A group that cleared stops, so later pulls can have fewer groups.', '')
  for (const key of keys) {
    const [model, effort, tier, role, mem] = JSON.parse(key)
    out.push(`### ${model}${effort ? ` @ ${effort}` : ''}, ${tier}, ${role}${mem ? '' : ', memory off'}`, '',
      ...byPullTable(pullRows.filter((r) => ck(r) === key), maxPulls), '')
    const ds = deathRows.filter((d) => ck(d) === key)
    if (ds.length) {
      const c = new Map<string, number>()
      for (const d of ds) c.set(String(d.ability), (c.get(String(d.ability)) ?? 0) + 1)
      const top = [...c].sort((a, b) => b[1] - a[1]).slice(0, 5)
      out.push(`Killing blows: ${top.map(([a, n]) => `${a} ${n}`).join(', ')} (${ds.length} deaths)`, '')
    }
  }
  return out.join('\n') + '\n'
}

const README = (maxPulls: number) => `# MythicBench analysis export

Made by \`python -m mythicsim export\` or the website's Export button (the same
files). Every number here is computed from the replays; nothing is new data.
Start with \`overview.md\`.

| file | one row per |
| --- | --- |
| overview.md | cell (model x effort x tier x role): scores, clears, cost; then averages by pull number |
| pulls.csv | pull |
| groups.csv | group (up to ${maxPulls} pulls; ends at its first timed clear) |
| deaths.csv | player death, with the damage they took in their last 5 s |
| mechanics.csv | mechanic attempt: each kick-able enemy cast (ok = kicked), Bone Pyre (ok = soaked), Grave Mark (ok = nobody else hit) |
| damage_taken.csv | pull x player x ability |
| calls.jsonl | in-fight model call: time, agent, why it was asked, its reply and thinking, tokens (prompts left out; the command line's \`--prompts\` adds them) |
| between_pulls.jsonl | pull: the debrief read after it, the talk, and each agent's notes before and after |
| groups/<cell>/<role>-g<N>.md | group: its story, pull by pull |

Columns that need a word:

- \`role\`: ranked (the leaderboard's groups), paired (extra memory-on groups for
  the learning effect), control (memory off), sanity (Normal), effort (an effort
  sweep), baseline (the scripted commander). Exported from local run folders
  instead: campaign (a campaign's run) or run (any other run); \`memory\` and
  \`effort\` still tell the conditions apart.
- \`score\` is the pull score (0-100); \`group_score\` is the mean over ${maxPulls} pulls
  with a clear carried forward (the MythicBench score is the mean of these).
- \`boss_kicks / boss_kickable\`: Oruth's kick-able casts that were kicked, of those started.
- \`pyres_soaked / pyres\`: Bone Pyres with 2+ players inside when they went off.
- \`mark_allies_hit\`: allies caught by a Grave Mark's blast (0 is perfect).
- \`usd\` is at list prices, thinking included.

To ask an LLM about it: send \`overview.md\` first, then the group stories you
care about (\`groups/...\`), and the CSVs for anything numeric.
`

/** Build every export file for ``refs``. ``fetchReplay`` loads one replay; ``onProgress`` counts pulls read. */
export async function buildExport(refs: PullRef[], maxPulls: number, source: string,
  fetchReplay: (url: string) => Promise<Replay>, onProgress?: (done: number, total: number) => void): Promise<Map<string, string>> {
  refs = [...refs].sort((a, b) => cmp(sortKey(a), sortKey(b)))
  const pullRows: Row[] = []
  const deathRows: Row[] = []
  const mechRows: Row[] = []
  const dmgRows: Row[] = []
  const calls: string[] = []
  const between: string[] = []
  const groups = new Map<string, Pull[]>()
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]
    const p = new Pull(ref, await fetchReplay(ref.url))
    pullRows.push(p.row())
    deathRows.push(...p.deaths())
    mechRows.push(...p.mechanicRows())
    dmgRows.push(...p.damageTaken())
    for (const c of p.callRows()) calls.push(JSON.stringify(c))
    const b = p.between()
    if (b) between.push(JSON.stringify(b))
    p.calls = undefined // keep memory flat: the calls are already written out
    const gk = JSON.stringify([ref.model, ref.effort, ref.tier, ref.role, ref.memory, ref.run_id, ref.group])
    if (!groups.has(gk)) groups.set(gk, [])
    groups.get(gk)!.push(p)
    onProgress?.(i + 1, refs.length)
  }
  const files = new Map<string, string>()
  const groupRows: Row[] = []
  for (const ps of groups.values()) {
    ps.sort((a, b) => a.ref.pull - b.ref.pull)
    const items = ps.map((p) => ({ pull: p.ref.pull, score: (p.m.score as number) || 0 }))
    const cleared = ps.find((p) => p.m.in_time)?.ref.pull ?? null
    const usd = ps.map((p) => p.ref.stats.usd as number | null | undefined).filter((u): u is number => u != null)
    const r = ps[0].ref
    const g: Row = { model: r.model, provider: r.provider, effort: r.effort, tier: r.tier, role: r.role, memory: r.memory,
      group: r.group, run_id: r.run_id, pulls_played: ps.length, cleared_on: cleared,
      group_score: pyRound(groupScore(items, maxPulls), 2),
      first_score: items[0].score, best_score: Math.max(...items.map((i) => i.score)), last_score: items[items.length - 1].score,
      scores: items.map((i) => pyFixed(i.score, 1)).join(' '),
      usd: usd.length ? pyRound(usd.reduce((a, b) => a + b, 0), 4) : null }
    groupRows.push(g)
    const local = r.role === 'run' || r.role === 'campaign' ? `-${r.run_id.slice(-4)}` : ''
    files.set(`groups/${cellName(r)}/${r.role}${r.memory ? '' : '-off'}${local}-g${r.group}.md`, groupStory(ps, g))
  }
  files.set('README.md', README(maxPulls))
  files.set('overview.md', overview(source, pullRows, groupRows, deathRows, maxPulls))
  files.set('pulls.csv', csv(pullRows, PULL_COLS))
  files.set('groups.csv', csv(groupRows, GROUP_COLS))
  files.set('deaths.csv', csv(deathRows, DEATH_COLS))
  files.set('mechanics.csv', csv(mechRows, MECH_COLS))
  files.set('damage_taken.csv', csv(dmgRows, DMG_COLS))
  files.set('calls.jsonl', calls.map((c) => c + '\n').join(''))
  files.set('between_pulls.jsonl', between.map((c) => c + '\n').join(''))
  return files
}

// ---------------------------------------------------------------------------
// Zip (deflate where the browser can, else stored), no dependencies
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function deflateRaw(b: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw' as CompressionFormat))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null // no deflate-raw here: store the file
  }
}

/** A zip of ``files`` inside one folder ``root``. */
export async function zip(files: Map<string, string>, root: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const names = [...files.keys()].sort()
  for (const rel of names) {
    const name = enc.encode(`${root}/${rel}`)
    const data = enc.encode(files.get(rel)!)
    const crc = crc32(data)
    const packed = await deflateRaw(data)
    const method = packed && packed.length < data.length ? 8 : 0
    const body = method === 8 ? packed! : data
    const head = (sig: number, extra: number) => {
      const h = new DataView(new ArrayBuffer(extra))
      h.setUint32(0, sig, true)
      return h
    }
    const lh = head(0x04034b50, 30)
    lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true)
    lh.setUint16(10, 0, true); lh.setUint16(12, 33, true) // 1980-01-01 00:00: byte-identical exports
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true)
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true)
    const ch = head(0x02014b50, 46)
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true)
    ch.setUint16(12, 0, true); ch.setUint16(14, 33, true)
    ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true)
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true)
    parts.push(new Uint8Array(lh.buffer), name, body)
    central.push(new Uint8Array(ch.buffer), name)
    offset += 30 + name.length + body.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, names.length, true); end.setUint16(10, names.length, true)
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0))
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out
}

/** Export ``runs`` and hand the browser a zip to save. */
export async function downloadExport(runs: CatalogRun[], urlOf: (run: CatalogRun, it: CatalogItem) => string, name: string,
  fetchReplay: (url: string) => Promise<Replay>, onProgress?: (done: number, total: number) => void): Promise<void> {
  const refs = pullRefs(runs, urlOf)
  const maxPulls = Math.max(1, ...runs.map((r) => r.max_pulls ?? 1))
  const files = await buildExport(refs, maxPulls, name, fetchReplay, onProgress)
  const bytes = await zip(files, name)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
