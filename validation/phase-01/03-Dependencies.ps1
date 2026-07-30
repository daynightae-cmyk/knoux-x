function Invoke-KnxPhase01Dependencies {
    param([Parameter(Mandatory = $true)]$Context)

    Write-KnxMessage 'Repairing npm connectivity and installing dependencies' 'STEP'
    Stop-KnxRepoProcesses -RepositoryPath $Context.RepositoryPath

    foreach ($pair in @(
        @('config','delete','proxy'),
        @('config','delete','https-proxy'),
        @('config','set','registry',$Context.Config.npmRegistry),
        @('config','set','fetch-retries','5'),
        @('config','set','fetch-retry-factor','2'),
        @('config','set','fetch-retry-mintimeout','20000'),
        @('config','set','fetch-retry-maxtimeout','120000'),
        @('config','set','fund','false'),
        @('config','set','audit','false'),
        @('config','set','progress','false')
    )) {
        [void](Invoke-KnxCommand -FilePath $Context.NpmPath -CommandArguments $pair -WorkingDirectory $Context.RepositoryPath -LogPath $Context.NpmLog -AllowedExitCodes @(0,1) -Quiet)
    }

    try {
        $response = Invoke-WebRequest -Uri $Context.Config.npmRegistry -UseBasicParsing -Method Head -TimeoutSec 20
        Write-KnxMessage "npm registry reachable: HTTP $($response.StatusCode)" 'OK'
    } catch {
        Write-KnxMessage "Registry probe failed: $($_.Exception.Message). npm retries will still be attempted." 'WARN'
    }

    $attempts = [int]$Context.Config.installAttempts
    $installed = $false
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        Write-KnxMessage "npm install attempt $attempt of $attempts" 'INFO'

        if ($attempt -gt 1) {
            Stop-KnxRepoProcesses -RepositoryPath $Context.RepositoryPath
            Remove-KnxDirectoryRobust -Path (Join-Path $Context.RepositoryPath 'node_modules')
            $cacheTmp = Join-Path $env:LOCALAPPDATA 'npm-cache\_cacache\tmp'
            if (Test-Path -LiteralPath $cacheTmp) { Remove-KnxDirectoryRobust -Path $cacheTmp }
        }

        $installArgs = @('install','--prefer-online','--no-audit','--no-fund','--progress=false','--fetch-retries=5','--fetch-retry-mintimeout=20000','--fetch-retry-maxtimeout=120000')
        if ($attempt -eq $attempts) { $installArgs += '--legacy-peer-deps' }

        $result = Invoke-KnxCommand -FilePath $Context.NpmPath -CommandArguments $installArgs -WorkingDirectory $Context.RepositoryPath -LogPath $Context.NpmLog
        if ($result.Success) {
            $installed = $true
            break
        }

        $networkFailure = $result.Output -match 'ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up'
        $permissionFailure = $result.Output -match 'EPERM|EBUSY|operation not permitted'
        if ($networkFailure) { Write-KnxMessage 'Network interruption detected. The next attempt will use a clean partial install.' 'WARN' }
        if ($permissionFailure) { Write-KnxMessage 'Windows file lock detected. Repository-specific Node/Electron processes will be stopped before retry.' 'WARN' }
        if ($attempt -lt $attempts) { Start-Sleep -Seconds (10 * $attempt) }
    }

    if ($installed) {
        $Context.Gates['Dependencies'] = 'PASS'
        Write-KnxMessage 'Dependencies installed successfully.' 'OK'
        [void](Invoke-KnxCommand -FilePath $Context.NpmPath -CommandArguments @('ls','--depth=0') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.NpmLog -AllowedExitCodes @(0,1) -Quiet)
    } else {
        $Context.Gates['Dependencies'] = 'FAIL'
        Write-KnxMessage 'Dependencies could not be installed after all retries. Customization files remain protected on the Phase 01 branch.' 'ERROR'
    }
}
