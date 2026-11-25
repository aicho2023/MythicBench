import { COLOR } from './src/site/tokens'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // One source for every colour: src/site/tokens.ts (code that needs a value imports it too).
        bg: COLOR.bg,
        surface: { DEFAULT: COLOR.surface, raised: COLOR.raised },
        scene: COLOR.scene,
        fg: { DEFAULT: COLOR.fg, muted: COLOR.fgMuted, faint: COLOR.fgFaint },
        off: COLOR.off,
        line: COLOR.line,
        accent: COLOR.accent,
        good: COLOR.good,
        bad: COLOR.bad,
        warn: COLOR.warn,
        info: COLOR.info,
      },
      fontSize: {
        // Small meta and panel titles. Never below 11px over the scene.
        meta: ['11px', { lineHeight: '16px' }],
        label: ['12px', { lineHeight: '16px' }],
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)',
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
