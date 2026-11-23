// The report's reference list. Every entry was checked against its source
// (title, authors, year, link) before it was added.

export interface Ref {
  key: string
  /** in-text form, "Shinn et al., 2023" */
  cite: string
  /** full reference, author-year style */
  full: string
  url: string
}

export const REFS: Ref[] = []
