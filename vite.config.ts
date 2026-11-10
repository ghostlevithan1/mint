import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mintNvidiaProxy } from './server/nvidia'

export default defineConfig({
  plugins: [react(), mintNvidiaProxy()],
})
