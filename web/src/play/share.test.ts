import { describe, expect, it } from 'vitest'
import { decode, encode, headline, shareText } from './share'
import { groupScore, seedOf, todaysVault } from './store'

describe('share links', () => {
  const r = { vault: 3, tier: 'normal' as const, seat: 'kit', pulls: [{ score: 34.1, cleared: false }, { score: 82.4, cleared: true }] }
  it('round-trip through the address', () => {
    const url = new URL(encode(r))
    expect(url.pathname).toBe('/play')
    expect(decode(url.search)).toEqual(r)
  })
  it('reject anything malformed', () => {
    expect(decode('?v=0&t=normal&s=kit&r=10')).toBeNull()
    expect(decode('?v=2&t=hard&s=kit&r=10')).toBeNull()
    expect(decode('?v=2&t=normal&s=bob&r=10')).toBeNull()
    expect(decode('?v=2&t=normal&s=kit&r=999')).toBeNull()
    expect(decode('?v=2&t=normal&s=kit')).toBeNull()
  })
  it('say how it went, without middle dots', () => {
    expect(headline(r)).toBe('Cleared on pull 2')
    expect(shareText(r)).toContain('🟨🟩 Cleared on pull 2')
    expect(shareText(r)).not.toContain('·')
  })
})

describe('scores', () => {
  it('score a group as the leaderboard does: a clear counts for every pull it saved', () => {
    expect(groupScore([{ score: 40, cleared: false }, { score: 80, cleared: true }])).toBe((40 + 80 * 4) / 5)
    expect(groupScore([{ score: 40, cleared: false }])).toBeNull() // unfinished
    expect(groupScore([10, 20, 30, 40, 50].map((score) => ({ score, cleared: false })))).toBe(30)
  })
  it('number vaults by local day from launch, with seeds in the play range', () => {
    expect(todaysVault(new Date(2026, 11, 1, 12).getTime())).toBe(1)
    expect(todaysVault(new Date(2026, 11, 3, 1).getTime())).toBe(3)
    expect(todaysVault(new Date(2026, 10, 20).getTime())).toBe(1)
    expect(seedOf(3, 2)).toBe(50_000_032)
  })
})
