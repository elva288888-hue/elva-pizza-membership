@echo off
set "INSTALL_DIR=%LOCALAPPDATA%\AiwaPrinter"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0AiwaPos58PrintService.exe" "%INSTALL_DIR%\AiwaPos58PrintService.exe" >nul
(
  echo @echo off
  echo start "Aiwa POS58 Print Service" /min "%INSTALL_DIR%\AiwaPos58PrintService.exe"
) > "%STARTUP_DIR%\AiwaPrinterStartup.bat"
start "Aiwa POS58 Print Service" "%INSTALL_DIR%\AiwaPos58PrintService.exe"
