// Writes Brotli (.br) and gzip (.gz) copies of the built text files, at the
// highest settings, so the server sends them as they are instead of
// compressing on Render's small CPU. Run by `npm run build`.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map', '.ttf'])
const MIN_BYTES = 1024

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
for (const file of await files('dist')) {
  if (!COMPRESSIBLE.has(extname(file).toLowerCase())) continue
  const body = await readFile(file)
  if (body.byteLength < MIN_BYTES) continue
  const [br, gzipped] = await Promise.all([
    brotli(body, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
      },
    }),
    gz(body, { level: constants.Z_BEST_COMPRESSION }),
  ])
  // A copy that is not smaller is pointless; the server falls back to the original.
  if (br.byteLength < body.byteLength) await writeFile(`${file}.br`, br)
  if (gzipped.byteLength < body.byteLength) await writeFile(`${file}.gz`, gzipped)
  before += body.byteLength
  after += Math.min(br.byteLength, body.byteLength)
  count += 1
}
console.log(`precompressed ${count} files: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB with Brotli`)
