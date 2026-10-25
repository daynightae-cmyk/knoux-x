#requires -Version 5.1
<#
.SYNOPSIS
    KNOUX X comprehensive Windows workstation bootstrap, repair, dependency install,
    validation, and local/remote synchronization script.

.DESCRIPTION
    Canonical local workspace:
        D:\KNOUX X

    Canonical remote:
        https://github.com/daynightae-cmyk/knoux-x.git

    This script is intentionally conservative:
    - NEVER force-pushes.
    - NEVER runs git reset --hard.
    - NEVER runs git clean -fd.
    - NEVER deletes an existing non-Git workspace.
    - NEVER overwrites uncommitted work.
    - Uses fast-forward-only pulls.
    - Uses Git dependency permission only for the npm install process.
    - Can install/repair the Windows native build toolchain required by node-gyp.
    - Can prepare Android prerequisites when available.
    - Produces a machine-readable setup report.

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\KNOUX X\KNOUX-X-FULL-SETUP.ps1"

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\KNOUX X\KNOUX-X-FULL-SETUP.ps1" -SkipTests

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\KNOUX X\KNOUX-X-FULL-SETUP.ps1" -PrepareAndroid

.NOTES
    Some package installations may require Administrator elevation and may open
    UAC. The script attempts to continue safely after each install.
#>

[CmdletBinding()]
param(
    [string]$Workspace = 'D:\KNOUX X',
    [string]$RepoUrl = 'https://github.com/daynightae-cmyk/knoux-x.git',
    [string]$Branch = 'main',
    [string]$NodeVersion = '20.20.2',
    [switch]$SkipToolInstall,
    [switch]$SkipDependencies,
    [switch]$SkipTests,
    [switch]$PrepareAndroid,
    [switch]$NoAdminInstall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# -----------------------------------------------------------------------------
# GLOBALS / REPORTING
# -----------------------------------------------------------------------------

$StartedAt = Get-Date
$ScriptPath = $MyInvocation.MyCommand.Path
$LogRoot = Join-Path $Workspace 'reports\local-setup'
$LogFile = $null

$Report = [ordered]@{
    product = 'KNOUX X'
    startedAt = $StartedAt.ToString('o')
    completedAt = $null
    workspace = $Workspace
    repository = $RepoUrl
    branch = $Branch
    nodeTarget = $NodeVersion
    success = $false
    git = [ordered]@{}
    tools = [ordered]@{}
    npm = [ordered]@{}
    validation = [ordered]@{}
    android = [ordered]@{}
    warnings = @()
    errors = @()
}

function Write-Section([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 80) -ForegroundColor DarkGray
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ('=' * 80) -ForegroundColor DarkGray
}

function Write-Info([string]$Text) {
    Write-Host "[INFO] $Text" -ForegroundColor Gray
}

function Write-Ok([string]$Text) {
    Write-Host "[PASS] $Text" -ForegroundColor Green
}

function Write-Warn([string]$Text) {
    $script:Report.warnings += $Text
    Write-Host "[WARN] $Text" -ForegroundColor Yellow
}

function Write-Fail([string]$Text) {
    $script:Report.errors += $Text
    Write-Host "[FAIL] $Text" -ForegroundColor Red
}

function Test-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-External {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments
    )

    Write-Info ("RUN: {0} {1}" -f $FilePath, ($Arguments -join ' '))
    & $FilePath @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "Command failed with exit code $code: $FilePath $($Arguments -join ' ')"
    }
}

