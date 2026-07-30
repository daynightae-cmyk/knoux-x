[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,

    [Parameter(Mandatory = $false)]
    [string]$NodeHome = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $false)][string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Native command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
    }
}

$repo = (Resolve-Path -LiteralPath $RepositoryRoot).Path
Set-Location -LiteralPath $repo

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to determine the current Git branch.'
}
if ($branch -eq 'main' -or $branch -eq 'master') {
    throw "Refusing to run Phase 01 closeout on protected branch '$branch'."
}

if ([string]::IsNullOrWhiteSpace($NodeHome)) {
    $portable = 'D:\Knoux-X-Bootstrap\.tools\node-v20.20.2-win-x64'
    if (Test-Path (Join-Path $portable 'node.exe')) {
        $NodeHome = $portable
    }
}

if (-not [string]::IsNullOrWhiteSpace($NodeHome)) {
    $nodeExe = Join-Path $NodeHome 'node.exe'
    if (-not (Test-Path $nodeExe)) {
        throw "Portable Node executable was not found: $nodeExe"
    }
    $env:Path = "$NodeHome;$env:Path"
} else {
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
}

$nodeVersion = (& $nodeExe -v).Trim()
if ($nodeVersion -ne 'v20.20.2') {
    throw "Phase 01 closeout requires Node v20.20.2. Detected: $nodeVersion"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $repo "backups\phase-01-closeout\$timestamp"
$reportRoot = Join-Path $repo 'reports\phase-01-closeout'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null

$targets = @(
    'package.json',
    '.eslintrc.json',
    'electron\ipc\setup.ts',
    'electron\main.ts',
    'src\components\layout\TitleBar.tsx',
    'src\components\neon\NeonButton.tsx',
    'src\components\neon\NeonPanel.tsx',
    'src\core\dsp\DSPSystemManager.ts',
    'src\core\orchestrator\SystemOrchestrator.ts',
    'src\core\services\ai\GeminiService.ts',
    'src\core\services\ai\OpenRouterService.ts',
    'src\core\services\subtitle\SubtitleEngine.ts',
    'src\features\ai\AIAssistant.tsx',
    'src\features\library\LibraryView.tsx',
    'src\features\player\PlayerView.tsx'
)

foreach ($relative in $targets) {
    $source = Join-Path $repo $relative
    if (Test-Path $source) {
        $destination = Join-Path $backupRoot $relative
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}

& git status --short | Set-Content -LiteralPath (Join-Path $backupRoot 'git-status-before.txt') -Encoding UTF8
& git diff --binary | Set-Content -LiteralPath (Join-Path $backupRoot 'working-tree-before.patch') -Encoding UTF8

$repairEngine = Join-Path $PSScriptRoot 'apply-fixes.cjs'
Invoke-Native -FilePath $nodeExe -Arguments @($repairEngine, $repo)

$removalEngine = Join-Path $PSScriptRoot 'apply-removals.cjs'
Invoke-Native -FilePath $nodeExe -Arguments @($removalEngine, $repo)

Write-Host "[PASS] KNOUX Phase 01 source repair applied on branch: $branch" -ForegroundColor Green
Write-Host "Backup: $backupRoot" -ForegroundColor Cyan
Write-Host "Reports: $reportRoot" -ForegroundColor Cyan
