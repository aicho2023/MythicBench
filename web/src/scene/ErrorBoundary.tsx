import { Component, type ReactNode } from 'react'

/**
 * If the KayKit files are missing (e.g. a fork without assets), fall back to
 * the procedural art instead of crashing the whole scene.
 */
export class AssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[MythicBench] KayKit assets unavailable, using procedural art:', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** `?art=procedural` forces the built-in placeholder art (handy for comparisons). */
export const USE_KAYKIT = new URLSearchParams(location.search).get('art') !== 'procedural'
