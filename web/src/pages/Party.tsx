import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { CLASS_COLORS, ROLE_LABEL } from '../content/display'
import { AbilityIcon, RoleIcon } from '../hud/bits'
import { Page } from '../site/Layout'
import { COLOR } from '../site/tokens'

// web/public/replays/game.json, written by `python -m mythicsim generate` from the
// simulator's own content (sim/mythicsim/guide.py), so this page can't drift from the game.
interface GuideAbility {
  id: string; name: string; kind: string; kind_name: string; school: string; icon: string; description: string
  cast_s: number; cooldown_s: number; on_gcd: boolean; interruptible: boolean
  amount?: number; radius_m?: number; range_m?: number
}
interface GuideMember {
  id: string; name: string; class: string; class_name: string; role: string; max_hp: number
  auto_attack: { amount: number; every_s: number } | null
  abilities: GuideAbility[]
}
interface Guide {
  content_version: string; gcd_s: number; melee_range_m: number
  party: GuideMember[]
  trash: { id: string; name: string; max_hp: number; melee: boolean; spells: GuideAbility[] }[]
  boss: { id: string; name: string; max_hp: number; abilities: GuideAbility[]; adds_at_pct: number[] }
  tiers: { id: string; name: string; enemy_hp: number; enemy_dmg: number; limit_s: number; affixes: { id: string; name: string; description: string }[] }[]
}

/** 42K, 1.5M, 9K: no trailing ".0". */
function fmtNum(n: number): string {
  const short = (x: number) => String(Number(x.toFixed(1)))
  if (n >= 1e6) return `${short(n / 1e6)}M`
  if (n >= 1e3) return `${short(n / 1e3)}K`
  return `${Math.round(n)}`
}

/** On +10, the tier every score comes from, Hollow Tyrant moves Oruth's adds to these (sim TYRANT_RAISE_AT). */
const PLUS10_ADDS_AT = [80, 50, 25]

const ENEMY = COLOR.bad
/** Names short enough for the roster. */
const SHORT: Record<string, string> = { bonewalker: 'Bonewalker', oruth: 'Oruth' }
const BOSS = CLASS_COLORS.boss

interface Character {
  id: string; name: string; color: string; kind: ReactNode
  plates: [string, string][]; abilities: GuideAbility[]; enemy?: boolean; empty?: string
}

function stats(a: GuideAbility): string[] {
  const out = [a.cast_s ? `${a.cast_s} s cast` : 'Instant']
  if (a.cooldown_s) out.push(`${a.cooldown_s} s cooldown`)
  if (!a.on_gcd) out.push('off the global cooldown')
  if (a.range_m) out.push(`${a.range_m} m range`)
  if (a.radius_m) out.push(`${a.radius_m} m radius`)
  if (a.amount) out.push(`${fmtNum(a.amount)} ${/heal|hot|raid_heal/.test(a.kind) ? 'healing' : a.kind === 'absorb' ? 'absorbed' : 'damage'}`)
  return out
}