function Refresh-Path {
    # Refresh machine/user PATH after winget/MSVC installs.
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Save-Report {
    try {
        if (-not (Test-Path $LogRoot)) {
            New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
        }
        $script:Report.completedAt = (Get-Date).ToString('o')
        $reportPath = Join-Path $LogRoot 'KNOUX-X-LOCAL-SETUP-REPORT.json'
        $script:Report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
        Write-Info "Setup report: $reportPath"
    } catch {
        Write-Warn "Could not write setup report: $($_.Exception.Message)"
    }
}

# -----------------------------------------------------------------------------
# WORKSPACE SAFETY
# -----------------------------------------------------------------------------

Write-Section '1/12 — Workspace safety and repository bootstrap'

$driveRoot = [IO.Path]::GetPathRoot($Workspace)
if (-not (Test-Path $driveRoot)) {
    throw "Required drive does not exist: $driveRoot"
}

if (-not (Test-Path $Workspace)) {
    if (-not (Test-Command 'git')) {
        throw "Git must be installed before cloning $RepoUrl."
    }
    Write-Info "Workspace does not exist. Cloning into: $Workspace"
    Invoke-External git clone $RepoUrl $Workspace
}
elseif (-not (Test-Path (Join-Path $Workspace '.git'))) {
    $existing = @(Get-ChildItem -LiteralPath $Workspace -Force -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0) {
        throw "Workspace exists but is not a Git repository. No files were deleted: $Workspace"
    }
    if (-not (Test-Command 'git')) {
        throw "Git must be installed before cloning $RepoUrl."
    }
    Invoke-External git clone $RepoUrl $Workspace
}

Set-Location -LiteralPath $Workspace

if (-not (Test-Path $LogRoot)) {
    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
}
$LogFile = Join-Path $LogRoot ("setup-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
try {
    Start-Transcript -Path $LogFile -Append | Out-Null
} catch {
    Write-Warn "PowerShell transcript could not start: $($_.Exception.Message)"
}

# Keep local helper scripts out of Git status without modifying tracked .gitignore.
$localHelpers = @(
    'KNOUX-X-BOOTSTRAP-SYNC.ps1',
    'KNOUX-X-FULL-SETUP.ps1'
)
$excludePath = Join-Path $Workspace '.git\info\exclude'
foreach ($helper in $localHelpers) {
    if (-not (Select-String -Path $excludePath -SimpleMatch -Pattern $helper -Quiet -ErrorAction SilentlyContinue)) {
        Add-Content -LiteralPath $excludePath -Value $helper
    }
}

# -----------------------------------------------------------------------------
# TOOL INSTALLATION HELPERS
# -----------------------------------------------------------------------------

Write-Section '2/12 — Base development toolchain'

$IsAdmin = Test-Administrator
$Report.tools.isAdministrator = $IsAdmin

if (-not (Test-Command 'winget')) {
    Write-Warn 'winget is not available. Automatic package installation will be limited.'
}

function Ensure-WingetPackage {
    param(
        [Parameter(Mandatory=$true)][string]$Id,
        [Parameter(Mandatory=$true)][string]$FriendlyName,
        [string[]]$ExtraArgs = @()
    )

    if ($SkipToolInstall) {
        Write-Warn "Tool installation skipped by parameter: $FriendlyName"
        return
    }
    if (-not (Test-Command 'winget')) {
        throw "Cannot automatically install $FriendlyName because winget is unavailable."
    }

    Write-Info "Ensuring package: $FriendlyName ($Id)"
    $args = @(
        'install',
        '--id', $Id,
        '--exact',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--silent',
        '--disable-interactivity'
    ) + $ExtraArgs

    try {
        & winget @args
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "winget returned exit code $LASTEXITCODE for $FriendlyName. It may already exist or require manual repair."
        }
    } catch {
        Write-Warn "winget install failed for $FriendlyName: $($_.Exception.Message)"
    }
    Refresh-Path
}

# Git
if (-not (Test-Command 'git')) {
    Ensure-WingetPackage -Id 'Git.Git' -FriendlyName 'Git for Windows'
}
if (-not (Test-Command 'git')) {
    throw 'Git is still unavailable after installation attempt.'
}
$gitVersion = (& git --version)
$Report.tools.git = $gitVersion
Write-Ok $gitVersion

# Python 3.12 (node-gyp compatible)
$pythonOk = $false
if (Test-Command 'python') {
    try {
        $pyVer = (& python --version 2>&1)
        $Report.tools.python = "$pyVer"
        if ($pyVer -match 'Python 3\.(1[012]|[89])') { $pythonOk = $true }
    } catch {}
}
if (-not $pythonOk) {
    Ensure-WingetPackage -Id 'Python.Python.3.12' -FriendlyName 'Python 3.12'
    Refresh-Path
}
if (Test-Command 'python') {
    $Report.tools.python = (& python --version 2>&1)
    Write-Ok "Python: $($Report.tools.python)"
} else {
    throw 'Python is required for native Node module builds.'
}

# -----------------------------------------------------------------------------
# NODE 20.20.2
# -----------------------------------------------------------------------------

Write-Section '3/12 — Node.js version alignment'

function Get-NodeVersion {
    if (-not (Test-Command 'node')) { return $null }
    try { return ((& node -v).Trim().TrimStart('v')) } catch { return $null }
}

$currentNode = Get-NodeVersion

if ($currentNode -ne $NodeVersion) {
    Write-Warn "Current Node is '$currentNode'; KNOUX local target is '$NodeVersion'."

    # Prefer fnm for per-project version control.
    if (-not (Test-Command 'fnm')) {
        Ensure-WingetPackage -Id 'Schniz.fnm' -FriendlyName 'Fast Node Manager (fnm)'
        Refresh-Path
    }

    if (Test-Command 'fnm') {
        Write-Info "Installing/activating Node $NodeVersion via fnm."
        Invoke-External fnm install $NodeVersion

        # Import fnm's environment into this PowerShell process.
        $fnmEnv = (& fnm env --shell powershell)
        if ($LASTEXITCODE -eq 0 -and $fnmEnv) {
            Invoke-Expression ($fnmEnv -join [Environment]::NewLine)
        }

        Invoke-External fnm use $NodeVersion

        # Create version pins for future shells/tools.
        Set-Content -LiteralPath (Join-Path $Workspace '.node-version') -Value $NodeVersion -Encoding ASCII
        Set-Content -LiteralPath (Join-Path $Workspace '.nvmrc') -Value $NodeVersion -Encoding ASCII

        Refresh-Path

        # Re-apply fnm env after PATH refresh.
        $fnmEnv = (& fnm env --shell powershell)
        if ($LASTEXITCODE -eq 0 -and $fnmEnv) {
            Invoke-Expression ($fnmEnv -join [Environment]::NewLine)
        }
        & fnm use $NodeVersion | Out-Host
    } else {
        Write-Warn "fnm is not available. Existing Node will be used, but native addon compatibility may fail."
    }
}

$currentNode = Get-NodeVersion
$Report.tools.node = $currentNode

if ($currentNode -ne $NodeVersion) {
    Write-Warn "Node is still $currentNode instead of $NodeVersion. Continuing, but npm/native builds may fail."
} else {
    Write-Ok "Node $currentNode is active."
}

if (-not (Test-Command 'npm')) {
    throw 'npm is unavailable.'
}
$Report.tools.npm = ((& npm -v).Trim())
Write-Ok "npm $($Report.tools.npm)"

# -----------------------------------------------------------------------------
# VISUAL STUDIO BUILD TOOLS / MSVC
# -----------------------------------------------------------------------------

Write-Section '4/12 — Visual Studio 2022 C++ native build toolchain'

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"

function Get-VCToolsInstallPath {
    if (-not (Test-Path $vswhere)) { return $null }
    $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($LASTEXITCODE -eq 0 -and $path) { return ($path | Select-Object -First 1).Trim() }
    return $null
}

$vcPath = Get-VCToolsInstallPath

if (-not $vcPath) {
    Write-Warn 'Visual Studio C++ build workload is missing or incomplete.'

    if ($SkipToolInstall) {
        throw 'MSVC C++ workload is required, but tool installation was skipped.'
    }
    if (-not (Test-Command 'winget')) {
        throw 'Cannot automatically install Visual Studio Build Tools because winget is unavailable.'
    }

    if (-not $IsAdmin -and -not $NoAdminInstall) {
        Write-Warn 'Visual Studio Build Tools installation may trigger UAC because this shell is not elevated.'
    }

    Write-Info 'Installing/repairing Visual Studio 2022 Build Tools with Desktop development with C++ workload.'
    $override = '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --includeOptional'
    & winget install `
        --id Microsoft.VisualStudio.2022.BuildTools `
        --exact `
        --accept-package-agreements `
        --accept-source-agreements `
        --override $override

    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Visual Studio Build Tools installer returned exit code $LASTEXITCODE."
    }

    Refresh-Path
    Start-Sleep -Seconds 3
    $vcPath = Get-VCToolsInstallPath
}

if (-not $vcPath) {
    throw @"
Visual Studio 2022 was detected previously but the required C++ workload is still missing.

Required component:
  Microsoft.VisualStudio.Component.VC.Tools.x86.x64

Required workload:
  Desktop development with C++

Open Visual Studio Installer -> Build Tools 2022 -> Modify -> enable:
  Desktop development with C++

Then rerun this script.
"@
}

$Report.tools.visualStudio = $vcPath
Write-Ok "MSVC C++ toolchain found: $vcPath"

$env:npm_config_msvs_version = '2022'

# Windows SDK check
$sdkRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\Include"
if (Test-Path $sdkRoot) {
    $sdkVersions = @(Get-ChildItem -LiteralPath $sdkRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
    if ($sdkVersions.Count -gt 0) {
        $Report.tools.windowsSdk = $sdkVersions[0].Name
        Write-Ok "Windows SDK: $($sdkVersions[0].Name)"
    }
} else {
    Write-Warn 'Windows SDK directory was not detected. The VCTools workload installer should provide a compatible SDK.'
}

# -----------------------------------------------------------------------------
# JAVA 21 / OPTIONAL ANDROID
# -----------------------------------------------------------------------------

Write-Section '5/12 — Java 21 and Android prerequisites'

function Get-JavaMajor {
    if (-not (Test-Command 'java')) { return $null }
    try {
        $line = (& java -version 2>&1 | Select-Object -First 1)
        if ($line -match '"(\d+)(?:\.\d+)?') { return [int]$Matches[1] }
    } catch {}
    return $null
}

$javaMajor = Get-JavaMajor
if ($javaMajor -ne 21) {
    Ensure-WingetPackage -Id 'EclipseAdoptium.Temurin.21.JDK' -FriendlyName 'Temurin JDK 21'
    Refresh-Path
}
$javaMajor = Get-JavaMajor
$Report.tools.javaMajor = $javaMajor
if ($javaMajor -eq 21) {
    Write-Ok 'Java 21 detected.'
} else {
    Write-Warn "Java 21 is not active (detected: $javaMajor). Android local builds may not work."
}

if ($PrepareAndroid) {
    Write-Info 'Android preparation requested.'

    if (-not (Test-Command 'adb')) {
        Write-Warn 'adb not detected.'
        Ensure-WingetPackage -Id 'Google.AndroidStudio' -FriendlyName 'Android Studio'
        Refresh-Path
    }

    $sdkCandidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

    $sdkRootFound = $sdkCandidates | Select-Object -First 1
    if ($sdkRootFound) {
        $env:ANDROID_HOME = $sdkRootFound
        $env:ANDROID_SDK_ROOT = $sdkRootFound
        $Report.android.sdkRoot = $sdkRootFound
        Write-Ok "Android SDK root: $sdkRootFound"

        $sdkManagerCandidates = @(
            (Join-Path $sdkRootFound 'cmdline-tools\latest\bin\sdkmanager.bat'),
            (Join-Path $sdkRootFound 'cmdline-tools\bin\sdkmanager.bat'),
            (Join-Path $sdkRootFound 'tools\bin\sdkmanager.bat')
        )
        $sdkManager = $sdkManagerCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

        if ($sdkManager) {
            Write-Info 'Installing Android API 36 platform/build-tools if needed.'
            cmd /c "echo y|`"$sdkManager`" --licenses" | Out-Null
            & $sdkManager 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
            if ($LASTEXITCODE -eq 0) {
                $Report.android.sdk36 = $true
                Write-Ok 'Android API 36 prerequisites installed.'
            } else {
                $Report.android.sdk36 = $false
                Write-Warn 'Android sdkmanager could not complete API 36 installation.'
            }
        } else {
            Write-Warn 'Android SDK exists but sdkmanager command-line tools were not found. Open Android Studio SDK Manager once, install Command-line Tools (latest), then rerun.'
        }
    } else {
        Write-Warn 'Android SDK root not found. Android Studio may require one first-run initialization.'
    }
} else {
    Write-Info 'Android SDK preparation skipped. Use -PrepareAndroid when local Android building is required.'
}

