@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0scripts\Initialize-KnouxX.ps1" ^
  -ZipPath "D:\Knoux-x.zip" ^
  -RepositoryUrl "https://github.com/daynightae-cmyk/knoux-x.git" ^
  -WorkspaceRoot "D:\Knoux-X-Bootstrap"

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo KNOUX bootstrap failed with exit code %EXIT_CODE%.
) else (
  echo KNOUX bootstrap completed successfully.
)
pause
exit /b %EXIT_CODE%
