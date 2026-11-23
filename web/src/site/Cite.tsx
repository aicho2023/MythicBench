// Author-year citations for the report: <Cite k="reflexion" /> renders
// "(Shinn et al., 2023)" linking to its entry in the reference list, and
// <Cite k="reflexion" t /> renders "Shinn et al. (2023)" for use in a sentence.
import { REFS, type Ref } from '../content/references'

const byKey = new Map(REFS.map((r) => [r.key, r]))

function ref(k: string): Ref {
  const r = byKey.get(k)
  if (!r) throw new Error(`Unknown reference: ${k}`)
  return r
}

/** "Shinn et al., 2023" -> ["Shinn et al.", "2023"] */
const split = (cite: string): [string, string] => {
  const i = cite.lastIndexOf(', ')
  return i < 0 ? [cite, ''] : [cite.slice(0, i), cite.slice(i + 2)]
}

export function Cite({ k, t = false }: { k: string | string[]; t?: boolean }) {
  const keys = Array.isArray(k) ? k : [k]
  const links = keys.map((key, i) => {
    const r = ref(key)
    const [who, year] = split(r.cite)
    return (
      <span key={key}>
        {i > 0 && '; '}
        <a href={`#ref-${key}`} className="cite">{t ? <>{who} ({year})</> : r.cite}</a>
      </span>
    )
  })
  return t ? <>{links}</> : <>({links})</>
}

/** The numbered-by-order reference list, alphabetical by first author. */
export function References() {
  const sorted = [...REFS].sort((a, b) => a.full.localeCompare(b.full))
  return (
    <ol className="refs">
      {sorted.map((r) => (
        <li key={r.key} id={`ref-${r.key}`}>
          {r.full}{' '}
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="break-all">{r.url.replace(/^https?:\/\//, '')}</a>
        </li>
      ))}
    </ol>
  )
}
