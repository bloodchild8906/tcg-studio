# Seed-issues.ps1
#
# One-time bootstrap: mirror the local task list into GitHub issues
# for the repository so the project board reflects what's been done
# and what's still in flight.
#
# Mapping
#   completed       → issue closed (state_reason: completed) + label `status:done`
#   in_progress     → issue open                              + label `status:in-progress`
#   pending         → issue open                              + label `status:pending`
#
# Each issue's title is prefixed with `#<task-id>` so it's stable
# under re-runs of this script (the search query finds the existing
# issue and updates it in place instead of duplicating).
#
# Run from E:\Tcg\TcgStudio. Requires:
#   - gh CLI authenticated as a user with push access to
#     bloodchild8906/tcg-studio
#   - PowerShell 7+ (or Windows PowerShell 5.1)
#
# Dry-run by default; pass -Confirm:$false (or -Apply) to actually
# create/update issues.

[CmdletBinding()]
param(
    [switch]$Apply = $false,
    [string]$Repo = "bloodchild8906/tcg-studio",
    [string]$TasksJson = "scripts\tasks.json",
    # Project (v2) settings. If -ProjectNumber is set the script also
    # adds every seeded issue to that project. If -CreateProject is set
    # without -ProjectNumber the script will create a "TCG Studio"
    # project on the repo's owner and use it.
    [string]$ProjectOwner = "bloodchild8906",
    [string]$ProjectTitle = "TCG Studio",
    [int]$ProjectNumber = 0,
    [switch]$CreateProject = $false
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $TasksJson)) {
    throw "Tasks JSON not found at $TasksJson. Run from the repo root."
}

$tasks = Get-Content $TasksJson -Raw | ConvertFrom-Json

# Ensure the three status labels exist. `gh label create` 422s on
# duplicate — we swallow that.
$labels = @(
    @{ name = "status:pending";     color = "EDEDED"; desc = "Pending — not yet started" },
    @{ name = "status:in-progress"; color = "FBCA04"; desc = "Currently being worked on" },
    @{ name = "status:done";        color = "0E8A16"; desc = "Completed task" },
    @{ name = "type:task";          color = "BFD4F2"; desc = "Tracked work item from the local task list" }
)
foreach ($l in $labels) {
    if ($Apply) {
        gh label create $l.name --color $l.color --description $l.desc --repo $Repo 2>$null
    } else {
        Write-Host "(dry-run) ensure label $($l.name)"
    }
}

# Pull existing issues once so we can match by `#<id>` prefix and avoid
# making 225 list calls.
Write-Host "Loading existing issues from $Repo ..."
$existingJson = gh issue list --repo $Repo --state all --limit 500 --json number,title,state 2>$null
if (-not $existingJson) { $existingJson = "[]" }
$existing = $existingJson | ConvertFrom-Json

# Build a lookup: issueByTaskId[<id>] = { number; state }
$issueByTaskId = @{}
foreach ($iss in $existing) {
    if ($iss.title -match '^#(\d+)\s') {
        $tid = [int]$matches[1]
        $issueByTaskId[$tid] = $iss
    }
}

$total = $tasks.Count
$idx = 0
# GitHub's secondary rate limit is generous but not infinite; pause
# briefly between calls so 225 issues don't get throttled in a single
# burst.
$pause = [TimeSpan]::FromMilliseconds(250)
foreach ($t in $tasks) {
    $idx++
    $tid = [int]$t.id
    $title = "#$tid $($t.subject)"
    $body = @"
Mirrored from local task list (id=$tid).

Status: **$($t.status)**

$($t.description)

---
This issue is auto-managed by `scripts/seed-issues.ps1`. Do not change the title prefix `#$tid` — the script uses it to match.
"@

    $statusLabel = switch ($t.status) {
        "completed"  { "status:done" }
        "in_progress" { "status:in-progress" }
        default       { "status:pending" }
    }
    # gh wants comma-separated labels for --label.
    $labelArgs = @("--label", "type:task", "--label", $statusLabel)

    # Build the label-remove list: every status label except the one
    # we want. This keeps the issue's label set clean across re-runs.
    $removeLabels = @("status:pending", "status:in-progress", "status:done") |
        Where-Object { $_ -ne $statusLabel }

    if ($issueByTaskId.ContainsKey($tid)) {
        $existingIssue = $issueByTaskId[$tid]
        Write-Host "[$idx/$total] update #$($existingIssue.number) $title"
        if ($Apply) {
            $editArgs = @(
                $existingIssue.number, "--repo", $Repo,
                "--title", $title, "--body", $body,
                "--add-label", "type:task",
                "--add-label", $statusLabel
            )
            foreach ($rm in $removeLabels) {
                $editArgs += "--remove-label"
                $editArgs += $rm
            }
            gh issue edit @editArgs 2>$null
            # State sync — close completed, reopen anything that's now back in flight.
            if ($t.status -eq "completed" -and $existingIssue.state -ne "CLOSED") {
                gh issue close $existingIssue.number --repo $Repo --reason completed 2>$null
            } elseif ($t.status -ne "completed" -and $existingIssue.state -eq "CLOSED") {
                gh issue reopen $existingIssue.number --repo $Repo 2>$null
            }
        }
    } else {
        Write-Host "[$idx/$total] create $title"
        if ($Apply) {
            $createOutput = gh issue create --repo $Repo --title $title --body $body @labelArgs 2>$null
            if ($t.status -eq "completed" -and $createOutput -match "/issues/(\d+)") {
                $num = $matches[1]
                gh issue close $num --repo $Repo --reason completed 2>$null
            }
        }
    }
    if ($Apply) { Start-Sleep -Milliseconds $pause.TotalMilliseconds }
}

