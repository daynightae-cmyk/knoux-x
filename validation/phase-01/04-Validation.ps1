function Invoke-KnxPhase01Validation {
    param([Parameter(Mandatory = $true)]$Context)

    Write-KnxMessage 'Running Phase 01 validation gates' 'STEP'

    $doctor = Invoke-KnxCommand -FilePath $Context.NodePath -CommandArguments @('tools/doctor.cjs') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.ValidationLog
    $Context.Gates['Doctor'] = $(if ($doctor.Success) { 'PASS' } else { 'FAIL' })

    if ($Context.Gates['Dependencies'] -ne 'PASS') {
        $Context.Gates['Typecheck'] = 'SKIPPED'
        $Context.Gates['Lint'] = 'SKIPPED'
        $Context.Gates['Package'] = 'SKIPPED'
        return
    }

    if ([bool]$Context.Config.runTypecheck) {
        $typecheck = Invoke-KnxCommand -FilePath $Context.NpmPath -CommandArguments @('run','typecheck') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.ValidationLog
        $Context.Gates['Typecheck'] = $(if ($typecheck.Success) { 'PASS' } else { 'FAIL' })
    } else { $Context.Gates['Typecheck'] = 'SKIPPED' }

    if ([bool]$Context.Config.runLint) {
        $lint = Invoke-KnxCommand -FilePath $Context.NpmPath -CommandArguments @('run','lint','--','--max-warnings=0') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.ValidationLog
        $Context.Gates['Lint'] = $(if ($lint.Success) { 'PASS' } else { 'FAIL' })
    } else { $Context.Gates['Lint'] = 'SKIPPED' }

    if ([bool]$Context.Config.runPackage) {
        $package = Invoke-KnxCommand -FilePath $Context.NpmPath -CommandArguments @('run','package') -WorkingDirectory $Context.RepositoryPath -LogPath $Context.ValidationLog
        $Context.Gates['Package'] = $(if ($package.Success) { 'PASS' } else { 'FAIL' })
    } else { $Context.Gates['Package'] = 'SKIPPED' }
}
