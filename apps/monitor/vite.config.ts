import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The monitor talks to the orders service through /api, proxied in dev and preview, so the
// browser sees one origin and Server-Sent Events work without CORS settings.
const api = {
  '/api': { target: 'http://localhost:3441', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/api/, '') },
  '/inventory': { target: 'http://localhost:3442', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/inventory/, '') },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
})
