@echo off
set "INSTALL_DIR=%LOCALAPPDATA%\AiwaPrinter"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0AiwaPos58PrintService.ps1" "%INSTALL_DIR%\AiwaPos58PrintService.ps1" >nul

(
  echo @echo off
  echo start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_DIR%\AiwaPos58PrintService.ps1"
) > "%STARTUP_DIR%\AiwaPrinterStartup.bat"

echo.
echo Aiwa POS58 print service files are installed.
echo A diagnostic PowerShell window will open now.
echo Keep that window open and test http://127.0.0.1:17891/health in Chrome.
echo.
start "Aiwa POS58 Print Service" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%INSTALL_DIR%\AiwaPos58PrintService.ps1"
