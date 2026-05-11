# scripts/

Standalone helpers that don't fit inside an app workspace. Run from the repo root.

## seed-issues.ps1

One-time bootstrap (also safe to re-run) that mirrors the local task list
(`scripts/tasks.json`) into GitHub issues on `bloodchild8906/tcg-studio`. The
deploy workflow already updates a single "Build status" issue on every push;
this script is for the per-task issues.

Status mapping:

| Local status | GitHub issue                                  |
| ------------ | --------------------------------------------- |
| `completed`  | closed (state_reason `completed`), label `status:done`         |
| `in_progress`| open, label `status:in-progress`              |
| `pending`    | open, label `status:pending`                  |

Every issue is matched on title prefix `#<id>` so re-runs update existing
issues instead of creating duplicates.

### Usage

```powershell
# Dry-run first — prints what it would do, makes no API calls.
.\scripts\seed-issues.ps1

# Push for real:
.\scripts\seed-issues.ps1 -Apply
```

Requires the `gh` CLI authenticated with push access to the repo.

### Updating the source of truth

When you add or change a task locally, edit `scripts/tasks.json`, then re-run
`seed-issues.ps1 -Apply`. The script is idempotent.
