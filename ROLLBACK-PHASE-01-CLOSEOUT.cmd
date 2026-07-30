@echo off
setlocal EnableExtensions
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $root=(Resolve-Path '.').Path; $base=Join-Path $root 'backups\phase-01-closeout'; if(-not(Test-Path $base)){throw 'No Phase 01 closeout backup directory found.'}; $latest=Get-ChildItem $base -Directory | Sort-Object Name -Descending | Select-Object -First 1; if(-not $latest){throw 'No Phase 01 closeout backup snapshot found.'}; Get-ChildItem $latest.FullName -Recurse -File | Where-Object {$_.Name -notin @('git-status-before.txt','working-tree-before.patch')} | ForEach-Object { $relative=$_.FullName.Substring($latest.FullName.Length).TrimStart('\'); $target=Join-Path $root $relative; New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null; Copy-Item $_.FullName $target -Force }; Write-Host ('[PASS] Restored backup: '+$latest.FullName) -ForegroundColor Green"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo [FAILED] Rollback failed with exit code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)
pause
exit /b 0
