import { useEffect, useState } from 'react'
import { fetchResults, type Results } from './results'

/** The results dataset, or an error message while it can't be loaded. */
export function useResults(): { results: Results | null; error: string | null } {
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetchResults().then((r) => live && setResults(r), (e) => live && setError(String(e.message ?? e)))
    return () => { live = false }
  }, [])
  return { results, error }
}
