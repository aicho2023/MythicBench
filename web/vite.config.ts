/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base: './'` keeps asset paths relative, so the built site can later live
// under any sub-path (e.g. yoursite.com/research/mythicbench/).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: true, port: 5173 },
  test: { environment: 'node' },
})
