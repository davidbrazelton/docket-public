@echo off
rem Starts Docket and opens it in its own window (open-docket.ps1). If Docket is already running, it only opens it.
rem This window is the Docket app. Sessions run in the runner (runner.mjs), which keeps them working when this window closes.
rem portal-events.log records every start, stop and crash with the reason.
cd /d "%~dp0"
netstat -ano | findstr ":4400" | findstr "LISTENING" >nul
if %errorlevel%==0 goto open
rem Open the page once Docket answers, so the browser never lands on a page that is not there yet.
start "" /b powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "for ($i = 0; $i -lt 240; $i++) { try { Invoke-WebRequest 'http://localhost:4400/' -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 250 } }; if (Test-Path '%~dp0open-docket.ps1') { & '%~dp0open-docket.ps1' } else { Start-Process 'http://localhost:4400' }"
title Docket (closing this window stops the app; sessions keep working)
:run
node server.mjs
rem 75 means the app restarted itself to take in a change
if %errorlevel%==75 goto run
exit /b
:open
rem A folder without open-docket.ps1 (a copy made from an older file list) still opens Docket, in a tab.
if not exist "%~dp0open-docket.ps1" (start "" http://localhost:4400 & exit /b)
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0open-docket.ps1"
