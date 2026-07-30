$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Invoke-NativeForTest {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$CommandArguments = @(),
        [int[]]$AllowedExitCodes = @(0)
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $FilePath @CommandArguments 2>&1)
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }

        return [pscustomobject]@{
            ExitCode = [int]$exitCode
            Success = $AllowedExitCodes -contains [int]$exitCode
            Output = ($output -join [Environment]::NewLine)
        }
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

$result = Invoke-NativeForTest -FilePath 'cmd.exe' -CommandArguments @('/d','/c','echo npm warn harmless warning 1>&2 & exit /b 0')
if (-not $result.Success) { throw "Expected success but got exit code $($result.ExitCode)" }
if ($result.Output -notmatch 'npm warn harmless warning') { throw 'Expected STDERR warning to be captured.' }
if ($ErrorActionPreference -ne 'Stop') { throw 'ErrorActionPreference was not restored.' }
Write-Host 'PASS: harmless native STDERR no longer aborts Phase 01.'
