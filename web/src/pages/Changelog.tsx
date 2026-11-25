import { CHANGELOG, type ChangelogEntry } from '../content/changelog'
import { GITHUB_URL } from '../site/config'
import { Page } from '../site/Layout'

const KIND: Record<ChangelogEntry['kind'], string> = { release: 'Release', protocol: 'Protocol', docs: 'Analysis' }

function Entry({ e }: { e: ChangelogEntry }) {
  return (
    <section id={e.id} className="scroll-mt-20 border-t border-line pt-8 md:grid md:grid-cols-[140px_minmax(0,1fr)] md:gap-8">
      <div className="mb-3 md:mb-0">
        <p className="font-mono text-[12px] text-fg-faint">{e.date}</p>
        <p className="mt-1 text-[12px] text-accent/80">{KIND[e.kind]}</p>
      </div>
      <div>
        <h2 className="text-[17px] font-medium text-fg">{e.title}</h2>
        {(e.versions || e.tag) && (
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[12px]">
            {e.versions && (['harness', 'sim', 'content'] as const).map((k) => (
              <span key={k} className="rounded-md border border-line px-2 py-0.5 text-fg-muted">{k} {e.versions![k]}</span>
            ))}
            {e.tag && (
              <a href={`${GITHUB_URL}/releases/tag/${e.tag}`} className="rounded-md border border-line px-2 py-0.5 text-fg-muted transition-colors hover:border-white/20 hover:text-fg">
                tag {e.tag}
              </a>
            )}
          </div>
        )}
        <p className="mt-3 text-[15px] leading-6 text-fg-muted">{e.summary}</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-6 text-fg-muted marker:text-fg-faint">
          {e.items.map((it) => <li key={it}>{it}</li>)}
        </ul>
      </div>
    </section>
  )
}

/** /changelog: what changed in the game and the harness, newest first (content/changelog.ts). */
export function Changelog() {
  return (
    <Page>
      <article className="mx-auto max-w-[820px] space-y-10 py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">Changelog</h1>
          <p className="mt-4 max-w-[640px] text-[17px] leading-7 text-fg-muted">
            What changed in the game and the harness, newest first. Results from different versions are never mixed.
          </p>
        </header>
        {CHANGELOG.map((e) => <Entry key={e.id} e={e} />)}
      </article>
    </Page>
  )
}