# -----------------------------------------------------------------------------
# GIT SYNCHRONIZATION
# -----------------------------------------------------------------------------

Write-Section '6/12 — Git remote and main synchronization'

$currentOrigin = $null
try { $currentOrigin = (& git remote get-url origin).Trim() } catch {}

if (-not $currentOrigin) {
    Invoke-External git remote add origin $RepoUrl
} elseif ($currentOrigin -ne $RepoUrl) {
    Write-Warn "Changing origin from '$currentOrigin' to canonical remote '$RepoUrl'."
    Invoke-External git remote set-url origin $RepoUrl
}

Invoke-External git fetch origin --prune --tags

$Report.git.origin = (& git remote get-url origin).Trim()
$Report.git.beforeHead = (& git rev-parse HEAD).Trim()

$dirty = -not [string]::IsNullOrWhiteSpace((& git status --porcelain))
if ($dirty) {
    Write-Warn 'Uncommitted local work exists. Pull/rebase was skipped to protect it.'
    & git status --short | Out-Host
} else {
    $currentBranch = (& git branch --show-current).Trim()
    if ($currentBranch -ne $Branch) {
        $branchExists = -not [string]::IsNullOrWhiteSpace((& git branch --list $Branch))
        if ($branchExists) {
            Invoke-External git checkout $Branch
        } else {
            Invoke-External git checkout -b $Branch --track "origin/$Branch"
        }
    }

    Invoke-External git pull --ff-only origin $Branch
}

