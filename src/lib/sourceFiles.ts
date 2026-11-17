/**
 * Which files are source code or plain text, and how to read them: a long list
 * of languages and config formats, extensionless names such as Dockerfile,
 * Jupyter notebooks, UTF-16 files, and a content check for anything unknown.
 */

const words = (list: string) => list.split(/\s+/).filter(Boolean)

/** Programming, markup, query and shell languages. */
export const CODE_EXTENSIONS = new Set(
  words(`
    js jsx mjs cjs ts tsx mts cts vue svelte astro html htm xhtml css scss sass less
    py pyi pyw rb rake gemspec php phtml pl pm lua r rmd jl dart
    c h cc cpp cxx c++ hpp hh hxx ino cu cuh m mm
    cs csx fs fsx fsi vb vbs java kt kts scala sc groovy gradle swift
    go rs zig nim v hs lhs ml mli ex exs erl hrl clj cljs cljc edn lisp lsp el scm rkt
    sol asm s
    sh bash zsh fish ksh ps1 psm1 psd1 bat cmd
    sql psql graphql gql proto tf tfvars hcl prisma
    json jsonc json5 jsonl ndjson ipynb svg cmake mk make
  `),
)

/** Configuration, documents and other plain text. */
export const PLAIN_TEXT_EXTENSIONS = new Set(
  words(`
    txt text md markdown mdx rst adoc asciidoc org tex bib log out
    yml yaml toml ini cfg conf config properties env xml xsl xsd plist tsv
    gitignore gitattributes dockerignore editorconfig npmrc prettierrc eslintrc babelrc
    diff patch srt vtt
  `),
)

/** Files with no extension that are still text, written as `Dockerfile`. */
const SPECIAL_NAMES = new Set(
  words(`
    dockerfile containerfile makefile gnumakefile cmakelists gemfile rakefile procfile
    jenkinsfile vagrantfile brewfile podfile fastfile justfile license licence readme
    changelog authors contributors codeowners notice
  `),
)

export function isCodeExtension(extension: string): boolean {
  return CODE_EXTENSIONS.has(extension)
}

export function isTextExtension(extension: string): boolean {
  return CODE_EXTENSIONS.has(extension) || PLAIN_TEXT_EXTENSIONS.has(extension) || SPECIAL_NAMES.has(extension)
}

/** The extension, or the whole name for a known extensionless file such as `Dockerfile`. */
export function extensionOfName(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const parts = base.split('.')
  if (parts.length > 1) return parts.pop()!.toLowerCase()
  const lower = base.toLowerCase()
  return SPECIAL_NAMES.has(lower) ? lower : ''
}

/** Reads text bytes, honouring UTF-8 and UTF-16 byte-order marks. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '')
}

/** True when the start of a file reads as text rather than binary data. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (!bytes.length) return false
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true
  const sample = bytes.subarray(0, 8192)
  let control = 0
  for (const byte of sample) {
    if (byte === 0) return false
    if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) control += 1
  }
  if (control / sample.length > 0.01) return false
  // A cut-off multi-byte character at the end of the sample is not an error.
  const decoded = new TextDecoder('utf-8').decode(sample.subarray(0, Math.max(0, sample.length - 3)))
  const broken = decoded.split('\uFFFD').length - 1
  return broken / Math.max(1, decoded.length) < 0.02
}

const NOTEBOOK_OUTPUT_LIMIT = 2000

type NotebookCell = {
  cell_type?: string
  source?: string | string[]
  outputs?: { output_type?: string; text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string }[]
}

const joinLines = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join('') : (value ?? ''))

/** A Jupyter notebook as Markdown: prose cells as written, code cells fenced, text outputs kept, images dropped. */
export function notebookToMarkdown(json: string): string | undefined {
  let notebook: {
    cells?: NotebookCell[]
    metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } }
  }
  try {
    notebook = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!notebook || !Array.isArray(notebook.cells)) return undefined
  const language = (notebook.metadata?.language_info?.name ?? notebook.metadata?.kernelspec?.language ?? 'python').toLowerCase()

  const out: string[] = []
  for (const cell of notebook.cells) {
    const source = joinLines(cell.source).trimEnd()
    if (cell.cell_type === 'code') {
      if (source.trim()) out.push(`\`\`\`${language}\n${source}\n\`\`\``)
      for (const output of cell.outputs ?? []) {
        const text =
          output.output_type === 'error'
            ? `${output.ename ?? 'Error'}: ${output.evalue ?? ''}`
            : joinLines(output.text ?? output.data?.['text/plain'])
        const clean = text.replace(/\u001b\[[0-9;]*m/g, '').trim()
        if (clean) {
          const clipped = clean.length > NOTEBOOK_OUTPUT_LIMIT ? `${clean.slice(0, NOTEBOOK_OUTPUT_LIMIT)}\n… (output cut off)` : clean
          out.push(`Output:\n\`\`\`text\n${clipped}\n\`\`\``)
        }
      }
    } else if (source.trim()) {
      out.push(source)
    }
  }
  return out.length ? out.join('\n\n') : undefined
}
