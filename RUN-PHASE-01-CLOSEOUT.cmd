@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "NODE_HOME=D:\Knoux-X-Bootstrap\.tools\node-v20.20.2-win-x64"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\phase-01-closeout\Invoke-KnouxPhase01Closeout.ps1" -RepositoryRoot "%~dp0" -NodeHome "%NODE_HOME%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [FAILED] KNOUX Phase 01 closeout preparation failed with exit code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)
echo.
echo [PASS] Source repairs applied. Run VERIFY-PHASE-01-CLOSEOUT.cmd next.
pause
exit /b 0
