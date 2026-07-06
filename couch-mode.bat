@echo off
rem Double-click me after a reboot: starts the phone play-test server
rem (minimized window) and then a phone-steerable Claude Code session.
cd /d "%~dp0"
start "DEPTHS server" /min cmd /c "python -m http.server 8000 --bind 0.0.0.0"
echo.
echo  Play-test server running:  http://192.168.1.96:8000  (phone, same Wi-Fi)
echo  Starting phone-steerable Claude session - find it in the Claude app's Code tab.
echo  Keep this window open. Closing it ends the session.
echo.
claude remote-control
