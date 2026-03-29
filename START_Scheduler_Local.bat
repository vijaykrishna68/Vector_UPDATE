@echo off
setlocal

cd /d "%~dp0"

REM Start the Node server in a minimized window
start "Scheduler Server" /min cmd /c "cd server && node server.js"

REM Wait briefly, then open the local site
timeout /t 2 >nul
start "Scheduler" "http://127.0.0.1:4000"

endlocal
