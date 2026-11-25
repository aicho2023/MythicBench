import type { ReactNode } from 'react'

/** One width for every chart tooltip, so they read as one component. */
export const TIP_W = 240

/**
 * The tooltip card every chart and grid on the site uses, positioned inside a `relative`
 * container `w` pixels wide.
 * - `above` (the default): centred over the point (x, y), kept inside the container.
 * - `side`: beside x, flipping to the left near the right edge (for a crosshair on a line chart).
 * `interactive` lets it take taps (the touch version of the Bone Pyre grid has a link in it).
 */
export function Tip({ x, y, w, place = 'above', interactive = false, children }: {
  x: number; y: number; w: number; place?: 'above' | 'side'; interactive?: boolean; children: ReactNode
}) {
  const style = place === 'above'
    ? { left: Math.max(0, Math.min(w - TIP_W, x - TIP_W / 2)), top: y - 8, width: TIP_W, transform: 'translateY(-100%)' }
    : { left: x + 16 + TIP_W > w ? Math.max(8, x - 16 - TIP_W) : x + 16, top: Math.max(0, y - 8), width: TIP_W }
  return (
    <div className={`${interactive ? 'pointer-events-auto' : 'pointer-events-none'} absolute z-20 rounded-lg border border-line bg-surface-raised px-3 py-2 text-[13px] leading-5 shadow-[0_6px_24px_rgba(0,0,0,0.5)]`}
      style={style}>
      {children}
    </div>
  )
}
