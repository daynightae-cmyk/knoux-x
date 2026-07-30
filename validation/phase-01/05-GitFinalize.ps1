function Invoke-KnxPhase01GitFinalize {
    param([Parameter(Mandatory = $true)]$Context)

    Write-KnxMessage 'Generating report and finalizing the customization branch' 'STEP'

    $failed = @($Context.Gates.GetEnumerator() | Where-Object { $_.Value -eq 'FAIL' })
    $skipped = @($Context.Gates.GetEnumerator() | Where-Object { $_.Value -eq 'SKIPPED' })
    if ($failed.Count -eq 0 -and $skipped.Count -eq 0) {
        $Context.Result = 'PASS'
    } else {
        $Context.Result = 'PARTIAL'
    }

    New-KnxPhaseReport -Context $Context

    if (-not [bool]$Context.Config.commitChanges) { return }

    $add = Invoke-KnxCommand -FilePath $Context.GitPath -CommandArguments @('add','-A') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog
    if (-not $add.Success) { throw 'git add failed.' }

    $status = Invoke-KnxCommand -FilePath $Context.GitPath -CommandArguments @('status','--porcelain=v1') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog -Quiet
    if ([string]::IsNullOrWhiteSpace($status.Output)) {
        Write-KnxMessage 'No new Git changes were detected.' 'WARN'
        return
    }

    $message = if ($Context.Result -eq 'PASS') {
        'feat: complete KNOUX Phase 01 foundation and first build'
    } else {
        'feat: apply KNOUX Phase 01 foundation with validation report'
    }
    $commit = Invoke-KnxCommand -FilePath $Context.GitPath -CommandArguments @('commit','-m',$message) -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog
    if (-not $commit.Success) { throw 'Git commit failed.' }

    if ([bool]$Context.Config.pushBranch -and -not $Context.NoPush) {
        $push = Invoke-KnxCommand -FilePath $Context.GitPath -CommandArguments @('push','-u','origin',$Context.Branch) -WorkingDirectory $Context.RepositoryPath -LogPath $Context.MasterLog
        if (-not $push.Success) { throw 'Git push failed.' }
        Write-KnxMessage "Branch pushed: $($Context.Branch)" 'OK'
    }
}
