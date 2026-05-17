# attach-to-project.ps1
#
# Standalone helper that attaches every existing #<id>-prefixed issue
# on the repo to a Projects v2 board. Use after seed-issues.ps1 has
# finished creating issues. Idempotent — re-running just re-adds the
# items, which gh treats as a no-op when they're already present.
#
# Default targets the "tcg studio" project (#8) owned by
# bloodchild8906 — the one the user created via the GitHub UI.

[CmdletBinding()]
param(
    [string]$Repo = "bloodchild8906/tcg-studio",
    [string]$ProjectOwner = "bloodchild8906",
    [int]$ProjectNumber = 8,
    [int]$DelayMs = 150
)

$ErrorActionPreference = "Stop"

# Probe scope.
$probe = gh project list --owner $ProjectOwner --format json 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "gh token missing 'project' scope. Run: gh auth refresh -s read:project,project"
}

# Pull every #<id>-prefixed issue (open + closed). Cap at 500 — the
# seeder creates ~225 so this comfortably fits.
$issuesJson = gh issue list --repo $Repo --state all --limit 500 --json number,title,url
$issues = $issuesJson | ConvertFrom-Json | Where-Object { $_.title -match '^#\d+\s' }

Write-Host "Found $($issues.Count) task issues. Attaching to project #$ProjectNumber ..."

$idx = 0
foreach ($iss in $issues) {
    $idx++
    Write-Host "[$idx/$($issues.Count)] attach issue #$($iss.number) ($($iss.title.Substring(0, [Math]::Min(60, $iss.title.Length))))"
    gh project item-add $ProjectNumber --owner $ProjectOwner --url $iss.url 2>$null | Out-Null
    Start-Sleep -Milliseconds $DelayMs
}

Write-Host ""
Write-Host "Done. $($issues.Count) issues attached to project #$ProjectNumber."
