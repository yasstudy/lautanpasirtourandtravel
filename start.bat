@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Lautan Pasir - Server Lokal

set "NODE=node"
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"

for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do set "%%A=%%B"
if not defined PORT set "PORT=3000"
if not defined HOST set "HOST=127.0.0.1"

echo ==================================================
echo   LAUTAN PASIR - SERVER LOKAL
echo ==================================================
echo   Website     : http://localhost:%PORT%
echo   Panel admin : http://localhost:%PORT%/admin/
echo   Login admin pertama kali: password muncul sekali di bawah ini, catat lalu ganti.
echo.
echo   Jangan tutup jendela ini selama web dipakai.
echo ==================================================
echo.

start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%/admin/"
"%NODE%" server.js
echo.
echo Server berhenti. Kalau ada error di atas, screenshot dan kirim ke admin.
pause
