import { Sword } from 'lucide-react'
import type { ReactNode } from 'react'
import { ICONS, SCHOOL_COLORS } from '../content/display'
import type { AbilityInfo } from '../replay/types'

/** Square spell icon with an optional cooldown sweep. */
export function AbilityIcon({
  ability, info, size = 22, remainingMs = 0, totalMs = 0, label, harmful = false, title,
}: {
  ability: string
  info?: Pick<AbilityInfo, 'icon' | 'school' | 'name'> & { harmful?: boolean }
  size?: number
  remainingMs?: number
  totalMs?: number
  label?: string
  harmful?: boolean
  title?: string
}) {
  const Icon = ICONS[info?.icon ?? ''] ?? Sword
  const col = SCHOOL_COLORS[info?.school ?? 'physical'] ?? '#ddd'
  const frac = totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-[5px]"
      style={{
        width: size, height: size,
        background: harmful ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.06)',
        boxShadow: `inset 0 0 0 1px ${harmful ? 'rgba(248,113,113,0.45)' : 'rgba(255,255,255,0.10)'}`,
      }}
      title={title ?? info?.name ?? ability}
    >
      <Icon className="absolute inset-0 m-auto" style={{ color: col, opacity: frac > 0 ? 0.45 : 0.95 }} size={size * 0.58} strokeWidth={2} />
      {frac > 0 && (
        <div className="absolute inset-0" style={{ background: `conic-gradient(rgba(0,0,0,0.6) ${frac * 360}deg, transparent 0deg)` }} />
      )}
      {label && (
        <span className="num absolute inset-0 grid place-items-center font-mono text-[9.5px] font-medium text-white [text-shadow:0_1px_2px_#000]">
          {label}
        </span>
      )}
    </div>
  )
}

/** Flat progress bar. Text children are laid out left/right inside it. */
export function Bar({
  frac, color, height = 8, children, absorbFrac = 0, className = '', track = 'rgba(255,255,255,0.07)',
}: {
  frac: number
  color: string
  height?: number
  children?: ReactNode
  absorbFrac?: number
  className?: string
  track?: string
}) {
  const f = Math.max(0, Math.min(1, frac))
  return (
    <div className={`relative overflow-hidden rounded-[3px] ${className}`} style={{ height, background: track }}>
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-150 ease-out"
        style={{ width: `${f * 100}%`, background: color }}
      />
      {absorbFrac > 0 && (
        <div
          className="absolute inset-y-0"
          style={{
            left: `${f * 100}%`, width: `${Math.min(1 - f, absorbFrac) * 100}%`,
            background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0 3px, rgba(255,255,255,0.2) 3px 6px)',
          }}
        />
      )}
      {children && (
        <div className="num absolute inset-0 flex items-center justify-between px-2 text-[11px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
          {children}
        </div>
      )}
    </div>
  )
}

export function secs(ms: number): string {
  if (ms >= 60000) return `${Math.ceil(ms / 60000)}m`
  return ms >= 3000 ? `${Math.ceil(ms / 1000)}` : (ms / 1000).toFixed(1)
}