$Report.git.branch = (& git branch --show-current).Trim()
$Report.git.head = (& git rev-parse HEAD).Trim()
$Report.git.originMain = (& git rev-parse "origin/$Branch").Trim()

if ($Report.git.head -eq $Report.git.originMain) {
    Write-Ok "Local HEAD matches origin/$Branch."
} else {
    Write-Warn "Local HEAD differs from origin/$Branch. This may be expected when local work exists."
}

# -----------------------------------------------------------------------------
# CLEAN PARTIAL NPM INSTALL LEFT BY FAILED BUILDS
# -----------------------------------------------------------------------------

Write-Section '7/12 — Native dependency installation'

if (-not $SkipDependencies) {
    # Previous failed node-gyp runs can leave partial node_modules; npm ci will replace it.
    $previousAllowGit = $env:NPM_CONFIG_ALLOW_GIT
    $previousMsvs = $env:npm_config_msvs_version

    try {
        $env:NPM_CONFIG_ALLOW_GIT = 'all'
        $env:npm_config_msvs_version = '2022'

        # Tell node-gyp which Python to use.
        try {
            $pythonPath = (Get-Command python -ErrorAction Stop).Source
            $env:npm_config_python = $pythonPath
            Write-Info "node-gyp Python: $pythonPath"
        } catch {}

        Write-Info 'Running npm ci with project-scoped Git dependency permission.'
        & npm ci
        if ($LASTEXITCODE -ne 0) {
            throw 'npm ci failed.'
        }

        $Report.npm.install = 'PASS'
        Write-Ok 'npm ci completed.'
    }
    finally {
        if ($null -eq $previousAllowGit) {
            Remove-Item Env:NPM_CONFIG_ALLOW_GIT -ErrorAction SilentlyContinue
        } else {
            $env:NPM_CONFIG_ALLOW_GIT = $previousAllowGit
        }

        if ($null -eq $previousMsvs) {
            Remove-Item Env:npm_config_msvs_version -ErrorAction SilentlyContinue
        } else {
            $env:npm_config_msvs_version = $previousMsvs
        }
    }

    # Electron-specific native ABI rebuild for packaged app.
    if (Test-Path (Join-Path $Workspace 'node_modules')) {
        Write-Info 'Rebuilding Electron native modules: better-sqlite3, sharp'
        & npm exec electron-rebuild -- -f --only better-sqlite3,sharp
        if ($LASTEXITCODE -ne 0) {
            throw 'electron-rebuild failed for native modules.'
        }
        $Report.npm.electronRebuild = 'PASS'
        Write-Ok 'Electron native module rebuild completed.'
    }
} else {
    Write-Warn 'Dependency installation skipped by parameter.'
}

