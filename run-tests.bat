@echo off
setlocal
cd /d "%~dp0"
set "NODEEXE="
if exist "%~dp0.runtime\node\node.exe" set "NODEEXE=%~dp0.runtime\node\node.exe"
if not defined NODEEXE where node >nul 2>nul && for /f "delims=" %%i in ('where node') do if not defined NODEEXE set "NODEEXE=%%i"
if not defined NODEEXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODEEXE (
  echo Jalankan start-demo.bat terlebih dahulu agar runtime otomatis disiapkan.
  pause
  exit /b 1
)
"%NODEEXE%" test-demo.mjs
pause
