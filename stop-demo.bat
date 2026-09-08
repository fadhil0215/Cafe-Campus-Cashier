@echo off
setlocal
cd /d "%~dp0"
set "PIDFILE=%~dp0.runtime\server.pid"
if not exist "%PIDFILE%" (
  echo Cafe Campus Demo tidak menemukan proses server yang tercatat.
  pause
  exit /b 0
)
set /p DEMOPID=<"%PIDFILE%"
taskkill /PID %DEMOPID% /T /F >nul 2>nul
if errorlevel 1 (
  echo Server mungkin sudah berhenti.
) else (
  echo Cafe Campus Demo berhasil dihentikan.
)
del /q "%PIDFILE%" >nul 2>nul
pause