# -----------------------------------------------------------------------------
# DEPENDENCY GRAPH CHECK
# -----------------------------------------------------------------------------

Write-Section '8/12 — Dependency graph verification'

if (-not $SkipDependencies) {
    & npm ls better-sqlite3 sharp onnxruntime-node --depth=0
    if ($LASTEXITCODE -eq 0) {
        $Report.npm.nativeDependencies = 'PASS'
        Write-Ok 'Required native dependencies are present.'
    } else {
        $Report.npm.nativeDependencies = 'FAIL'
        throw 'Required native dependency graph is incomplete.'
    }
}

# -----------------------------------------------------------------------------
# QUALITY GATES
# -----------------------------------------------------------------------------

Write-Section '9/12 — KNOUX quality gates'

if (-not $SkipTests) {
    $gates = @(
        @{ Name = 'doctor'; Command = @('run','doctor') },
        @{ Name = 'typecheck'; Command = @('run','typecheck') },
        @{ Name = 'lint'; Command = @('run','lint','--','--max-warnings=0') },
        @{ Name = 'tests'; Command = @('test','--','--runInBand') }
    )

    foreach ($gate in $gates) {
        Write-Info "Running gate: $($gate.Name)"
        & npm @($gate.Command)
        if ($LASTEXITCODE -ne 0) {
            $Report.validation[$gate.Name] = 'FAIL'
            throw "Quality gate failed: $($gate.Name)"
        }
        $Report.validation[$gate.Name] = 'PASS'
        Write-Ok "Gate passed: $($gate.Name)"
    }
} else {
    Write-Warn 'Quality tests skipped by parameter.'
}

