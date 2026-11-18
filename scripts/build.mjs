// The production build. Type checking and the two bundles do not depend on one
// another, so they run together; only the precompression waits for the client
// bundle. On Render this shortens every deploy by the overlap.
import { spawn } from 'node:child_process'

const run = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${file} ${args.join(' ')} exited with ${code ?? signal}`))
    })
  })

const node = process.execPath
try {
  // Type checking overlaps with the client bundle; the two bundles do not run
  // together, so a small Render build instance never runs out of memory.
  await Promise.all([
    run(node, ['node_modules/typescript/bin/tsc', '-b']),
    run(node, ['node_modules/vite/bin/vite.js', 'build']),
  ])
  // The server bundle and precompression are independent. Starting both now
  // means the deploy is ready as soon as the slower one finishes.
  await Promise.all([
    run(node, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.server.config.ts']),
    run(node, ['scripts/precompress.mjs']),
  ])
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
