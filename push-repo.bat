@echo off
title Cafe Campus - Push ke GitHub Repository
cd /d "%~dp0"

echo ======================================================================
echo           CAFE CAMPUS - PUSH PROJECT KE GITHUB REPOSITORY
echo ======================================================================
echo.
echo Remote URL: https://github.com/fadhil0215/Cafe-Campus-Cashier.git
echo Cabang    : main & hardening
echo.
echo Memastikan build frontend terbaru...
call npm run build
echo.
echo [1/2] Menjalankan git push origin main...
git push origin main
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Gagal push ke branch main!
    echo Jika diminta login GitHub, silakan selesaikan login di browser/pop-up.
    echo Atau gunakan GitHub Personal Access Token (PAT).
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/2] Menjalankan git push origin hardening...
git push origin hardening
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Gagal push ke branch hardening!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ======================================================================
echo   [OK] SEMUA FILE DAN PERUBAHAN BERHASIL DIPUSH KE GITHUB!
echo   Repo: https://github.com/fadhil0215/Cafe-Campus-Cashier.git
echo ======================================================================
echo.
pause
