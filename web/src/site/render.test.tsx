// Renders the results components to static HTML from the published dataset
// and compares with the stored snapshots, so a refactor that changes what a
// visitor sees fails here. Run `npx vitest run -u` after an intended change.
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Bar } from '../hud/bits'
import { Cite, References } from './Cite'
import { CostScatter, GroupScores, LearningCurves } from './charts'
import { LeaderboardTable } from './Leaderboard'
import { headlineTier, modelsOnly, type Results } from './results'

// Charts draw to their container's measured width; there is no layout here, so give them one.
vi.mock('./useWidth', () => ({ useWidth: () => [{ current: null }, 960] }))

const load = (path: string): Results => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
/** One tag per line, so a failing snapshot shows the element that changed. */
const html = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/></g, '>\n<')

const datasets: [string, Results][] = [
  ['v1 as visitors see it', modelsOnly(load('../../public/results/v1/leaderboard.json'))],
  ['the sample with its reference runs', load('../../test-data/sample/leaderboard.json')],
]

describe.each(datasets)('%s', (_, results) => {
  const tier = headlineTier(results)
  it('leaderboard table', () => expect(html(<LeaderboardTable results={results} />)).toMatchSnapshot())
  it('cost chart', () => expect(html(<CostScatter results={results} />)).toMatchSnapshot())
  it('group scores chart', () => expect(html(<GroupScores results={results} />)).toMatchSnapshot())
  it('learning curves', () => {
    expect(html(<LearningCurves results={results} tier={tier} />)).toMatchSnapshot()
    expect(html(<LearningCurves results={results} tier={tier} bot={false} />)).toMatchSnapshot()
    expect(html(<LearningCurves results={results} tier={tier} view="memory" />)).toMatchSnapshot()
  })
})

describe('citations', () => {
  it('a citation links to its reference', () => expect(html(<p>As shown <Cite k="reflexion" />.</p>)).toMatchSnapshot())
  it('the reference list, cited works only', () => expect(html(<References only={['swebench', 'reflexion', 'holm']} />)).toMatchSnapshot())
})

describe('hud bars', () => {
  it('health, with and without a shield', () => {
    expect(html(<Bar frac={0.42} color="#4cc38a" height={4} />)).toMatchSnapshot()
    expect(html(<Bar frac={0.42} absorbFrac={0.9} color="#4cc38a" className="mt-0.5" track="transparent" />)).toMatchSnapshot()
    expect(html(<Bar frac={1.7} color="#4cc38a" />)).toMatchSnapshot()
  })
})
