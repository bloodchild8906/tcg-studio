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
    [string]$TasksJson = "scripts\tasks.json"
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
}
