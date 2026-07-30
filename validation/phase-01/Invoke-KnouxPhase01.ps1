[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config\phase-01.json'),
    [string]$RepositoryPath,
    [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

. (Join-Path $PSScriptRoot 'KnouxPhase01.Common.ps1')
. (Join-Path $PSScriptRoot 'tasks\01-Preflight.ps1')
. (Join-Path $PSScriptRoot 'tasks\02-Foundation.ps1')
. (Join-Path $PSScriptRoot 'tasks\03-Dependencies.ps1')
. (Join-Path $PSScriptRoot 'tasks\04-Validation.ps1')
. (Join-Path $PSScriptRoot 'tasks\05-GitFinalize.ps1')

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Phase configuration not found: $ConfigPath"
}
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = [string]$config.repositoryPath }
$RepositoryPath = [System.IO.Path]::GetFullPath($RepositoryPath)

$reportRoot = Join-Path $RepositoryPath 'reports\phase-01'
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runRoot = Join-Path $reportRoot $stamp
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null

$context = [pscustomobject]@{
    Config = $config
    RepositoryPath = $RepositoryPath
    StartedAt = Get-Date
    Branch = ''
    BackupRoot = ''
    GitPath = ''
    NodePath = ''
    NpmPath = ''
    NodeVersion = ''
    NpmVersion = ''
    NoPush = [bool]$NoPush
    MasterLog = (Join-Path $runRoot 'phase-01-master.log')
    NpmLog = (Join-Path $runRoot 'npm-install.log')
    ValidationLog = (Join-Path $runRoot 'validation.log')
    ReportMarkdown = (Join-Path $runRoot 'PHASE-01-REPORT.md')
    ReportJson = (Join-Path $runRoot 'phase-01-result.json')
    Gates = [ordered]@{
        Dependencies = $null
        Doctor = $null
        Typecheck = $null
        Lint = $null
        Package = $null
    }
    Result = 'FAILED'
}

Write-Host '============================================================' -ForegroundColor Magenta
Write-Host '  KNOUX X — PHASE 01: FOUNDATION AND FIRST BUILD' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Magenta
Write-Host "Repository: $RepositoryPath"
Write-Host "Reports:    $runRoot"
Write-Host ''

$exitCode = 1
try {
    Start-Transcript -LiteralPath (Join-Path $runRoot 'powershell-transcript.log') -Force | Out-Null
    Invoke-KnxPhase01Preflight -Context $context
    Invoke-KnxPhase01Foundation -Context $context
    Invoke-KnxPhase01Dependencies -Context $context
    Invoke-KnxPhase01Validation -Context $context
    Invoke-KnxPhase01GitFinalize -Context $context

    if ($context.Result -eq 'PASS') {
        Write-KnxMessage 'PHASE 01 completed. All build gates passed.' 'OK'
        $exitCode = 0
    } else {
        Write-KnxMessage 'PHASE 01 customization was applied, but the branch is not ready to merge. Open the generated report.' 'WARN'
        $exitCode = 2
    }
} catch {
    Write-KnxMessage $_.Exception.Message 'ERROR'
    Add-Content -LiteralPath $context.MasterLog -Value ($_.Exception.ToString()) -Encoding UTF8
    try {
        $context.Result = 'FAILED'
        New-KnxPhaseReport -Context $context
    } catch {}
    $exitCode = 1
} finally {
    try { Stop-Transcript | Out-Null } catch {}
    Write-Host ''
    Write-Host "Report: $($context.ReportMarkdown)" -ForegroundColor Cyan
}

exit $exitCode
