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
 * The replay in the home page's hero. A scripted-bot showcase until the official
 * run exists; afterwards, a model's clearing pull, e.g. 'results:claude-opus-5-5:plus10/e0-p3'.
 */
export const TEASER_REPLAY = 'expert-clear'
/** Where the teaser starts playing, in seconds (the boss room). */
export const TEASER_START_S = 150
