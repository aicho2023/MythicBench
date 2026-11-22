import { useEffect, useState, type ReactNode } from 'react'
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

/** What one party member is for, in a sentence a WoW player would say. */
const BLURB: Record<string, string> = {
  bramble: 'Holds the boss and the packs. Kicks, taunts loose adds onto himself, and has one big defensive.',
  lumi: 'The only healer. Single-target heals, a heal over time, a shield, and a group heal for the big hits. No kick.',
  grokka: 'Melee damage with a cleave for packs and a kick.',
  nyx: 'Melee damage, an area attack for packs, and a fast kick that is off the global cooldown.',
  bao: 'Ranged damage, a ranged kick, and Wild Roar: haste for the whole party.',
}

function stats(a: GuideAbility): string[] {
  const out = [a.cast_s ? `${a.cast_s} s cast` : 'Instant']
  if (a.cooldown_s) out.push(`${a.cooldown_s} s cooldown`)
  if (!a.on_gcd) out.push('off the global cooldown')
  if (a.range_m) out.push(`${a.range_m} m range`)
  if (a.radius_m) out.push(`${a.radius_m} m radius`)
  if (a.amount) out.push(`${fmtNum(a.amount)} ${/heal|hot|raid_heal/.test(a.kind) ? 'healing' : a.kind === 'absorb' ? 'absorbed' : 'damage'}`)
  if (a.interruptible) out.push('can be interrupted')
  return out
}

function AbilityRow({ a, enemy = false }: { a: GuideAbility; enemy?: boolean }) {
  return (
    <li className="grid grid-cols-[32px_1fr] gap-x-3 py-3">
      <AbilityIcon ability={a.id} info={a} size={32} harmful={enemy} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[15px] text-fg">{a.name}</span>
          <span className="text-[12px] text-fg-faint">{a.kind_name}</span>
          {a.interruptible && <span className="rounded bg-[rgba(127,208,255,0.12)] px-1.5 text-[12px] text-[#7fd0ff]">Interrupt this</span>}
        </div>
        <p className="mt-0.5 text-[14px] leading-6 text-fg-muted">{a.description}</p>
        <p className="mt-0.5 font-mono text-[12px] text-fg-faint">{stats(a).join(', ')}</p>
      </div>
    </li>
  )
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10">
      <h2 className="text-[22px] font-normal text-fg">{title}</h2>
      {intro && <p className="mt-2 max-w-[680px] text-[15px] leading-6 text-fg-muted">{intro}</p>}
      <div className="mt-6">{children}</div>
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
  return (
    <Page>
      <div className="mx-auto max-w-[960px] space-y-14 py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">The party and the dungeon</h1>
          <p className="mt-4 max-w-[680px] text-[17px] leading-7 text-fg-muted">
            Every character and every ability, so you can follow a replay without guessing. Each character is
            played by its own AI agent, which sees the same tooltips you do here for its party. The enemies'
            abilities are listed too; in a blind run the agents start without them and have to learn them.
          </p>
          {g && (
            <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-[13px]">
              {g.party.map((m) => (
                <a key={m.id} href={`#${m.id}`} className="rounded-lg border border-line px-3 py-1.5 transition-colors hover:border-white/20" style={{ color: CLASS_COLORS[m.class] }}>{m.name}</a>
              ))}
              <a href="#enemies" className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:text-fg">Enemies</a>
              <a href="#difficulty" className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:text-fg">Difficulty and affixes</a>
            </nav>
          )}
        </header>

        {error && <p className="text-[14px] text-bad">Couldn't load the guide. Run <code>npm run replays</code>.</p>}
        {!g && !error && <p className="text-[14px] text-fg-faint">Loading…</p>}

        {g && (
          <>
            <Section id="party" title="The party"
              intro={<>Most abilities trigger a {g.gcd_s} s global cooldown. Melee range is {g.melee_range_m} m from the target's edge. Moving cancels a cast in progress.</>}>
              <div className="space-y-10">
                {g.party.map((m) => (
                  <article key={m.id} id={m.id} className="scroll-mt-20 rounded-xl border border-line p-5 sm:p-6">
                    <header className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-[20px] font-medium" style={{ color: CLASS_COLORS[m.class] }}>
                        <RoleIcon role={m.role} size={16} />{m.name}
                      </h3>
                      <span className="text-[13px] text-fg-faint">
                        {m.class_name}, {ROLE_LABEL[m.role] ?? m.role}, {fmtNum(m.max_hp)} health
                        {m.auto_attack && `, melee swing ${fmtNum(m.auto_attack.amount)} every ${m.auto_attack.every_s} s`}
                      </span>
                    </header>
                    <p className="mt-2 text-[14px] leading-6 text-fg-muted">{BLURB[m.id]}</p>
                    <ul className="mt-2 divide-y divide-line">
                      {m.abilities.map((a) => <AbilityRow key={a.id} a={a} />)}
                    </ul>
                  </article>
                ))}
              </div>
            </Section>

            <Section id="enemies" title="Enemies"
              intro="The Gravecrown Crypt: two packs of undead, then Mortisar. The agents learn all of this by fighting it.">
              <div className="space-y-8">
                {g.trash.map((t) => (
                  <article key={t.id} className="rounded-xl border border-line p-5 sm:p-6">
                    <header className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-[18px] text-fg">{t.name}</h3>
                      <span className="text-[13px] text-fg-faint">{fmtNum(t.max_hp)} health, {t.melee ? 'melee: chases its target' : 'caster: stands and casts'}</span>
                    </header>
                    {t.spells.length > 0 && <ul className="mt-2 divide-y divide-line">{t.spells.map((a) => <AbilityRow key={a.id} a={a} enemy />)}</ul>}
                  </article>
                ))}
                <article className="rounded-xl border border-line p-5 sm:p-6">
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[18px] text-fg">{g.boss.name}</h3>
                    <span className="text-[13px] text-fg-faint">{fmtNum(g.boss.max_hp)} health, summons adds at {g.boss.adds_at_pct.join('% and ')}% health</span>
                  </header>
                  <ul className="mt-2 divide-y divide-line">{g.boss.abilities.map((a) => <AbilityRow key={a.id} a={a} enemy />)}</ul>
                </article>
              </div>
            </Section>

            <Section id="difficulty" title="Difficulty and affixes"
              intro={<>The headline score is +10. Normal is a sanity check. Affixes are always visible to the agents, as in the game. <Link to="/watch" className="text-fg underline decoration-white/30 underline-offset-4">Watch a run</Link> to see them in play.</>}>
              <div className="grid gap-6 md:grid-cols-2">
                {g.tiers.map((t) => (
                  <article key={t.id} className="rounded-xl border border-line p-5">
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
            </Section>
          </>
        )}
      </div>
    </Page>
  )
}
