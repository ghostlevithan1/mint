# Cloud-side GitHub helper

`scripts/gh.mjs` merges branches and edits files through the GitHub REST API
instead of a local clone. Nothing it does touches your working tree, so there
is no checkout, no stash, and no way for a merge to overwrite uncommitted work.

Conflicts are a separate matter: they come from two branches changing the same
lines, not from where the command runs. The API reports one as HTTP 409 and
changes nothing.

## Setup (one time)

1. Create a token: GitHub → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.

   | Field | Value |
   | --- | --- |
   | Repository access | Only select repositories → `ghostlevithan1/mint` |
   | Contents | Read and write (merge branches, create/update/delete files) |
   | Pull requests | Read and write (list and inspect PRs) |
   | Administration | Read and write — only if you want `protect --apply` |

   A classic token with the `repo` scope also works.

2. Put it in the gitignored `.env` file at the repository root:

   ```ini
   GITHUB_TOKEN=github_pat_...
   ```

   Or set a `GITHUB_TOKEN` environment variable instead; it takes precedence.

3. Verify:

   ```powershell
   node scripts/gh.mjs whoami
   ```

## Commands

Read-only commands work without a token on a public repository.

| Command | What it does |
| --- | --- |
| `whoami` | Token user, token kind, and this repo's permissions |
| `status [branch]` | Branches, branch diff, open PRs, CI state |
| `diff <branch>` | Files and commit count a branch would bring in |
| `prs` | Open pull requests |
| `merge <head> [base]` | Merge on GitHub; previews, needs `--yes` |
| `put <path> --file=<local\|->` | Create or update a file on a branch |
| `delete <path>` | Remove a file from a branch |
| `protect [--apply]` | Require `build` + `smoke`, enable auto-merge |

Examples:

```powershell
node scripts/gh.mjs status claude/nice-keller-h7yref
node scripts/gh.mjs merge claude/nice-keller-h7yref --yes
node scripts/gh.mjs put src/lib/theme.ts --file=theme.ts --message="fix: palette" --yes
Get-Content patch.txt | node scripts/gh.mjs put notes.txt --file=- --yes
npm run gh -- status            # same thing through the package script
```

## Notes

- Every write previews its effect first and refuses to run without `--yes`.
- `put` writes the bytes it is given; there is no CRLF conversion. Save the
  source file with LF endings to match the rest of the repository.
- `protect --apply` requires a token with Administration access. It leaves
  `enforce_admins` off, so you can still push directly if a token or outage
  gets in the way.
- Revoke the token at any time; deleting the line from `.env` is enough to
  disable the helper's writes.
