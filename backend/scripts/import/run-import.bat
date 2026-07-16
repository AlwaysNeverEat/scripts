@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pipeline-v2.ps1"
echo.
echo Конвейер остановлен. Можно закрыть это окно.
pause
