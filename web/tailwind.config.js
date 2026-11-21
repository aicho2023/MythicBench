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
        // Graphite surfaces; the 3D scene supplies the color.
        bg: '#0a0a0c',
        surface: { DEFAULT: '#111113', raised: '#1a1a1d' },
        fg: { DEFAULT: '#ededef', muted: '#a1a1aa', faint: '#8b8b93' },
        line: 'rgba(255,255,255,0.08)',
        // Bone, from the crypt: marks what a model learned. Used rarely.
        accent: '#e6d3a3',
        // Semantic colors only ever mean one thing.
        good: '#4ade80',
        bad: '#f87171',
        warn: '#fbbf24',
        info: '#7dd3fc',
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
