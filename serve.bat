@echo off
cd /d "%~dp0"
echo.
echo  Serving DEPTHS on this PC.
echo    On this PC:      http://localhost:8000
echo    On your phone:   http://THIS-PCS-WIFI-IP:8000   (same Wi-Fi network)
echo.
python -m http.server 8000 --bind 0.0.0.0
