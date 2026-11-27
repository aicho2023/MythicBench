// Author-year citations for the report: <Cite k="reflexion" /> renders
// "(Shinn et al., 2023)" linking to its entry in the reference list.
import { REFS, type Ref } from '../content/references'

const byKey = new Map(REFS.map((r) => [r.key, r]))

function ref(k: string): Ref {
  const r = byKey.get(k)
  if (!r) throw new Error(`Unknown reference: ${k}`)
  return r
}

export function Cite({ k }: { k: string }) {
  return <>(<span><a href={`#ref-${k}`} className="cite">{ref(k).cite}</a></span>)</>
}

/** The reference list, alphabetical by first author: every entry, or only the keys a page cites. */
export function References({ only }: { only?: string[] } = {}) {
  const sorted = REFS.filter((r) => !only || only.includes(r.key)).sort((a, b) => a.full.localeCompare(b.full))
  return (
    <ol className="refs">
      {sorted.map((r) => (
        <li key={r.key} id={`ref-${r.key}`}>
          {r.full}{' '}
          <a href={r.url} target="_blank" rel="noopener noreferrer">{r.url.replace(/^https?:\/\//, '')}</a>
        </li>
      ))}
    </ol>
  )
}
