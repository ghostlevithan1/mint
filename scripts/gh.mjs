#!/usr/bin/env node
/**
 * Cloud-side GitHub operations. Branches are merged and files are edited
 * through the REST API, so none of this touches a local working tree: no
 * checkout, no stash, and no chance of a merge overwriting uncommitted work.
 *
 * Read-only commands work anonymously on a public repository. Anything that
 * writes (merge, put, delete, protect) needs a token in GITHUB_TOKEN, or in
 * the gitignored `.env` / `.env.local` / `key.env` file. See scripts/README.md.
 *
 *   node scripts/gh.mjs whoami
 *   node scripts/gh.mjs status [branch]
 *   node scripts/gh.mjs diff <branch> [--base=main]
 *   node scripts/gh.mjs prs
 *   node scripts/gh.mjs merge <head> [base] [--yes]
 *   node scripts/gh.mjs put <path> --file=<local|-> [--branch=main] [--message=...] [--yes]
 *   node scripts/gh.mjs delete <path> [--branch=main] [--message=...] [--yes]
 *   node scripts/gh.mjs protect [--apply]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://api.github.com'
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BOOLEAN_FLAGS = new Set(['yes', 'apply', 'help', 'json'])

const HELP = `Mint cloud-side GitHub helper

Read-only (no token needed on a public repo):
  whoami                      show the token user and its repo permissions
  status [branch]             branches, the branch diff, open PRs, CI state
  diff <branch> [--base=X]    files and commits a branch would bring in
  prs                         open pull requests

Writes (token required; every one previews and needs --yes):
  merge <head> [base]         merge a branch on GitHub, no local checkout
  put <path> --file=<src|->   create or update a file on a branch
  delete <path>               remove a file from a branch
  protect [--apply]           require CI on the default branch, enable auto-merge

Flags: --repo=owner/name  --base=ref  --head=ref  --branch=ref
       --file=path  --message=text  --yes
`

function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      rest.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      continue
    }
    const name = arg.slice(2)
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags[name] = next
      i += 1
    } else {
      flags[name] = true
    }
  }
  return { flags, rest }
}

class GhError extends Error {}

function fail(message) {
  throw new GhError(message)
}

/** Token from the environment first, then the ignored key files. */
function findToken() {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  for (const file of ['.env', '.env.local', 'key.env']) {
    const path = resolve(ROOT, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(?:GITHUB_TOKEN|GH_TOKEN)\s*=\s*(.*)$/)
      if (!match) continue
      const value = match[1].trim().replace(/^['"]|['"]$/g, '')
      if (value) return value
    }
  }
  return ''
}

function findRepo(flags) {
  if (flags.repo) return flags.repo
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (match) return `${match[1]}/${match[2]}`
  } catch {
    // fall through to the explicit flag below
  }
  return fail('could not read the origin remote; pass --repo=owner/name')
}

async function api(path, { method = 'GET', body, auth = 'optional' } = {}) {
  const token = findToken()
  if (auth === 'required' && !token) {
    fail('no GitHub token found; add GITHUB_TOKEN=... to .env (see scripts/README.md)')
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mint-gh-helper',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // keep the raw text so the caller can print it
  }
  return { status: response.status, ok: response.ok, data, headers: response.headers }
}

