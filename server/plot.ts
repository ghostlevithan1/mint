import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Renders a plot spec to a PNG by piping it through server/plot.py — a
 * deterministic renderer with no code execution. The child process gets a
 * scrubbed environment (no NVIDIA key, no app state), a scratch matplotlib
 * config dir, a hard timeout, and a capped image size.
 */

export type PlotResult = { image: string } | { code: string; error: string }

const PLOT_SCRIPT = fileURLToPath(new URL('./plot.py', import.meta.url))
const MAX_SPEC_CHARS = 32 * 1024
const MAX_PNG_BYTES = 6 * 1024 * 1024
const MAX_STDERR_BYTES = 4000
const TIMEOUT_MS = 12_000

function pythonBinaries(): string[] {
  const candidates = [process.env.MINT_PYTHON, 'python3', 'python', 'py'].filter(
    (value): value is string => Boolean(value?.trim()),
  )
  return [...new Set(candidates)]
}

function minimalEnv(mplConfigDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    MPLCONFIGDIR: mplConfigDir,
    PYTHONHASHSEED: '0',
  }
  // Enough for the interpreter and matplotlib to start on Linux, macOS and
  // Windows — and nothing from this server's own environment.
  for (const key of [
    'PATH',
    'SystemRoot',
    'SystemDrive',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'LANG',
    'LC_ALL',
  ]) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

function runOnce(binary: string, spec: string, mplConfigDir: string): Promise<PlotResult> {
  return new Promise((resolvePlot) => {
    let stdoutBytes = 0
    let stderr = ''
    let stdoutChunks: Buffer[] = []
    let tooLarge = false
    let timedOut = false
    let settled = false

    const finish = (result: PlotResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePlot(result)
    }

    const child = spawn(binary, [PLOT_SCRIPT], {
      env: minimalEnv(mplConfigDir),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT_MS)

    child.on('error', () => {
      finish({
        code: 'PYTHON_UNAVAILABLE',
        error: 'Python is not available on this server, so plots cannot be rendered.',
      })
    })

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_PNG_BYTES) {
        tooLarge = true
        stdoutChunks = []
        child.kill('SIGKILL')
        return
      }
      stdoutChunks.push(chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr = (stderr + chunk.toString('utf8')).slice(0, MAX_STDERR_BYTES)
      }
    })

    child.stdin.on('error', () => {
      // The child died before reading the spec; 'close' reports the failure.
    })
    child.stdin.write(spec)
    child.stdin.end()

    child.on('close', (code) => {
      if (timedOut) {
        finish({ code: 'RENDER_TIMEOUT', error: 'The plot took too long to render.' })
        return
      }
      if (tooLarge) {
        finish({ code: 'RENDER_TOO_LARGE', error: 'The plot image exceeded the size limit.' })
        return
      }
      if (code === 0) {
        const png = Buffer.concat(stdoutChunks)
        if (png.length < 100 || png[0] !== 0x89 || png[1] !== 0x50) {
          finish({ code: 'RENDER_FAILED', error: 'The plot renderer returned an unreadable image.' })
          return
        }
        finish({ image: `data:image/png;base64,${png.toString('base64')}` })
        return
      }
      if (code === 2) {
        // Validation failures carry a short, user-readable message from the renderer.
        const detail = stderr.trim().slice(0, 240)
        finish({ code: 'SPEC_REJECTED', error: detail || 'The plot spec was rejected.' })
        return
      }
      finish({ code: 'RENDER_FAILED', error: 'The plot renderer failed.' })
    })
  })
}

export async function renderPlot(rawSpec: string): Promise<PlotResult> {
  const spec = rawSpec.trim()
  if (!spec) return { code: 'BAD_SPEC', error: 'Send a plot spec.' }
  if (spec.length > MAX_SPEC_CHARS) {
    return { code: 'SPEC_TOO_LARGE', error: 'The plot spec is too large.' }
  }
  try {
    JSON.parse(spec)
  } catch {
    return { code: 'BAD_SPEC', error: 'The plot spec must be valid JSON.' }
  }

  const mplConfigDir = mkdtempSync(join(tmpdir(), 'mint-mpl-'))
  try {
    let last: PlotResult = {
      code: 'PYTHON_UNAVAILABLE',
      error: 'Python is not available on this server.',
    }
    for (const binary of pythonBinaries()) {
      const result = await runOnce(binary, spec, mplConfigDir)
      if ('code' in result && result.code === 'PYTHON_UNAVAILABLE') {
        last = result
        continue
      }
      return result
    }
    return last
  } finally {
    try {
      rmSync(mplConfigDir, { recursive: true, force: true })
    } catch {
      // Scratch dir cleanup is best-effort.
    }
  }
}