function AbilityCard({ a, enemy = false }: { a: GuideAbility; enemy?: boolean }) {
  return (
    <li className="flex flex-col rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <AbilityIcon ability={a.id} info={a} size={40} harmful={enemy} />
        <div className="min-w-0">
          <div className="text-[15px] leading-5 text-fg">{a.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-fg-faint">
            {a.kind_name}
            {a.interruptible && <span className="rounded bg-info/10 px-1.5 text-info">Interrupt this</span>}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[14px] leading-[22px] text-fg-muted">{a.description}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {stats(a).map((s) => <span key={s} className="num rounded-md bg-white/[0.05] px-2 py-0.5 text-[12px] text-fg-muted">{s}</span>)}
      </div>
    </li>
  )
}

const portrait = (id: string) => `${import.meta.env.BASE_URL}portraits/${id}.png`

/**
 * A character-select screen: the selected one large on a lit stage, a roster
 * to pick from, and its abilities below. Arrows, the arrow keys and a swipe
 * move through the roster; /party#<id> opens on that character.
 */
function Roster({ id, title, cards }: { id: string; title: string; cards: Character[] }) {
  const pick = () => Math.max(0, cards.findIndex((c) => `#${c.id}` === location.hash))
  const [i, setI] = useState(pick)
  const [dir, setDir] = useState(1)
  const ref = useRef<HTMLElement>(null)
  const swipe = useRef<number | null>(null)

  useEffect(() => {
    const on = () => {
      const k = cards.findIndex((c) => `#${c.id}` === location.hash)
      if (k >= 0) { setI(k); ref.current?.scrollIntoView() }
    }
    on()
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [cards])

  const go = (k: number) => {
    const n = (k + cards.length) % cards.length
    setDir(k > i ? 1 : -1)
    setI(n)
    history.replaceState(null, '', `#${cards[n].id}`)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1) }
  }
  const down = (e: PointerEvent) => { swipe.current = e.clientX }
  const up = (e: PointerEvent) => {
    if (swipe.current == null) return
    const dx = e.clientX - swipe.current
    swipe.current = null
    if (Math.abs(dx) > 48) go(dx < 0 ? i + 1 : i - 1)
  }

  const c = cards[i]
  const arrow = 'absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-line bg-[rgba(15,15,16,0.8)] text-fg-muted transition-colors hover:border-white/20 hover:text-fg'
  return (
    <section id={id} ref={ref} className="scroll-mt-20 outline-none" tabIndex={-1} onKeyDown={onKey} aria-roledescription="carousel" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[20px] font-medium text-fg">{title}</h2>
        <p className="num text-[12px] text-fg-faint">{i + 1} of {cards.length}</p>
      </div>

      {/* The stage */}
      <div className="relative mt-4 touch-pan-y select-none overflow-hidden rounded-2xl border border-line"
        onPointerDown={down} onPointerUp={up} onPointerCancel={() => { swipe.current = null }}
        style={{ background: `radial-gradient(ellipse 60% 80% at 25% 70%, ${c.color}2e, transparent 70%), linear-gradient(180deg, ${COLOR.surface}, ${COLOR.bg})` }}>
        <button className={`${arrow} left-3`} onClick={() => go(i - 1)} aria-label="Previous"><ChevronLeft size={18} /></button>
        <button className={`${arrow} right-3`} onClick={() => go(i + 1)} aria-label="Next"><ChevronRight size={18} /></button>
        <div key={c.id} className="stage-in grid items-center gap-2 px-14 pb-8 pt-6 sm:gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:py-10"
          style={{ ['--from' as string]: `${dir * 16}px` }} aria-live="polite">
          <div className="relative mx-auto w-[180px] sm:w-[240px]">
            {/* A pedestal of light under the portrait */}
            <div className="absolute inset-x-[8%] bottom-[2%] h-[16%] rounded-[50%] blur-md" style={{ background: `${c.color}55` }} aria-hidden />
            <div className="absolute inset-x-[14%] bottom-[5%] h-[9%] rounded-[50%] border" style={{ borderColor: `${c.color}99` }} aria-hidden />
            <img src={portrait(c.id)} alt={c.name} width={256} height={256} className="relative aspect-square w-full" draggable={false} />
          </div>
          <div className="min-w-0 text-center md:text-left">
            <div className="flex items-center justify-center gap-2 text-[13px] md:justify-start" style={{ color: c.color }}>{c.kind}</div>
            <h3 className="mt-1 text-[28px] font-normal leading-tight text-fg sm:text-[32px]">{c.name}</h3>
            <dl className="mx-auto mt-4 grid max-w-[460px] grid-cols-3 gap-2 md:mx-0">
              {c.plates.map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-black/20 px-3 py-2 text-left">
                  <dt className="text-[12px] text-fg-faint">{k}</dt>
                  <dd className="num mt-0.5 truncate text-[15px] text-fg">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* The roster */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={`${title}: pick one`}>
        {cards.map((x, k) => {
          const on = k === i
          return (
            <button key={x.id} role="tab" aria-selected={on} onClick={() => go(k)}
              className={`flex shrink-0 flex-col items-center rounded-xl border px-2 pb-2 pt-1 transition-colors ${on ? 'bg-surface-raised' : 'border-line hover:border-white/20'}`}
              style={on ? { borderColor: x.color } : undefined}>
              <img src={portrait(x.id)} alt="" width={56} height={56} className="h-14 w-14" style={{ opacity: on ? 1 : 0.7 }} draggable={false} />
              <span className={`max-w-[104px] truncate text-[12px] ${on ? 'text-fg' : 'text-fg-muted'}`}>{SHORT[x.id] ?? x.name}</span>
            </button>
          )
        })}
      </div>

      {/* Its abilities */}
      {c.abilities.length
        ? <ul className="mt-6 grid gap-3 md:grid-cols-2">{c.abilities.map((a) => <AbilityCard key={a.id} a={a} enemy={c.enemy} />)}</ul>
        : <p className="mt-6 text-[14px] text-fg-muted">{c.empty}</p>}
    </section>
  )
}

/** /party: every character and what each ability does, plus the enemies and affixes. */
export function Party() {
  const [g, setG] = useState<Guide | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}replays/game.json`).then((r) => r.json()).then(setG).catch(() => setError(true))
  }, [])

  const party: Character[] = (g?.party ?? []).map((m) => ({
    id: m.id, name: m.name, color: CLASS_COLORS[m.class], abilities: m.abilities,
    kind: <><RoleIcon role={m.role} size={14} />{m.class_name}</>,
    plates: [
      ['Role', ROLE_LABEL[m.role] ?? m.role],
      ['Health', fmtNum(m.max_hp)],
      ['Abilities', String(m.abilities.length)],
    ],
  }))
  const enemies: Character[] = g ? [
    ...g.trash.map((t) => ({
      id: t.id, name: t.name, color: ENEMY, abilities: t.spells, enemy: true,
      kind: <>Trash</>,
      plates: [['Type', t.melee ? 'Melee' : 'Caster'], ['Health', fmtNum(t.max_hp)], ['Spells', String(t.spells.length)]] as [string, string][],
      empty: 'It has no spells and just attacks in melee.',
    })),
    {
      id: g.boss.id, name: g.boss.name, color: BOSS, abilities: g.boss.abilities, enemy: true,
      kind: <>Boss</>,
      plates: [['Type', 'Boss'], ['Health', fmtNum(g.boss.max_hp)], ['Adds at', PLUS10_ADDS_AT.map((p) => `${p}%`).join(', ')]],
    },
  ] : []

  return (
    <Page>
      <div className="mx-auto max-w-[960px] space-y-16 py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">The party and the dungeon</h1>
        </header>

        {error && <p className="text-[14px] text-bad">Couldn't load the guide. Run <code>npm run replays</code>.</p>}
        {!g && !error && <p className="text-[14px] text-fg-faint">Loading…</p>}

        {g && (
          <>
            <Roster id="party" title="The Party" cards={party} />

            <Roster id="enemies" title="Enemies" cards={enemies} />

            <section id="difficulty" className="scroll-mt-20">
              <h2 className="text-[20px] font-medium text-fg">Difficulty and affixes</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {g.tiers.map((t) => (
                  <article key={t.id} className="rounded-xl border border-line bg-surface p-5">
                    <h3 className="flex items-center gap-2 text-[17px] text-fg">
                      {t.name}
                      {t.id === 'plus10' && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-fg-muted">Scored</span>}
                    </h3>
                    <p className="num mt-1 flex flex-wrap gap-x-4 text-[13px] text-fg-faint">
                      <span>Enemy health ×{t.enemy_hp}</span>
                      <span>Damage ×{t.enemy_dmg}</span>
                      <span>Timer {Math.floor(t.limit_s / 60)}:{String(t.limit_s % 60).padStart(2, '0')}</span>
                    </p>
                    {t.affixes.length ? (
                      <ul className="mt-3 space-y-3">
                        {t.affixes.map((a) => (
                          <li key={a.id}>
                            <div className="text-[15px] text-fg">{a.name}</div>
                            <p className="mt-0.5 text-[14px] leading-6 text-fg-muted">{a.description}</p>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-3 text-[14px] text-fg-muted">No affixes.</p>}
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </Page>
  )
}