function apiError(result, context) {
  const detail =
    result.data && typeof result.data === 'object' && result.data.message
      ? result.data.message
      : `HTTP ${result.status}`
  return `${context}: ${detail}`
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function defaultBranch(repo) {
  const info = await api(`/repos/${repo}`)
  if (!info.ok) fail(apiError(info, `read ${repo}`))
  return info.data.default_branch
}

function printFiles(files, limit = 20) {
  for (const file of files.slice(0, limit)) {
    const mark = file.status === 'added' ? 'A' : file.status === 'removed' ? 'D' : 'M'
    console.log(`  ${mark} ${file.filename} (+${file.additions}/-${file.deletions})`)
  }
  if (files.length > limit) console.log(`  ... ${files.length - limit} more files`)
}

async function compare(repo, base, head) {
  const result = await api(`/repos/${repo}/compare/${base}...${head}`)
  if (!result.ok) fail(apiError(result, `compare ${base}...${head}`))
  return result.data
}

async function commandWhoami(flags) {
  const token = findToken()
  if (!token) fail('no token found; add GITHUB_TOKEN=... to .env (see scripts/README.md)')
  const user = await api('/user', { auth: 'required' })
  if (!user.ok) fail(apiError(user, 'read token user'))
  const scopes = user.headers.get('x-oauth-scopes')
  console.log(`token user: ${user.data.login}`)
  console.log(`token kind: ${scopes === null ? 'fine-grained' : `classic (${scopes || 'no scopes'})`}`)
  const repo = findRepo(flags)
  const info = await api(`/repos/${repo}`)
  if (!info.ok) fail(apiError(info, `read ${repo}`))
  console.log(`repo:       ${repo} (${info.data.private ? 'private' : 'public'})`)
  const granted = Object.entries(info.data.permissions ?? {})
    .filter(([, allowed]) => allowed)
    .map(([name]) => name)
  console.log(`permissions: ${granted.length ? granted.join(', ') : 'read only'}`)
}

async function commandStatus(flags, rest) {
  const repo = findRepo(flags)
  const info = await api(`/repos/${repo}`)
  if (!info.ok) fail(apiError(info, `read ${repo}`))
  const base = info.data.default_branch
  const branches = await api(`/repos/${repo}/branches?per_page=100`)
  if (!branches.ok) fail(apiError(branches, 'list branches'))

  console.log(`repo     ${repo} (${info.data.visibility})`)
  console.log(`default  ${base}`)
  console.log('branches')
  for (const branch of branches.data) {
    console.log(`  ${branch.name.padEnd(44)} ${branch.commit.sha.slice(0, 7)}`)
  }

  const target = flags.branch || rest[0]
  if (target && target !== base) {
    const data = await compare(repo, base, target)
    console.log(`\n${target} vs ${base}: ${data.ahead_by} ahead, ${data.behind_by} behind`)
    console.log(`commits: ${data.total_commits ?? 0}, files changed: ${(data.files ?? []).length}`)
    printFiles(data.files ?? [])
  }

  const pulls = await api(`/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=20`)
  if (Array.isArray(pulls.data)) {
    console.log(`\nopen pull requests: ${pulls.data.length}`)
    for (const pull of pulls.data) {
      console.log(`  #${pull.number} ${pull.title} (${pull.head?.ref} -> ${pull.base?.ref})`)
    }
  }

  const head = branches.data.find((branch) => branch.name === base)
  if (head) {
    const checks = await api(`/repos/${repo}/commits/${head.commit.sha}/check-runs`)
    if (checks.ok && Array.isArray(checks.data.check_runs) && checks.data.check_runs.length) {
      console.log(`\nCI on ${base}`)
      for (const run of checks.data.check_runs) {
        console.log(`  ${run.name.padEnd(20)} ${run.status}${run.conclusion ? ` / ${run.conclusion}` : ''}`)
      }
    }
  }
}

async function commandDiff(flags, rest) {
  const repo = findRepo(flags)
  const base = flags.base || (await defaultBranch(repo))
  const head = flags.head || rest[0]
  if (!head) fail('usage: node scripts/gh.mjs diff <branch> [--base=main]')
  const data = await compare(repo, base, head)
  console.log(`${base} -> ${head}: ${data.ahead_by} ahead, ${data.behind_by} behind`)
  console.log(`${data.total_commits ?? 0} commits, ${(data.files ?? []).length} files`)
  printFiles(data.files ?? [], 100)
}

async function commandPrs(flags) {
  const repo = findRepo(flags)
  const result = await api(`/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=30`)
  if (!result.ok) fail(apiError(result, 'list pull requests'))
  if (!result.data.length) {
    console.log('no open pull requests')
    return
  }
  for (const pull of result.data) {
    console.log(`#${pull.number}  ${pull.title}`)
    console.log(`        ${pull.head?.ref} -> ${pull.base?.ref}  ${pull.html_url}`)
  }
}

async function commandMerge(flags, rest) {
  const repo = findRepo(flags)
  const head = flags.head || rest[0]
  const base = flags.base || rest[1] || (await defaultBranch(repo))
  if (!head) fail('usage: node scripts/gh.mjs merge <head> [base] [--yes]')

  if (!flags.yes) {
    const data = await compare(repo, base, head)
    console.log(`would merge ${head} into ${base}`)
    console.log(`${data.ahead_by} commits, ${(data.files ?? []).length} files`)
    printFiles(data.files ?? [])
    console.log('\nnothing changed yet; re-run with --yes to merge on GitHub')
    console.log('conflicts can still appear at merge time; the API reports 409 and changes nothing')
    return
  }

  const result = await api(`/repos/${repo}/merges`, {
    method: 'POST',
    auth: 'required',
    body: {
      base,
      head,
      commit_message: flags.message || `Merge ${head} into ${base}`,
    },
  })
  if (result.status === 201) {
    console.log(`merged ${head} into ${base} as ${result.data.sha.slice(0, 7)}`)
    console.log(result.data.html_url)
    return
  }
  if (result.status === 204) {
    console.log(`${head} is already merged into ${base}; nothing to do`)
    return
  }
  if (result.status === 409) {
    fail(
      `merge conflict between ${head} and ${base}; nothing was changed. ` +
        'Resolve it on a branch, or rebase the branch on GitHub first.',
    )
  }
  fail(apiError(result, `merge ${head} into ${base}`))
}

function readSource(flags, path) {
  const source = flags.file
  if (!source) fail('provide --file=<local path> (use --file=- to read stdin)')
  if (source === '-') return readFileSync(0)
  const resolved = resolve(ROOT, source)
  if (!existsSync(resolved)) fail(`file not found: ${resolved}`)
  return readFileSync(resolved)
}

async function commandPut(flags, rest) {
  const file = typeof flags.file === 'string' ? flags.file : ''
  const path = rest[0] || (file && file !== '-' ? basename(file) : '')
  if (!path) fail('usage: node scripts/gh.mjs put <path> --file=<local|-> [--branch=main]')
  const repo = findRepo(flags)
  const branch = flags.branch || (await defaultBranch(repo))
  const message = flags.message || `chore: update ${path}`
  const bytes = readSource(flags, path)

  if (!flags.yes) {
    console.log(`would write ${bytes.length} bytes to ${repo}:${branch}/${path}`)
    console.log(`commit message: ${message}`)
    console.log('nothing changed yet; re-run with --yes to commit on GitHub')
    return
  }

  const existing = await api(`/repos/${repo}/contents/${encodePath(path)}?ref=${branch}`)
  const sha = existing.ok && existing.data && existing.data.sha ? existing.data.sha : undefined
  const result = await api(`/repos/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    auth: 'required',
    body: {
      message,
      content: bytes.toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    },
  })
  if (!result.ok) fail(apiError(result, `write ${path}`))
  console.log(`${sha ? 'updated' : 'created'} ${path} on ${branch}`)
  console.log(`commit ${result.data.commit.sha.slice(0, 7)}`)
  console.log(result.data.commit.html_url)
}

async function commandDelete(flags, rest) {
  const path = rest[0]
  if (!path) fail('usage: node scripts/gh.mjs delete <path> [--branch=main] [--yes]')
  const repo = findRepo(flags)
  const branch = flags.branch || (await defaultBranch(repo))
  const message = flags.message || `chore: delete ${path}`
  const existing = await api(`/repos/${repo}/contents/${encodePath(path)}?ref=${branch}`)
  if (!existing.ok || !existing.data?.sha) fail(`${path} was not found on ${branch}`)

  if (!flags.yes) {
    console.log(`would delete ${repo}:${branch}/${path}`)
    console.log('nothing changed yet; re-run with --yes to commit on GitHub')
    return
  }

  const result = await api(`/repos/${repo}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    auth: 'required',
    body: { message, branch, sha: existing.data.sha },
  })
  if (!result.ok) fail(apiError(result, `delete ${path}`))
  console.log(`deleted ${path} on ${branch}`)
  console.log(`commit ${result.data.commit.sha.slice(0, 7)}`)
}

