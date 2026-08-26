@echo off
set "SERVICE_FILE=%LOCALAPPDATA%\AiwaPrinter\AiwaPos58PrintService.ps1"
if not exist "%SERVICE_FILE%" (
  echo Print service is not installed. Run install.bat first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%SERVICE_FILE%"
