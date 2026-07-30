$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

. (Join-Path $PSScriptRoot 'KnouxPhase01.Common.V1.1.ps1')

$logPath = Join-Path $env:RUNNER_TEMP 'knoux-native-stderr.log'
$result = Invoke-KnxCommandV11 -FilePath 'cmd.exe' -CommandArguments @('/d','/c','echo npm warn harmless warning 1>&2 & exit /b 0') -WorkingDirectory $env:RUNNER_TEMP -LogPath $logPath
if (-not $result.Success) { throw "Expected success but got exit code $($result.ExitCode)" }
if ($result.Output -notmatch 'npm warn harmless warning') { throw 'Expected STDERR warning to be captured.' }
if ($ErrorActionPreference -ne 'Stop') { throw 'ErrorActionPreference was not restored.' }
Write-Host 'PASS: harmless native STDERR no longer aborts Phase 01.'
