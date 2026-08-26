@echo off
taskkill /F /IM AiwaPos58PrintService.exe >nul 2>nul
del /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AiwaPrinterStartup.bat" >nul 2>nul
rmdir /S /Q "%LOCALAPPDATA%\AiwaPrinter" >nul 2>nul
echo Aiwa print service removed. POS58 and AOKIA are unchanged.
pause
