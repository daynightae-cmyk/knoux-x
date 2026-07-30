@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "NODE_HOME=D:\Knoux-X-Bootstrap\.tools\node-v20.20.2-win-x64"
set "PATH=%NODE_HOME%;%PATH%"
call "%NODE_HOME%\npm.cmd" install --no-audit --no-fund
if errorlevel 1 exit /b %ERRORLEVEL%
call "%NODE_HOME%\npm.cmd" run doctor
if errorlevel 1 exit /b %ERRORLEVEL%
call "%NODE_HOME%\npm.cmd" run typecheck
if errorlevel 1 exit /b %ERRORLEVEL%
call "%NODE_HOME%\npm.cmd" run lint -- --max-warnings=0
if errorlevel 1 exit /b %ERRORLEVEL%
call "%NODE_HOME%\npm.cmd" test -- --runInBand --passWithNoTests
if errorlevel 1 exit /b %ERRORLEVEL%
call "%NODE_HOME%\npm.cmd" run package
if errorlevel 1 exit /b %ERRORLEVEL%
echo.
echo [PASS] KNOUX Phase 01 validation gates passed with zero lint warnings.
pause
exit /b 0
