/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Cinzel', 'serif'],
        body: ['Nunito', 'system-ui', 'sans-serif'],
      },
      colors: {
        gold: { 300: '#f7dc8f', 400: '#e9c46a', 500: '#c9a24a', 700: '#7a5e22' },
        ink: { 800: '#14121c', 900: '#0b0a10' },
      },
    },
  },
  plugins: [],
}
