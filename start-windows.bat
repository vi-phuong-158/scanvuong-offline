@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py server.py
  exit /b
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  exit /b
)
echo Khong tim thay Python tren may.
echo Co the mo index.html truc tiep, nhung che do cai PWA/offline cache can localhost hoac HTTPS.
pause