if (-not $Apply) {
    Write-Host ""
    Write-Host "Dry run complete. Re-run with -Apply to push to GitHub."
    return
}

# ---------------------------------------------------------------------------
# Project board sync (Projects v2).
#
# Optional second phase that attaches every task issue to a GitHub
# Project v2 board so the project view reflects the same task list.
# Requires the `gh` token to carry the `project` scope:
#
#     gh auth refresh -s project,read:project
#
# Without that scope the project sub-commands return "missing required
# scopes [read:project]"; we surface that as a friendly message and
# skip the phase rather than failing the whole seed.
# ---------------------------------------------------------------------------

if ($ProjectNumber -eq 0 -and -not $CreateProject) {
    Write-Host ""
    Write-Host "Skipping project attach (no -ProjectNumber, no -CreateProject)."
    Write-Host "  To attach: pass -ProjectNumber N (existing project), or -CreateProject (mint a new one)."
    return
}

# Probe for project scope before doing anything destructive.
$probe = gh project list --owner $ProjectOwner --format json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warning ""
    Write-Warning "gh CLI is missing the 'project' scope on its token."
    Write-Warning "Run:    gh auth refresh -s read:project,project"
    Write-Warning "Then re-run this script."
    Write-Warning "Skipping project phase."
    return
}

# Resolve or create the project.
if ($ProjectNumber -eq 0) {
    $projects = $probe | ConvertFrom-Json
    $match = $projects.projects | Where-Object { $_.title -eq $ProjectTitle } | Select-Object -First 1
    if ($match) {
        $ProjectNumber = [int]$match.number
        Write-Host "Found existing project '$ProjectTitle' (#$ProjectNumber)."
    } else {
        Write-Host "Creating project '$ProjectTitle' on $ProjectOwner ..."
        $createOutput = gh project create --owner $ProjectOwner --title $ProjectTitle --format json 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "gh project create failed: $createOutput"
            return
        }
        $proj = $createOutput | ConvertFrom-Json
        $ProjectNumber = [int]$proj.number
        Write-Host "Created project #$ProjectNumber."
    }
}

Write-Host ""
Write-Host "Attaching issues to project #$ProjectNumber ..."

# Reload the issue index — the create phase above may have added new
# issues that aren't in our initial $existing snapshot.
$existingJson = gh issue list --repo $Repo --state all --limit 500 --json number,title,url 2>$null
$existing = $existingJson | ConvertFrom-Json
$issueByTaskId = @{}
foreach ($iss in $existing) {
    if ($iss.title -match '^#(\d+)\s') {
        $tid = [int]$matches[1]
        $issueByTaskId[$tid] = $iss
    }
}

$idx = 0
foreach ($t in $tasks) {
    $idx++
    $tid = [int]$t.id
    if (-not $issueByTaskId.ContainsKey($tid)) { continue }
    $iss = $issueByTaskId[$tid]
    Write-Host "[$idx/$total] attach #$($iss.number) → project #$ProjectNumber"
    # `gh project item-add` is idempotent on the URL — re-attaching an
    # already-attached issue 2>&1 returns a "already exists" message
    # which we silently swallow.
    gh project item-add $ProjectNumber --owner $ProjectOwner --url $iss.url 2>$null | Out-Null
    Start-Sleep -Milliseconds 150
}

Write-Host ""
Write-Host "Done. Project #$ProjectNumber now mirrors the task list."
