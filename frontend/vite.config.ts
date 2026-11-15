import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// MARS_API_TARGET may come from the process environment or a `.env.[mode]` file
// (for example `vite --mode next` reads `.env.next`).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'MARS_')
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': process.env.MARS_API_TARGET ?? env.MARS_API_TARGET ?? 'http://127.0.0.1:8000' },
    },
  }
})
