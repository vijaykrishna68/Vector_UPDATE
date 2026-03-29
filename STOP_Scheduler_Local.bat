@echo off
setlocal

REM Kill whatever is listening on port 4000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":4000 .*LISTENING"') do (
  taskkill /PID %%a /F
)

endlocal
