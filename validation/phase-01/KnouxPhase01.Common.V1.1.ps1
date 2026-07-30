Set-StrictMode -Version 2.0

function Invoke-KnxCommandV11 {
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

    Push-Location $WorkingDirectory
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
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
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }
}
