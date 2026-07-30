[CmdletBinding()]
param(
    [string]$RepositoryPath = 'D:\Knoux-X-Bootstrap\repository',
    [string]$PhasePackagePath = 'D:\KNOUX-X-PHASE-01',
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$NodeVersion = '20.20.2'
$ToolsRoot = 'D:\Knoux-X-Bootstrap\.tools'
$NodeArchiveName = "node-v$NodeVersion-win-x64.zip"
$NodeFolderName = "node-v$NodeVersion-win-x64"
$NodeRoot = Join-Path $ToolsRoot $NodeFolderName
$NodeArchive = Join-Path $ToolsRoot $NodeArchiveName
$NodeUrl = "https://nodejs.org/download/release/v$NodeVersion/$NodeArchiveName"
$ChecksumsUrl = "https://nodejs.org/download/release/v$NodeVersion/SHASUMS256.txt"
$VsBootstrap = Join-Path $ToolsRoot 'vs_buildtools.exe'
$VsBootstrapUrl = 'https://aka.ms/vs/17/release/vs_buildtools.exe'
$RepairLogRoot = Join-Path $RepositoryPath 'reports\phase-01-repair'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$RepairRunRoot = Join-Path $RepairLogRoot $Stamp
$RepairLog = Join-Path $RepairRunRoot 'repair-v1.2.log'

function Write-KnxRepairMessage {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO','STEP','OK','WARN','ERROR')][string]$Level = 'INFO'
    )
    $prefix = switch ($Level) {
        'STEP' { '==>' }
        'OK' { '[OK]' }
        'WARN' { '[WARN]' }
        'ERROR' { '[ERROR]' }
        default { '[INFO]' }
    }
    $color = switch ($Level) {
        'STEP' { 'Cyan' }
        'OK' { 'Green' }
        'WARN' { 'Yellow' }
        'ERROR' { 'Red' }
        default { 'Gray' }
    }
    Write-Host "$prefix $Message" -ForegroundColor $color
    if (Test-Path -LiteralPath $RepairRunRoot) {
        Add-Content -LiteralPath $RepairLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $prefix $Message" -Encoding UTF8
    }
}

function Test-KnxAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-KnxAsAdministrator {
    $arguments = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $PSCommandPath + '"'),
        '-RepositoryPath', ('"' + $RepositoryPath + '"'),
        '-PhasePackagePath', ('"' + $PhasePackagePath + '"')
    )
    if ($CheckOnly) { $arguments += '-CheckOnly' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList ($arguments -join ' ') -Verb RunAs
}

function Stop-KnxProcesses {
    param([Parameter(Mandatory = $true)][string]$RepoPath)

    Write-KnxRepairMessage 'Stopping Node/Electron processes that can lock node_modules' 'STEP'
    $escapedRepo = [regex]::Escape($RepoPath)
    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -match '^(node|electron|knoux-player-x)\.exe$' -and
        ($_.CommandLine -and $_.CommandLine -match $escapedRepo)
    }

    foreach ($process in $processes) {
        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
            Write-KnxRepairMessage "Stopped $($process.Name) [$($process.ProcessId)]" 'OK'
        } catch {
            Write-KnxRepairMessage "Could not stop $($process.Name) [$($process.ProcessId)]: $($_.Exception.Message)" 'WARN'
        }
    }
}

function Remove-KnxDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        return $true
    } catch {
        Write-KnxRepairMessage "Normal deletion failed: $Path" 'WARN'
    }

    & cmd.exe /d /c ('rmdir /s /q "' + $Path + '"') | Out-Null
    Start-Sleep -Seconds 2
    return -not (Test-Path -LiteralPath $Path)
}

function Invoke-KnxNative {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$CommandArguments = @(),
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [int[]]$AllowedExitCodes = @(0),
        [switch]$Quiet
    )

    $display = $FilePath
    if ($CommandArguments.Count -gt 0) { $display += ' ' + ($CommandArguments -join ' ') }
    Write-KnxRepairMessage $display 'INFO'

    Push-Location $WorkingDirectory
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $FilePath @CommandArguments 2>&1)
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }
        foreach ($line in $output) {
            $text = [string]$line
            Add-Content -LiteralPath $RepairLog -Value $text -Encoding UTF8
            if (-not $Quiet) { Write-Host $text }
        }
        return [pscustomobject]@{
            ExitCode = [int]$exitCode
            Success = $AllowedExitCodes -contains [int]$exitCode
            Output = ($output -join [Environment]::NewLine)
        }
    } finally {
        $ErrorActionPreference = $previousPreference
        Pop-Location
    }
}

function Get-KnxVsWherePath {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    return $null
}

function Get-KnxVCToolsInstallation {
    $vswhere = Get-KnxVsWherePath
    if (-not $vswhere) { return $null }
    $result = Invoke-KnxNative -FilePath $vswhere -CommandArguments @(
        '-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'
    ) -WorkingDirectory $RepositoryPath -AllowedExitCodes @(0) -Quiet
    if ($result.Success -and -not [string]::IsNullOrWhiteSpace($result.Output)) {
        return $result.Output.Trim()
    }
    return $null
}

