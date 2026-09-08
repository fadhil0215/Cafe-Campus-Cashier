@echo off
setlocal
cd /d "%~dp0"
title Cafe Campus Demo Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
exit /b %errorlevel%
