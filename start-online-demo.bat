@echo off
setlocal
cd /d "%~dp0"
title Cafe Campus Online Demo (Production Resilient)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher-online.ps1"
if errorlevel 1 pause
exit /b %errorlevel%
