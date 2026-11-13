# Project Rules

These rules apply to every human or AI agent working in this repository.

## Git Sync Rules (Mandatory)

1. **Before reading or editing any files**, always run
   `git pull origin main --rebase` (or the current branch) to get the latest
   updates from GitHub.
2. **Before pushing any commits**, run `git pull --rebase` again. If there are
   any merge conflicts with recent changes, resolve them carefully without
   deleting existing features.

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
