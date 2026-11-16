import { defineConfig } from 'vite'

/**
 * Compiles the server into one plain JavaScript file (dist-server/index.js), so
 * production runs on bare Node. Running the TypeScript directly through tsx
 * loaded a compiler on every cold start, which cost time and memory on Render's
 * small instance. The server only uses Node's built-in modules.
 */
export default defineConfig({
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
})
