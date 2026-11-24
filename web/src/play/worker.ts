// The game, in a worker: the real simulator (sim/mythicsim, zipped by
// scripts/build_play_bundle.py) running in Pyodide, so the page never freezes
// while it plays a few seconds of the fight. Messages in: {id, op, args};
// out: {id, ok, value | error}. Every value is a JSON string from Python.

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/'

interface Py {
  runPythonAsync: (code: string) => Promise<unknown>
  unpackArchive: (buf: ArrayBuffer, format: string) => void
  globals: { get: (k: string) => (...a: unknown[]) => string }
}

let ready: Promise<Py> | null = null

function boot(): Promise<Py> {
  ready ??= (async () => {
    const mod = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)
    const py: Py = await mod.loadPyodide({ indexURL: PYODIDE })
    const res = await fetch('/play/mythicsim.zip')
    if (!res.ok) throw new Error(`could not load the game (${res.status})`)
    py.unpackArchive(await res.arrayBuffer(), 'zip')
    await py.runPythonAsync('from mythicsim.play import js_start, js_answer, js_replay, js_expert')
    return py
  })()
  return ready
}

self.onmessage = async (e: MessageEvent<{ id: number; op: string; args: unknown[] }>) => {
  const { id, op, args } = e.data
  try {
    const py = await boot()
    const value = op === 'boot' ? '"ok"' : py.globals.get(op)(...args)
    self.postMessage({ id, ok: true, value })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err instanceof Error ? err.message : err) })
  }
}
