# KNOUX X - Local/Remote Bootstrap & Safe Sync
# Canonical local workspace: D:\KNOUX X
# Canonical remote: https://github.com/daynightae-cmyk/knoux-x.git

[CmdletBinding()]
param(
    [string]$Workspace = 'D:\KNOUX X',
    [string]$RepoUrl = 'https://github.com/daynightae-cmyk/knoux-x.git',
    [switch]$Install,
    [switch]$Push,
    [string]$Message = 'chore: synchronize KNOUX X local and remote state'
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

Write-Step 'Checking prerequisites'
Require-Command git

$drive = [System.IO.Path]::GetPathRoot($Workspace)
if (-not (Test-Path $drive)) {
    throw "Drive '$drive' does not exist."
}

if (-not (Test-Path $Workspace)) {
    Write-Step "Cloning KNOUX X into $Workspace"
    git clone $RepoUrl $Workspace
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed.' }
} elseif (-not (Test-Path (Join-Path $Workspace '.git'))) {
    $entries = @(Get-ChildItem -LiteralPath $Workspace -Force -ErrorAction SilentlyContinue)
    if ($entries.Count -gt 0) {
        throw "'$Workspace' exists and is not a Git repository. Nothing was deleted. Move/rename its contents, then run again."
    }
    Write-Step "Cloning into existing empty directory $Workspace"
    git clone $RepoUrl $Workspace
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed.' }
}

Set-Location -LiteralPath $Workspace

Write-Step 'Pinning canonical remote'
$currentOrigin = (git remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0) {
    git remote add origin $RepoUrl
} elseif ($currentOrigin.Trim() -ne $RepoUrl) {
    git remote set-url origin $RepoUrl
}
if ($LASTEXITCODE -ne 0) { throw 'Could not configure origin.' }

Write-Step 'Fetching latest remote state'
git fetch origin --prune --tags
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }

$dirty = -not [string]::IsNullOrWhiteSpace((git status --porcelain))
if ($dirty) {
    Write-Host ''
    Write-Host 'Local uncommitted changes detected. They were NOT reset, stashed, or overwritten.' -ForegroundColor Yellow
    git status --short
    Write-Host ''
    Write-Host 'Commit/push them, or finish the current work, then rerun this script to pull latest main.' -ForegroundColor Yellow
} else {
    Write-Step 'Synchronizing local main with origin/main'
    $mainExists = (git branch --list main).Trim()
    if (-not $mainExists) {
        git checkout -b main --track origin/main
    } else {
        git checkout main
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not switch to main.' }

    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) {
        throw 'Fast-forward-only pull failed. Resolve branch divergence explicitly; this script will not rewrite history.'
    }
}

if ($Install) {
    Write-Step 'Installing deterministic dependencies'
    Require-Command npm
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}

if ($Push) {
    Write-Step 'Preparing local changes for remote synchronization'
    $branch = (git branch --show-current).Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) {
        throw 'Detached HEAD detected. Refusing to commit/push.'
    }

    $hasChanges = -not [string]::IsNullOrWhiteSpace((git status --porcelain))
    if ($hasChanges) {
        git add -A
        git commit -m $Message
        if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }
    } else {
        Write-Host 'No uncommitted changes to commit.'
    }

    Write-Step "Pushing branch '$branch' to origin"
    git push -u origin $branch
    if ($LASTEXITCODE -ne 0) {
        throw 'git push failed. No force push was attempted.'
    }
}

Write-Step 'KNOUX X workspace status'
$sha = (git rev-parse HEAD).Trim()
$branchNow = (git branch --show-current).Trim()
$originMain = (git rev-parse origin/main).Trim()

Write-Host "Workspace  : $Workspace"
Write-Host "Branch     : $branchNow"
Write-Host "HEAD       : $sha"
Write-Host "origin/main: $originMain"
Write-Host ''
git status --short --branch

Write-Host ''
Write-Host 'READY: Use this exact folder for all KNOUX X local work:' -ForegroundColor Green
Write-Host "  $Workspace" -ForegroundColor Green
Write-Host ''
Write-Host 'Installed-user auto-updates are a release/update-channel feature, not Git sync.' -ForegroundColor DarkYellow
Write-Host 'The product agent must implement Windows and Android update delivery in the application/release pipeline.'
