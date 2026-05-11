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

### Attaching to a Projects v2 board

After the issues are seeded, you can mirror them onto a GitHub Project board.
This requires the `gh` CLI token to carry the `project` scope, which it
doesn't grab by default:

```powershell
# One-time scope refresh — opens a browser to consent
gh auth refresh -s read:project,project

# Create the "TCG Studio" project (if missing) and attach every issue
.\scripts\seed-issues.ps1 -Apply -CreateProject

# Or attach to an existing project by number
.\scripts\seed-issues.ps1 -Apply -ProjectNumber 1
```

### Wiring the deploy workflow to the project

The deploy workflow can attach the auto-managed **Build status** issue to the
project on every push. The default `GITHUB_TOKEN` can't touch Projects v2, so
the workflow needs a PAT with `project` scope stored as a repository secret:

| Secret           | Value                                          |
| ---------------- | ---------------------------------------------- |
| `PROJECT_TOKEN`  | PAT with `project` scope (classic) or `Projects: read-write` (fine-grained) |
| `PROJECT_OWNER`  | `bloodchild8906` (optional; defaults to this)  |
| `PROJECT_NUMBER` | The project number from `gh project list`      |

When any of these are missing the project-attach step silently skips.

### Initialize the wiki (one-time)

The deploy workflow writes to the repository wiki, but GitHub requires the
wiki to be initialized manually once before clone/push will work. To do
this:

1. In a browser, open
   <https://github.com/bloodchild8906/tcg-studio/wiki>
2. Click **Create the first page** and save anything (the deploy workflow
   will overwrite it on the next push).

Until that's done the **Update wiki** step in the workflow logs a failure
and continues (it's wrapped in `continue-on-error: true`).
