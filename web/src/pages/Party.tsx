import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { CLASS_COLORS, ROLE_LABEL, fmtNum } from '../content/display'
import { AbilityIcon, RoleIcon } from '../hud/bits'
import { Page } from '../site/Layout'
import { Link } from '../site/router'

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

/** What each one is for, in a sentence a WoW player would say. */
const BLURB: Record<string, string> = {
  rook: 'Holds the boss and the packs. Kicks, taunts loose adds onto himself, and has one big defensive.',
  ivy: 'The only healer. Single-target heals, a heal over time, a shield, and a group heal for the big hits. No kick.',
  brask: 'Melee damage with a cleave for packs and a kick.',
  kit: 'Melee damage, an area attack for packs, and a fast kick that is off the global cooldown.',
  wren: 'Ranged damage, a ranged kick, and Wild Roar: haste for the whole party.',
  bonewalker: 'The melee undead in both packs. It chases whoever it is attacking. On +10 each one that dies leaves a grave.',
  bone_chanter: 'The caster in the first pack. Its Grave Volley hits the whole party, so someone has to kick it.',
  marrow_mender: 'The healer in the second pack. Kill it first, or it keeps the others standing.',
  oruth: 'The last boss. A cast to kick, a tank buster, pools, adds, a hard enrage, and Bone Pyre: the circle you have to stand in.',
}

const ENEMY = '#f87171'
/** Names short enough for the roster. */
const SHORT: Record<string, string> = { bonewalker: 'Bonewalker', oruth: 'Oruth' }
const BOSS = '#7dd3fc'

interface Character {
  id: string; name: string; color: string; kind: ReactNode; blurb: string
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
            {a.interruptible && <span className="rounded bg-[rgba(127,208,255,0.12)] px-1.5 text-[#7fd0ff]">Interrupt this</span>}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[14px] leading-6 text-fg-muted">{a.description}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {stats(a).map((s) => <span key={s} className="rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[11px] text-fg-muted">{s}</span>)}
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
function Roster({ id, title, intro, cards, footnote }: { id: string; title: string; intro: ReactNode; cards: Character[]; footnote?: ReactNode }) {
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
        <h2 className="text-[22px] font-medium text-fg">{title}</h2>
        <p className="font-mono text-[12px] text-fg-faint">{i + 1} of {cards.length}</p>
      </div>
      <p className="mt-2 max-w-[680px] text-[15px] leading-6 text-fg-muted">{intro}</p>

      {/* The stage */}
      <div className="relative mt-6 touch-pan-y select-none overflow-hidden rounded-2xl border border-line"
        onPointerDown={down} onPointerUp={up} onPointerCancel={() => { swipe.current = null }}
        style={{ background: `radial-gradient(ellipse 60% 80% at 25% 70%, ${c.color}2e, transparent 70%), linear-gradient(180deg, #121214, #0b0b0d)` }}>
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
            <h3 className="mt-1 text-[32px] font-normal leading-tight text-fg sm:text-[40px]">{c.name}</h3>
            <p className="mx-auto mt-3 max-w-[460px] text-[15px] leading-6 text-fg-muted md:mx-0">{c.blurb}</p>
            <dl className="mx-auto mt-5 grid max-w-[460px] grid-cols-3 gap-2 md:mx-0">
              {c.plates.map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-black/20 px-3 py-2 text-left">
                  <dt className="text-[11px] text-fg-faint">{k}</dt>
                  <dd className="mt-0.5 truncate font-mono text-[13px] text-fg">{v}</dd>
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
      {footnote && <p className="mt-4 text-[13px] leading-5 text-fg-faint">{footnote}</p>}
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
    id: m.id, name: m.name, color: CLASS_COLORS[m.class], blurb: BLURB[m.id] ?? '', abilities: m.abilities,
    kind: <><RoleIcon role={m.role} size={14} />{m.class_name}</>,
    plates: [
      ['Role', ROLE_LABEL[m.role] ?? m.role],
      ['Health', fmtNum(m.max_hp)],
      ['Abilities', String(m.abilities.length)],
    ],
  }))
  const enemies: Character[] = g ? [
    ...g.trash.map((t) => ({
      id: t.id, name: t.name, color: ENEMY, blurb: BLURB[t.id] ?? '', abilities: t.spells, enemy: true,
      kind: <>{t.melee ? 'Trash, melee' : 'Trash, caster'}</>,
      plates: [['Type', t.melee ? 'Melee' : 'Caster'], ['Health', fmtNum(t.max_hp)], ['Spells', String(t.spells.length)]] as [string, string][],
      empty: 'No spells. It hits whoever it is attacking in melee.',
    })),
    {
      id: g.boss.id, name: g.boss.name, color: BOSS, blurb: BLURB[g.boss.id] ?? '', abilities: g.boss.abilities, enemy: true,
      kind: <>Boss</>,
      plates: [['Type', 'Boss'], ['Health', fmtNum(g.boss.max_hp)], ['Adds at', g.boss.adds_at_pct.map((p) => `${p}%`).join(', ')]],
    },
  ] : []

  return (
    <Page>
      <div className="mx-auto max-w-[960px] space-y-16 py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">The party and the dungeon</h1>
          <p className="mt-4 max-w-[680px] text-[17px] leading-7 text-fg-muted">
            Every character and enemy, and what each ability does. Each character is played by its own AI agent, which
            sees the same tooltips for its party. The enemies' abilities it has to learn by fighting them.
          </p>
        </header>

        {error && <p className="text-[14px] text-bad">Couldn't load the guide. Run <code>npm run replays</code>.</p>}
        {!g && !error && <p className="text-[14px] text-fg-faint">Loading…</p>}

        {g && (
          <>
            <Roster id="party" title="The party" cards={party}
              intro="Five characters, each played by a copy of the same model."
              footnote={<>Most abilities trigger a {g.gcd_s} s global cooldown. Melee range is {g.melee_range_m} m from the target's edge. Moving cancels a cast in progress.</>} />

            <Roster id="enemies" title="Enemies" cards={enemies}
              intro="The Hollow Vault: two packs of undead, then Oruth. The agents start without any of this."
              footnote="On +10, Hollow Tyrant makes Oruth summon adds three times (at 80%, 50% and 25% health) and adds Grave Mark." />

            <section id="difficulty" className="scroll-mt-20">
              <h2 className="text-[22px] font-medium text-fg">Difficulty and affixes</h2>
              <p className="mt-2 max-w-[680px] text-[15px] leading-6 text-fg-muted">
                The score is on +10; Normal is a check. Affixes are always visible to the agents, as in the game.{' '}
                <Link to="/watch" className="text-fg underline decoration-white/30 underline-offset-4">Watch a run</Link> to see them in play.
              </p>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {g.tiers.map((t) => (
                  <article key={t.id} className="rounded-xl border border-line bg-surface p-5">
                    <h3 className="text-[18px] text-fg">{t.name}</h3>
                    <p className="mt-1 font-mono text-[12px] text-fg-faint">
                      enemy health ×{t.enemy_hp}, damage ×{t.enemy_dmg}, timer {Math.floor(t.limit_s / 60)}:{String(t.limit_s % 60).padStart(2, '0')}
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
