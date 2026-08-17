import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API paths are proxied in development so the client can use same-origin
// relative URLs everywhere. In production the Express server serves this build
// from its own origin, so no configuration is needed. Set VITE_API_URL only when
// the backend is hosted somewhere else.
const API_TARGET = process.env.VITE_DEV_API_TARGET || 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/upload': API_TARGET,
      '/allocation': API_TARGET,
      '/health': API_TARGET,
    },
  },
})
