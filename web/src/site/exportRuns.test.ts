// The browser's analysis export, on the committed sample dataset.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { Replay } from '../replay/types'
import { buildExport, crc32, pullRefs, zip } from './exportRuns'
import type { Results } from './results'
import { resultsCatalogRuns } from './watchData'

const dir = join(__dirname, '../../test-data/sample')
const results: Results = JSON.parse(readFileSync(join(dir, 'leaderboard.json'), 'utf8'))
const read = async (file: string): Promise<Replay> => JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString('utf8'))

describe('analysis export', () => {
  const runs = resultsCatalogRuns(results)
  const refs = pullRefs(runs, (_r, it) => it.file)

  it('exports every listed pull, with the protocol roles', async () => {
    const files = await buildExport(refs, results.protocol.max_pulls, 'sample', read)
    // Optional: write the files out to compare with `python -m mythicsim export` (EXPORT_OUT=<dir>).
    const out = process.env.EXPORT_OUT
    if (out) for (const [rel, text] of files) { mkdirSync(dirname(join(out, rel)), { recursive: true }); writeFileSync(join(out, rel), text) }
    const pulls = files.get('pulls.csv')!.trim().split('\n')
    expect(pulls.length - 1).toBe(runs.reduce((a, r) => a + r.items.length, 0))
    const roles = new Set(pulls.slice(1).map((l) => l.split(',')[4]))
    expect([...roles].sort()).toEqual(['baseline', 'control', 'ranked'])
    const stories = [...files.keys()].filter((k) => k.startsWith('groups/'))
    expect(stories.length).toBe(files.get('groups.csv')!.trim().split('\n').length - 1)
    // Every group's score matches the leaderboard's.
    const groups = files.get('groups.csv')!.trim().split('\n').slice(1).map((l) => l.split(','))
    for (const row of results.leaderboard) {
      for (const [tier, cell] of Object.entries(row.tiers)) {
        const mine = groups.filter((g) => g[0] === row.model && g[3] === tier && g[4] === 'ranked').map((g) => Number(g[10])).sort((x, y) => x - y)
        expect(mine).toEqual([...(cell.episode_scores ?? [])].sort((x, y) => x - y))
      }
    }
    const story = files.get(stories.find((s) => s.endsWith('ranked-g0.md'))!)!
    expect(story).toContain('## Pull 1')
    expect(story).toContain('### The fight')
    expect(files.get('overview.md')).toContain('## Pull by pull')
    // The same bytes as `python -m mythicsim export` (sim/tests/test_analysis.py checks the same fingerprint).
    const digest = JSON.parse(readFileSync(join(__dirname, '../../../sim/tests/export_sample_digest.json'), 'utf8'))
    const mine = Object.fromEntries([...files].map(([k, v]) => [k, createHash('sha256').update(v).digest('hex')]))
    expect(mine).toEqual(digest)
  })

  it('zips byte-identically, and the zip reads back', async () => {
    const files = new Map([['b.txt', 'hello '.repeat(200)], ['a/c.md', '# hi\n']])
    const a = await zip(files, 'x')
    const b = await zip(new Map([...files].reverse()), 'x')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    // Walk the local headers: names, sizes and CRCs check out.
    const v = new DataView(a.buffer, a.byteOffset, a.byteLength)
    let at = 0
    const seen: Record<string, string> = {}
    while (v.getUint32(at, true) === 0x04034b50) {
      const method = v.getUint16(at + 8, true)
      const crc = v.getUint32(at + 14, true)
      const size = v.getUint32(at + 18, true)
      const n = v.getUint16(at + 26, true)
      const name = Buffer.from(a.subarray(at + 30, at + 30 + n)).toString()
      const body = a.subarray(at + 30 + n, at + 30 + n + size)
      const data = method === 8 ? inflateRawSync(body) : Buffer.from(body)
      expect(crc32(new Uint8Array(data))).toBe(crc)
      seen[name] = data.toString()
      at += 30 + n + size
    }
    expect(seen).toEqual({ 'x/a/c.md': '# hi\n', 'x/b.txt': 'hello '.repeat(200) })
  })

  it('crc32 is the standard one', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('Python rounding', () => {
  it('rounds exact ties to even and everything else like toFixed', async () => {
    const { pyFixed } = await import('./exportRuns')
    expect(pyFixed(5.25, 1)).toBe('5.2') // exact tie: even
    expect(pyFixed(5.75, 1)).toBe('5.8')
    expect(pyFixed(27420.5, 0)).toBe('27420')
    expect(pyFixed(27421.5, 0)).toBe('27422')
    expect(pyFixed(0.175, 2)).toBe('0.17') // not a tie in binary (0.17499...)
    expect(pyFixed(2.675, 2)).toBe('2.67')
    expect(pyFixed(0.125, 2)).toBe('0.12')
    expect(pyFixed(3.14159, 1)).toBe('3.1')
    expect(pyFixed(0, 1)).toBe('0.0')
  })
})