async function commandProtect(flags) {
  const repo = findRepo(flags)
  const base = await defaultBranch(repo)
  const current = await api(`/repos/${repo}/branches/${base}/protection`)

  if (!flags.apply) {
    console.log(`repo: ${repo}, default branch: ${base}`)
    if (current.ok) {
      const checks = current.data.required_status_checks
      console.log(`protection: on${checks?.strict ? ' (branch must be up to date)' : ''}`)
      console.log(`required checks: ${checks?.contexts?.join(', ') || 'none'}`)
    } else if (current.status === 404) {
      console.log('protection: off')
    } else if (current.status === 401 || current.status === 403) {
      console.log('protection: unknown (needs a token to inspect)')
    } else {
      console.log(`protection: unknown (${apiError(current, 'read protection')})`)
    }
    const info = await api(`/repos/${repo}`)
    console.log(`auto-merge: ${info.ok && info.data.allow_auto_merge ? 'on' : 'off'}`)
    console.log('re-run with --apply to require build+smoke before merging and enable auto-merge')
    return
  }

  const patch = await api(`/repos/${repo}`, {
    method: 'PATCH',
    auth: 'required',
    body: { allow_auto_merge: true },
  })
  if (!patch.ok) {
    fail(
      apiError(patch, 'enable auto-merge') +
        ' (needs a token with Administration: read and write)',
    )
  }

  const result = await api(`/repos/${repo}/branches/${base}/protection`, {
    method: 'PUT',
    auth: 'required',
    body: {
      required_status_checks: { strict: true, contexts: ['build', 'smoke'] },
      enforce_admins: false,
      required_pull_request_reviews: null,
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
    },
  })
  if (!result.ok) fail(apiError(result, `protect ${base}`))
  console.log(`protected ${base}: build + smoke must pass and the branch must be current`)
  console.log('auto-merge is on; direct pushes still work for admins (enforce_admins is off)')
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2))
  const command = rest.shift() || 'help'

  if (command === 'help' || flags.help) {
    console.log(HELP)
    return
  }

  const commands = {
    whoami: () => commandWhoami(flags),
    status: () => commandStatus(flags, rest),
    diff: () => commandDiff(flags, rest),
    prs: () => commandPrs(flags),
    merge: () => commandMerge(flags, rest),
    put: () => commandPut(flags, rest),
    delete: () => commandDelete(flags, rest),
    protect: () => commandProtect(flags),
  }
  const run = commands[command]
  if (!run) fail(`unknown command "${command}"; try: node scripts/gh.mjs help`)
  await run()
}

main().catch((error) => {
  console.error(`gh: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
