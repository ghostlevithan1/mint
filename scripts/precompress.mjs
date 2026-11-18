// Writes Brotli (.br) and gzip (.gz) copies of the built text files, so the
// server sends them as they are instead of compressing on Render's small CPU.
// Run by `scripts/build.mjs`.
//
// Brotli's top quality costs far more deploy time than it saves bytes: on the
// 1.3 MB PDF worker, quality 11 takes about 1.3 s for 318 KB while quality 9
// takes 50 ms for 353 KB. Large files therefore use quality 9, and the small
// text files (which are what a page load needs) keep the better quality 10.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { promisify } from 'node:util'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map', '.ttf'])
const MIN_BYTES = 1024
/** Above this size, use the faster Brotli setting. */
const LARGE_BYTES = 512 * 1024
/** Files are compressed a few at a time, so I/O and CPU both stay busy. */
const PARALLEL = 4

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)])),
  )
  return nested.flat()
}

let before = 0
let after = 0
let count = 0

async function compress(file, body) {
  const [br, gzipped] = await Promise.all([
    brotli(body, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: body.byteLength > LARGE_BYTES ? 9 : 10,
        [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
      },
    }),
    // gzip is only the fallback for clients without Brotli, so its fastest
    // useful setting is enough.
    gz(body, { level: 6 }),
  ])
  // A copy that is not smaller is pointless; the server falls back to the original.
  if (br.byteLength < body.byteLength) await writeFile(`${file}.br`, br)
  if (gzipped.byteLength < body.byteLength) await writeFile(`${file}.gz`, gzipped)
  before += body.byteLength
  after += Math.min(br.byteLength, body.byteLength)
  count += 1
}

const targets = (await files('dist')).filter(
  (file) => COMPRESSIBLE.has(extname(file).toLowerCase()) && !file.endsWith('.br') && !file.endsWith('.gz'),
)
let cursor = 0
await Promise.all(
  Array.from({ length: Math.min(PARALLEL, targets.length) }, async () => {
    while (cursor < targets.length) {
      const file = targets[cursor]
      cursor += 1
      const body = await readFile(file)
      if (body.byteLength < MIN_BYTES) continue
      await compress(file, body)
    }
  }),
)
console.log(`precompressed ${count} files: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB with Brotli`)
