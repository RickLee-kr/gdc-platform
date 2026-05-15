import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Browser hits same-origin `/api/...`; Vite forwards to the FastAPI process (see `frontend/src/api.ts`). */
const API_PROXY_TARGET = process.env.VITE_DEV_API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    /** 0.0.0.0 = LAN·공인 IP로 들어오는 접속도 수락 (127.0.0.1 전용이 아님) */
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: false,
    proxy: {
      '/api': { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
})
