// Site-wide settings.

/** Folder under web/public holding `python -m mythicsim results <protocol> --out <dir>`
 * (build with VITE_RESULTS_DIR to show another dataset). */
export const RESULTS_DIR: string = import.meta.env.VITE_RESULTS_DIR ?? 'results/v1'

/** URL of a file inside the results dataset. */
export const resultsUrl = (path: string) => `${import.meta.env.BASE_URL}${RESULTS_DIR}/${path}`

/**
 * Show the non-model runs (the mock model and the scripted commander) on the
 * site. Off for visitors: the public site shows real models only.
 * Turn on for local work with VITE_SHOW_REFERENCE=1 (e.g. `VITE_SHOW_REFERENCE=1 npm run dev`).
 */
export const SHOW_REFERENCE_RUNS: boolean = import.meta.env.VITE_SHOW_REFERENCE === '1'

/** Providers that aren't a real model. */
export const REFERENCE_PROVIDERS = ['mock', 'scripted']

export const GITHUB_URL = 'https://github.com/aicho2023/MythicBench'
export { SITE_URL } from './meta'
/** Donations fund runs on more and stronger models. */
export const VENMO_HANDLE = 'ach1492'
export const VENMO_URL = `https://venmo.com/u/${VENMO_HANDLE}`

/**
 * The home clip, and where plain /watch opens: the top model's
 * best +10 pull (Claude Opus 5.5, group 2, pull 2), over a stretch of the boss
 * fight with a Bone Pyre soaked by the whole party. Seconds into the pull.
 */
export const HERO_WINDOW_S: [number, number] = [146, 198]