# -----------------------------------------------------------------------------
# OPTIONAL LOCAL PACKAGE SMOKE
# -----------------------------------------------------------------------------

Write-Section '10/12 — Local project capability summary'

$expectedFiles = @(
    'package.json',
    'src',
    'electron',
    '.github\workflows'
)

foreach ($item in $expectedFiles) {
    $full = Join-Path $Workspace $item
    if (-not (Test-Path $full)) {
        throw "Expected KNOUX repository path missing: $item"
    }
}

Write-Ok 'Core repository structure verified.'

# -----------------------------------------------------------------------------
# FINAL GIT STATUS
# -----------------------------------------------------------------------------

Write-Section '11/12 — Final Git state'

& git status --short --branch | Out-Host

$Report.git.finalHead = (& git rev-parse HEAD).Trim()
$Report.git.finalOriginMain = (& git rev-parse "origin/$Branch").Trim()
$finalDirty = -not [string]::IsNullOrWhiteSpace((& git status --porcelain))
$Report.git.workingTreeClean = -not $finalDirty

if ($finalDirty) {
    Write-Warn 'Working tree contains changes. Nothing was automatically discarded or committed.'
} else {
    Write-Ok 'Working tree is clean.'
}

# -----------------------------------------------------------------------------
# FINAL SUMMARY
# -----------------------------------------------------------------------------

Write-Section '12/12 — KNOUX X local workstation ready'

$Report.success = $true
Save-Report

Write-Host ''
Write-Host 'KNOUX X LOCAL WORKSPACE' -ForegroundColor White
Write-Host "  $Workspace" -ForegroundColor Green
Write-Host ''
Write-Host 'REMOTE' -ForegroundColor White
Write-Host "  $RepoUrl" -ForegroundColor Green
Write-Host ''
Write-Host 'BRANCH / SHA' -ForegroundColor White
Write-Host "  $($Report.git.branch) / $($Report.git.finalHead)" -ForegroundColor Green
Write-Host ''
Write-Host 'TOOLCHAIN' -ForegroundColor White
Write-Host "  Node: $($Report.tools.node)"
Write-Host "  npm:  $($Report.tools.npm)"
Write-Host "  Python: $($Report.tools.python)"
Write-Host "  MSVC: $($Report.tools.visualStudio)"
Write-Host "  Windows SDK: $($Report.tools.windowsSdk)"
Write-Host "  Java major: $($Report.tools.javaMajor)"
Write-Host ''
Write-Host 'Next development command:' -ForegroundColor Cyan
Write-Host '  npm start'
Write-Host ''
Write-Host 'Windows package commands:' -ForegroundColor Cyan
Write-Host '  npm run package'
Write-Host '  npm run make'
Write-Host ''
Write-Host 'The canonical local/remote development loop is now:' -ForegroundColor Cyan
Write-Host '  D:\KNOUX X  <->  GitHub origin/main'
Write-Host ''
Write-Host 'No force-push, hard reset, or destructive cleanup was performed.' -ForegroundColor Green

try { Stop-Transcript | Out-Null } catch {}
