@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Menghentikan Cafe Campus Demo

echo ======================================================================
echo           MENGHENTIKAN SERVER DAN TUNNEL CAFE CAMPUS
echo ======================================================================
echo.

:: 1. Hentikan launcher online jika aktif
set "LAUNCHER_PID=%~dp0.runtime\online-launcher.pid"
if exist "%LAUNCHER_PID%" (
    set /p LPID=<"%LAUNCHER_PID%"
    if defined LPID (
        taskkill /PID !LPID! /T /F >nul 2>nul
    )
    del /q "%LAUNCHER_PID%" >nul 2>nul
)

:: 2. Hentikan server berdasarkan .runtime\server.pid
set "PIDFILE=%~dp0.runtime\server.pid"
if exist "%PIDFILE%" (
    set /p DEMOPID=<"%PIDFILE%"
    if defined DEMOPID (
        taskkill /PID !DEMOPID! /T /F >nul 2>nul
    )
    del /q "%PIDFILE%" >nul 2>nul
)

:: 3. Hentikan Cloudflare Tunnel jika masih berjalan
taskkill /IM cloudflared.exe /F >nul 2>nul

set "CFPIDFILE=%~dp0.runtime\cloudflared.pid"
if exist "%CFPIDFILE%" del /q "%CFPIDFILE%" >nul 2>nul

:: 4. Pastikan port 4176 benar-benar bersih dari proses node yang tersisa
powershell -NoProfile -ExecutionPolicy Bypass -Command "$conns = Get-NetTCPConnection -LocalPort 4176 -ErrorAction SilentlyContinue; foreach ($c in $conns) { try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {} }"

echo [OK] Seluruh proses Cafe Campus Server dan Cloudflare Tunnel telah dihentikan dengan aman.
echo.
pause
