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
        // Neutral surfaces; the 3D scene supplies the color.
        bg: '#0a0a0c',
        fg: { DEFAULT: '#ededef', muted: '#a1a1aa', faint: '#71717a' },
        line: 'rgba(255,255,255,0.08)',
        // One accent, plus semantic colors that only ever mean one thing.
        accent: '#a78bfa',
        good: '#4ade80',
        bad: '#f87171',
        warn: '#fbbf24',
        info: '#7dd3fc',
      },
      fontSize: {
        label: ['10.5px', { lineHeight: '14px', letterSpacing: '0.06em' }],
      },
    },
  },
  plugins: [],
}
