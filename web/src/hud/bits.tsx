import { Sword } from 'lucide-react'
import type { ReactNode } from 'react'
import { ICONS, SCHOOL_COLORS } from '../content/display'
import type { AbilityInfo } from '../replay/types'

/** Square spell icon with an optional cooldown "clock sweep" overlay. */
export function AbilityIcon({
  ability, info, size = 26, remainingMs = 0, totalMs = 0, label, harmful = false, title,
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
        background: `radial-gradient(circle at 35% 30%, ${col}55, #120e1c 80%)`,
        boxShadow: `inset 0 0 0 1px ${harmful ? '#ff4d6d' : '#c9a24a'}aa, 0 1px 2px #000`,
      }}
      title={title ?? info?.name ?? ability}
    >
      <Icon className="absolute inset-0 m-auto" style={{ color: col }} size={size * 0.62} strokeWidth={2.2} />
      {frac > 0 && (
        <div
          className="absolute inset-0"
          style={{ background: `conic-gradient(rgba(0,0,0,0.72) ${frac * 360}deg, transparent 0deg)` }}
        />
      )}
      {label && (
        <span className="absolute inset-0 grid place-items-center font-body text-[10px] font-extrabold text-white [text-shadow:0_1px_2px_#000,0_0_3px_#000]">
          {label}
        </span>
      )}
    </div>
  )
}

export function Bar({
  frac, color, height = 14, children, absorbFrac = 0, className = '',
}: {
  frac: number
  color: string
  height?: number
  children?: ReactNode
  absorbFrac?: number
  className?: string
}) {
  const f = Math.max(0, Math.min(1, frac))
  return (
    <div
      className={`relative overflow-hidden rounded-[4px] bg-black/70 ring-1 ring-black ${className}`}
      style={{ height }}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-150 ease-out"
        style={{ width: `${f * 100}%`, background: `linear-gradient(180deg, ${color}, ${color}bb 55%, ${color}88)` }}
      />
      {absorbFrac > 0 && (
        <div
          className="absolute inset-y-0"
          style={{
            left: `${f * 100}%`, width: `${Math.min(1 - f, absorbFrac) * 100}%`,
            background: 'repeating-linear-gradient(135deg, #fff8 0 4px, #fff3 4px 8px)',
          }}
        />
      )}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-white/15" />
      {children && (
        <div className="absolute inset-0 flex items-center justify-between px-1.5 font-body text-[11px] font-bold text-white [text-shadow:0_1px_1px_#000,0_0_2px_#000]">
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
