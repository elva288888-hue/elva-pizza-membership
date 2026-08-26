@echo off
setlocal EnableDelayedExpansion
set "PID_FILE=%LOCALAPPDATA%\AiwaPrinter\service.pid"
if exist "%PID_FILE%" (
  set /p SERVICE_PID=<"%PID_FILE%"
  taskkill /F /PID !SERVICE_PID! >nul 2>nul
)
del /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AiwaPrinterStartup.bat" >nul 2>nul
rmdir /S /Q "%LOCALAPPDATA%\AiwaPrinter" >nul 2>nul
echo Aiwa print service is removed. POS58 and AOKIA are unchanged.
pause
