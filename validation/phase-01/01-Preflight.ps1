function Invoke-KnxPhase01Preflight {
    param([Parameter(Mandatory = $true)]$Context)

    Write-KnxMessage 'Running repository and toolchain preflight' 'STEP'

    if (-not (Test-Path -LiteralPath $Context.RepositoryPath -PathType Container)) {
        throw "Repository path does not exist: $($Context.RepositoryPath)"
    }
    foreach ($required in @('package.json','.git','src','electron')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Context.RepositoryPath $required))) {
            throw "Required project item is missing: $required"
        }
    }

    $Context.GitPath = Get-KnxCommandPath -Candidates @('git.exe','git')
    $Context.NodePath = Get-KnxCommandPath -Candidates @('node.exe','node')
    $Context.NpmPath = Get-KnxCommandPath -Candidates @('npm.cmd','npm.exe','npm')
    if (-not $Context.GitPath) { throw 'Git was not found in PATH.' }
    if (-not $Context.NodePath) { throw 'Node.js was not found in PATH.' }
    if (-not $Context.NpmPath) { throw 'npm.cmd was not found in PATH.' }

    $nodeResult = Invoke-KnxCommand -FilePath $Context.NodePath -CommandArguments @('--version') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog -Quiet
    $npmResult = Invoke-KnxCommand -FilePath $Context.NpmPath -CommandArguments @('--version') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog -Quiet
    $Context.NodeVersion = $nodeResult.Output.Trim()
    $Context.NpmVersion = $npmResult.Output.Trim()

    $majorText = ($Context.NodeVersion -replace '^v','').Split('.')[0]
    $major = 0
    [void][int]::TryParse($majorText, [ref]$major)
    if ($major -ne 20) {
        Write-KnxMessage "Node $($Context.NodeVersion) detected. Node 20 is the project baseline from .nvmrc; native modules may fail on other majors." 'WARN'
    } else {
        Write-KnxMessage "Node $($Context.NodeVersion) matches the project baseline." 'OK'
    }

    $branchResult = Invoke-KnxCommand -FilePath $Context.GitPath -CommandArguments @('branch','--show-current') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog -Quiet
    if (-not $branchResult.Success) { throw 'Unable to determine the current Git branch.' }
    $currentBranch = $branchResult.Output.Trim()

    if ($currentBranch -notlike ($Context.Config.phaseBranchPrefix + '*')) {
        $newBranch = $Context.Config.phaseBranchPrefix + (Get-Date -Format 'yyyyMMdd-HHmmss')
        $createBranch = Invoke-KnxCommand -FilePath $Context.GitPath -CommandArguments @('checkout','-b',$newBranch) -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog
        if (-not $createBranch.Success) { throw "Could not create customization branch $newBranch" }
        $Context.Branch = $newBranch
    } else {
        $Context.Branch = $currentBranch
        Write-KnxMessage "Reusing existing Phase 01 branch: $currentBranch" 'OK'
    }

    $backupRoot = Join-Path $Context.RepositoryPath ('backups\phase-01\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $Context.BackupRoot = $backupRoot

    foreach ($relative in @('package.json','package-lock.json','forge.config.js','tsconfig.json','.eslintrc.json','src\styles\global.css')) {
        $source = Join-Path $Context.RepositoryPath $relative
        if (Test-Path -LiteralPath $source) {
            $target = Join-Path $backupRoot $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath $source -Destination $target -Force
        }
    }

    $status = Invoke-KnxCommand -FilePath $Context.GitPath -CommandArguments @('status','--porcelain=v1') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog -Quiet
    Write-KnxUtf8File -Path (Join-Path $backupRoot 'git-status-before.txt') -Content ($status.Output + [Environment]::NewLine)
    $diff = Invoke-KnxCommand -FilePath $Context.GitPath -CommandArguments @('diff','--binary') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog -Quiet
    Write-KnxUtf8File -Path (Join-Path $backupRoot 'working-tree-before.patch') -Content ($diff.Output + [Environment]::NewLine)

    Write-KnxMessage "Safety backup created: $backupRoot" 'OK'
}
