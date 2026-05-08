@echo off
title Refocus Clipboard Watcher

set "PROJECT_DIR=C:\Users\boka9\refocus-crm"
set "SCRIPT=%PROJECT_DIR%\scripts\clipboard-watcher.ps1"

if not exist "%SCRIPT%" (
    echo [ERROR] Watcher script not found at:
    echo   %SCRIPT%
    echo.
    echo Make sure Refocus CRM project is at:
    echo   %PROJECT_DIR%
    echo.
    pause
    exit /b 1
)

powershell -STA -ExecutionPolicy Bypass -File "%SCRIPT%"

echo.
echo ============================================
echo  Watcher stopped. Press any key to close...
echo ============================================
pause >nul
