// Site-wide settings. Switching the site to the official run is one line:
// set RESULTS_DIR to 'results/v1' (or build with VITE_RESULTS_DIR=results/v1).

/** Folder under web/public holding `python -m mythicsim results <protocol> --out <dir>`. */
export const RESULTS_DIR: string = import.meta.env.VITE_RESULTS_DIR ?? 'results/sample'

/** URL of a file inside the results dataset. */
export const resultsUrl = (path: string) => `${import.meta.env.BASE_URL}${RESULTS_DIR}/${path}`

/**
 * Show the non-model runs (the mock model, the scripted commander, the scripted
 * bots) on the site. Off for visitors: the public site shows real models only.
 * Turn on for local work with VITE_SHOW_REFERENCE=1 (e.g. `VITE_SHOW_REFERENCE=1 npm run dev`).
 */
export const SHOW_REFERENCE_RUNS: boolean = import.meta.env.VITE_SHOW_REFERENCE === '1'

/** Providers that aren't a real model. */
export const REFERENCE_PROVIDERS = ['mock', 'scripted']

export const GITHUB_URL = 'https://github.com/aicho2023/MythicBench'
export const SITE_URL = 'https://mythicbench.com'

/**
 * The home page's clip until official results exist (then it's the top model's
 * best +10 pull, automatically). A real model, never a scripted run: GPT-6.2
 * Sol's pilot pull on +10, which cleared blind on its first try (94.2).
 */
export const FEATURED = {
  id: 'featured:sol-pilot',
  file: 'featured/sol-pilot.json.gz',
  label: 'GPT-6.2 Sol, +10 pilot pull',
  caption: 'GPT-6.2 Sol\'s five agents clear the +10 blind, on their first pull, in a pilot before the official run. Every pull is replayable the same way',
}
export const TEASER_REPLAY = FEATURED.id
/** Where the clip starts playing, in seconds (just before Mortisar is pulled). */
export const TEASER_START_S = 62
