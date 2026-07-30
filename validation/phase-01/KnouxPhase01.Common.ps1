Set-StrictMode -Version 2.0

function Write-KnxMessage {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO','STEP','OK','WARN','ERROR','CMD')][string]$Level = 'INFO'
    )

    $colors = @{
        INFO = 'Gray'; STEP = 'Cyan'; OK = 'Green'; WARN = 'Yellow'; ERROR = 'Red'; CMD = 'DarkGray'
    }
    $prefix = switch ($Level) {
        'STEP' { '==>' }
        'OK' { '[OK]' }
        'WARN' { '[WARN]' }
        'ERROR' { '[ERROR]' }
        'CMD' { '[CMD]' }
        default { '[INFO]' }
    }
    Write-Host "$prefix $Message" -ForegroundColor $colors[$Level]
}

function Write-KnxUtf8File {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Content)
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Set-KnxObjectProperty {
    param([Parameter(Mandatory = $true)]$Object, [Parameter(Mandatory = $true)][string]$Name, $Value)
    $existing = $Object.PSObject.Properties[$Name]
    if ($null -eq $existing) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    } else {
        $existing.Value = $Value
    }
}

function Get-KnxCommandPath {
    param([Parameter(Mandatory = $true)][string[]]$Candidates)
    foreach ($candidate in $Candidates) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

function Invoke-KnxCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$CommandArguments = @(),
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [int[]]$AllowedExitCodes = @(0),
        [switch]$Quiet
    )

    $display = $FilePath
    if ($CommandArguments.Count -gt 0) { $display += ' ' + ($CommandArguments -join ' ') }
    Write-KnxMessage $display 'CMD'

    Push-Location $WorkingDirectory
    try {
        $output = @(& $FilePath @CommandArguments 2>&1)
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }

        foreach ($line in $output) {
            $text = [string]$line
            Add-Content -LiteralPath $LogPath -Value $text -Encoding UTF8
            if (-not $Quiet) { Write-Host $text }
        }

        return [pscustomobject]@{
            ExitCode = [int]$exitCode
            Success = $AllowedExitCodes -contains [int]$exitCode
            Output = ($output -join [Environment]::NewLine)
            Command = $display
        }
    } finally {
        Pop-Location
    }
}

function Remove-KnxDirectoryRobust {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }

    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        return
    } catch {
        Write-KnxMessage "Normal deletion failed for $Path. Using Windows fallback." 'WARN'
    }

    $empty = Join-Path ([System.IO.Path]::GetTempPath()) ('knoux-empty-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $empty -Force | Out-Null
    try {
        & robocopy.exe $empty $Path /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        & cmd.exe /d /c ('rmdir /s /q "' + $Path + '"') | Out-Null
    } finally {
        Remove-Item -LiteralPath $empty -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Stop-KnxRepoProcesses {
    param([Parameter(Mandatory = $true)][string]$RepositoryPath)
    $escaped = [regex]::Escape($RepositoryPath)
    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -match $escaped -and $_.Name -match '^(node|electron|knoux-player-x)\.exe$'
    }
    foreach ($process in $processes) {
        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
            Write-KnxMessage "Stopped repository process $($process.Name) [$($process.ProcessId)]." 'OK'
        } catch {
            Write-KnxMessage "Could not stop $($process.Name) [$($process.ProcessId)]." 'WARN'
        }
    }
}

function New-KnxPhaseReport {
    param([Parameter(Mandatory = $true)]$Context)

    $gateRows = foreach ($name in @('Dependencies','Doctor','Typecheck','Lint','Package')) {
        $value = $Context.Gates[$name]
        if ($null -eq $value) { $value = 'SKIPPED' }
        "| $name | $value |"
    }

    $markdown = @"
# KNOUX X — PHASE 01 REPORT

- **Phase:** Foundation & First Build
- **Started:** $($Context.StartedAt.ToString('yyyy-MM-dd HH:mm:ss'))
- **Completed:** $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
- **Repository:** `$($Context.RepositoryPath)`
- **Branch:** `$($Context.Branch)`
- **Node:** `$($Context.NodeVersion)`
- **npm:** `$($Context.NpmVersion)`
- **Result:** **$($Context.Result)**

## Validation gates

| Gate | Status |
|---|---|
$($gateRows -join [Environment]::NewLine)

## Files introduced by Phase 01

- `src/config/brand.ts`
- `src/styles/knoux-tokens.css`
- `tools/doctor.cjs`
- `.gitattributes`
- `docs/customization/PHASE-01-FOUNDATION.md`

## Logs

- Master log: `$($Context.MasterLog)`
- npm log: `$($Context.NpmLog)`
- validation log: `$($Context.ValidationLog)`

## Merge policy

Merge this branch into `main` only when Dependencies, Doctor, Typecheck, Lint and Package are all `PASS`.
"@

    Write-KnxUtf8File -Path $Context.ReportMarkdown -Content $markdown

    $json = [ordered]@{
        phase = '01'
        result = $Context.Result
        repository = $Context.RepositoryPath
        branch = $Context.Branch
        node = $Context.NodeVersion
        npm = $Context.NpmVersion
        startedAt = $Context.StartedAt.ToString('o')
        completedAt = (Get-Date).ToString('o')
        gates = $Context.Gates
        logs = [ordered]@{
            master = $Context.MasterLog
            npm = $Context.NpmLog
            validation = $Context.ValidationLog
        }
    } | ConvertTo-Json -Depth 10
    Write-KnxUtf8File -Path $Context.ReportJson -Content ($json + [Environment]::NewLine)
}