function Install-KnxBuildTools {
    $existing = Get-KnxVCToolsInstallation
    if ($existing) {
        Write-KnxRepairMessage "Visual C++ Build Tools detected: $existing" 'OK'
        return 0
    }

    if ($CheckOnly) {
        Write-KnxRepairMessage 'Visual C++ Build Tools are missing.' 'WARN'
        return 1
    }

    Write-KnxRepairMessage 'Installing Visual Studio 2022 Build Tools with Desktop C++ workload' 'STEP'
    if (-not (Test-Path -LiteralPath $VsBootstrap)) {
        Invoke-WebRequest -Uri $VsBootstrapUrl -OutFile $VsBootstrap -UseBasicParsing
    }

    $vsArguments = @(
        '--passive','--wait','--norestart','--nocache',
        '--installPath','C:\BuildTools',
        '--add','Microsoft.VisualStudio.Workload.VCTools',
        '--includeRecommended'
    )
    $process = Start-Process -FilePath $VsBootstrap -ArgumentList $vsArguments -Wait -PassThru
    if ($process.ExitCode -eq 3010) {
        Write-KnxRepairMessage 'Build Tools installed; Windows restart is required.' 'WARN'
        return 3010
    }
    if ($process.ExitCode -ne 0) {
        throw "Visual Studio Build Tools installer failed with exit code $($process.ExitCode)."
    }

    $installed = Get-KnxVCToolsInstallation
    if (-not $installed) {
        throw 'Visual C++ Build Tools installation completed but the compiler workload was not detected.'
    }
    Write-KnxRepairMessage "Visual C++ Build Tools ready: $installed" 'OK'
    return 0
}

function Install-KnxPortableNode20 {
    if (Test-Path -LiteralPath (Join-Path $NodeRoot 'node.exe')) {
        Write-KnxRepairMessage "Portable Node.js $NodeVersion already exists." 'OK'
        return
    }

    if ($CheckOnly) {
        Write-KnxRepairMessage "Portable Node.js $NodeVersion is not installed." 'WARN'
        return
    }

    Write-KnxRepairMessage "Downloading official portable Node.js $NodeVersion" 'STEP'
    $checksumsPath = Join-Path $ToolsRoot 'SHASUMS256-v20.20.2.txt'
    Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $checksumsPath -UseBasicParsing
    if (-not (Test-Path -LiteralPath $NodeArchive)) {
        Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeArchive -UseBasicParsing
    }

    $checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match [regex]::Escape($NodeArchiveName) } | Select-Object -First 1
    if (-not $checksumLine) { throw "Official checksum was not found for $NodeArchiveName." }
    $expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
    $actualHash = (Get-FileHash -LiteralPath $NodeArchive -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
        Remove-Item -LiteralPath $NodeArchive -Force -ErrorAction SilentlyContinue
        throw "Node.js archive checksum mismatch. Expected $expectedHash but got $actualHash."
    }
    Write-KnxRepairMessage 'Node.js archive SHA-256 verified.' 'OK'

    Expand-Archive -LiteralPath $NodeArchive -DestinationPath $ToolsRoot -Force
    if (-not (Test-Path -LiteralPath (Join-Path $NodeRoot 'node.exe'))) {
        throw 'Portable Node.js extraction failed.'
    }
    Write-KnxRepairMessage "Portable Node.js extracted to $NodeRoot" 'OK'
}

function Set-KnxPortableNodeEnvironment {
    $nodeExe = Join-Path $NodeRoot 'node.exe'
    $npmCmd = Join-Path $NodeRoot 'npm.cmd'
    if (-not (Test-Path -LiteralPath $nodeExe)) { throw "Portable node.exe is missing: $nodeExe" }
    if (-not (Test-Path -LiteralPath $npmCmd)) { throw "Portable npm.cmd is missing: $npmCmd" }

    $env:PATH = "$NodeRoot;$NodeRoot\node_modules\npm\bin;$env:PATH"
    $env:npm_config_cache = Join-Path $ToolsRoot 'npm-cache-node20'
    $env:npm_config_msvs_version = '2022'
    $env:GYP_MSVS_VERSION = '2022'
    $env:npm_config_target_arch = 'x64'
    $env:npm_config_arch = 'x64'

    $pythonCandidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:ProgramFiles\Python312\python.exe"
    )
    foreach ($python in $pythonCandidates) {
        if (Test-Path -LiteralPath $python) {
            $env:PYTHON = $python
            $env:npm_config_python = $python
            break
        }
    }

    $nodeVersionResult = Invoke-KnxNative -FilePath $nodeExe -CommandArguments @('--version') -WorkingDirectory $RepositoryPath -Quiet
    $npmVersionResult = Invoke-KnxNative -FilePath $npmCmd -CommandArguments @('--version') -WorkingDirectory $RepositoryPath -Quiet
    Write-KnxRepairMessage "Project runtime: Node $($nodeVersionResult.Output.Trim()), npm $($npmVersionResult.Output.Trim())" 'OK'

    return [pscustomobject]@{ Node = $nodeExe; Npm = $npmCmd }
}

