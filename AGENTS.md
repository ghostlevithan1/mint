# Project Rules

These rules apply to every human or AI agent working in this repository.

## Git Sync Rules (Mandatory)

1. **Before reading or editing any files, check for a version gap first.**
   Run:

   ```bash
   git fetch origin --prune
   git status -sb
   ```

   Then compare the local branch with its upstream (for example
   `git rev-list --left-right --count main...origin/main`):

   - **Behind** the remote → run `git pull origin main --rebase` (or
     `git pull --rebase` on the current branch) to get the latest code.
   - **Up to date** → do not pull. There is nothing to download, and repeated
     pulls only create noise.
   - **Diverged** (ahead and behind) → pull with rebase and resolve conflicts as
     described below.

2. **Before pushing any commits**, repeat the same check. If the remote moved,
   run `git pull --rebase` again. If there are any merge conflicts with recent
   changes, resolve them carefully without deleting existing features.

## Downloads and Dependencies

Only download something when it is needed for the task or when a version
mismatch is proven.

- If no version problem is found, do not download or install anything.
- Run `npm install` / `npm ci` only when `package.json` or `package-lock.json`
  changed, `node_modules` is missing, or a command fails because a dependency is
  missing or on the wrong version.
- Do not upgrade dependencies, models, tools, or assets, and do not add new
  ones, unless the task requires it or the owner asks.
- If a version problem is found, download the matching latest version — not an
  arbitrary newer one, and not a different package as a workaround.
- A download that serves a different, clearly stated purpose (for example
  fetching an asset the task needs) is allowed; say why before doing it.

### Working safely with these rules

- If `git pull --rebase` refuses to run because of uncommitted changes, commit
  or stash your work first, then pull. Never discard, overwrite, or check out
  over someone else's uncommitted changes.
- Resolve conflicts by keeping both sets of intended changes wherever possible.
  Do not use `--force`, `--theirs`, `--ours`, or a hard reset to make a conflict
  disappear.
- After resolving conflicts, run the project checks (`npx tsc -b`,
  `npm test`, `npm run build`) before pushing.
- If the pull cannot be completed safely, stop and ask the repository owner
  instead of pushing anyway.