function Install-KnxDependencies {
    param([Parameter(Mandatory = $true)]$Runtime)

    Write-KnxRepairMessage 'Cleaning partial native-module installation' 'STEP'
    Stop-KnxProcesses -RepoPath $RepositoryPath
    $nodeModules = Join-Path $RepositoryPath 'node_modules'
    if (-not (Remove-KnxDirectory -Path $nodeModules)) {
        Write-KnxRepairMessage 'node_modules is still locked. A Windows restart is required.' 'ERROR'
        return 3010
    }

    $npmArgs = @(
        'install','--prefer-online','--no-audit','--no-fund','--progress=false',
        '--fetch-retries=5','--fetch-retry-mintimeout=20000','--fetch-retry-maxtimeout=120000',
        '--maxsockets=1'
    )

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Write-KnxRepairMessage "Node 20 npm install attempt $attempt of 3" 'STEP'
        $result = Invoke-KnxNative -FilePath $Runtime.Npm -CommandArguments $npmArgs -WorkingDirectory $RepositoryPath
        if ($result.Success) {
            Write-KnxRepairMessage 'Dependencies installed successfully under portable Node.js 20.' 'OK'
            return 0
        }

        $networkFailure = $result.Output -match 'ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up'
        $lockFailure = $result.Output -match 'EPERM|EBUSY|resource busy or locked'
        $toolchainFailure = $result.Output -match 'Could not find any Visual Studio installation|find VS|MSBuild|node-gyp'
        if ($networkFailure) { Write-KnxRepairMessage 'Network interruption detected.' 'WARN' }
        if ($lockFailure) { Write-KnxRepairMessage 'Windows file lock detected.' 'WARN' }
        if ($toolchainFailure) { Write-KnxRepairMessage 'Native compiler/toolchain failure detected.' 'WARN' }

        Stop-KnxProcesses -RepoPath $RepositoryPath
        [void](Remove-KnxDirectory -Path $nodeModules)
        Start-Sleep -Seconds (10 * $attempt)
    }

    return 1
}

function Resume-KnxPhase01 {
    if (-not (Test-Path -LiteralPath (Join-Path $PhasePackagePath 'scripts\Invoke-KnouxPhase01.ps1'))) {
        throw "Phase 01 package not found: $PhasePackagePath"
    }

    Write-KnxRepairMessage 'Resuming KNOUX Phase 01 using the repaired Node 20 toolchain' 'STEP'
    $phaseScript = Join-Path $PhasePackagePath 'scripts\Invoke-KnouxPhase01.ps1'
    $phaseConfig = Join-Path $PhasePackagePath 'config\phase-01.json'
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass',
        '-File',('"' + $phaseScript + '"'),
        '-ConfigPath',('"' + $phaseConfig + '"')
    ) -Wait -PassThru -NoNewWindow
    return $process.ExitCode
}

if (-not (Test-KnxAdministrator)) {
    Write-Host '[INFO] Administrative rights are required. Opening an elevated PowerShell window...' -ForegroundColor Yellow
    Restart-KnxAsAdministrator
    exit 0
}

if (-not (Test-Path -LiteralPath $RepositoryPath -PathType Container)) {
    throw "Repository not found: $RepositoryPath"
}
New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $RepairRunRoot -Force | Out-Null

Write-Host '============================================================' -ForegroundColor Magenta
Write-Host '  KNOUX X — PHASE 01 NATIVE TOOLCHAIN REPAIR V1.2' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Magenta
Write-Host "Repository: $RepositoryPath"
Write-Host "Log:        $RepairLog"
Write-Host ''

try {
    Stop-KnxProcesses -RepoPath $RepositoryPath
    Install-KnxPortableNode20
    $runtime = Set-KnxPortableNodeEnvironment

    $buildToolsCode = Install-KnxBuildTools
    if ($buildToolsCode -eq 3010) { exit 3010 }

    if ($CheckOnly) {
        Write-KnxRepairMessage 'Environment check completed.' 'OK'
        exit 0
    }

    $dependencyCode = Install-KnxDependencies -Runtime $runtime
    if ($dependencyCode -eq 3010) { exit 3010 }
    if ($dependencyCode -ne 0) { throw 'Dependencies still failed after Node 20, Build Tools, cleanup, and retries.' }

    $phaseCode = Resume-KnxPhase01
    if ($phaseCode -eq 0) {
        Write-KnxRepairMessage 'Phase 01 completed with all gates passing.' 'OK'
        exit 0
    }
    if ($phaseCode -eq 2) {
        Write-KnxRepairMessage 'Phase 01 resumed, but one or more validation gates still failed. Review the latest report.' 'WARN'
        exit 2
    }
    throw "Phase 01 returned blocking exit code $phaseCode."
} catch {
    Write-KnxRepairMessage $_.Exception.Message 'ERROR'
    Add-Content -LiteralPath $RepairLog -Value $_.Exception.ToString() -Encoding UTF8
    exit 1
}
