@echo off
rem Starts NorthTeak: the API on port 8300 first, and the screens on port 8310 once the API answers.
rem Add --no-browser to leave the browser alone. Safe to run again: whatever is already up is left alone,
rem but only when what answers really is NorthTeak (the API's overview, the screens' title).
cd /d "%~dp0"
if not exist ui\.next\BUILD_ID (
  pushd ui
  call npm install
  if errorlevel 1 (
    popd
    echo npm install failed. Read the errors above, then run start.bat again.
    pause
    exit /b 1
  )
  call npm run build
  if errorlevel 1 (
    popd
    echo The screens did not build. Read the errors above, then run start.bat again.
    pause
    exit /b 1
  )
  popd
  set BUILT=1
)

call :up 8300 api/project/overview counts && (
  echo API already running on port 8300.
) || (
  start "NorthTeak API" cmd /k .venv\Scripts\python.exe -W ignore -m swarm.firm_api
  echo Waiting for the API on port 8300...
  call :wait 8300 api/project/overview counts 60
  if errorlevel 1 (
    echo.
    echo The API did not come up on port 8300. Read the "NorthTeak API" window for the error,
    echo fix what it says, then run start.bat again. The screens would only proxy errors until then.
    pause
    exit /b 1
  )
)

rem A server left running from before the build points at files the build replaced, which breaks its pages
if defined BUILT call restart-screens.bat --no-build

call :up 8310 "" NorthTeak && (
  echo Screens already running on port 8310.
) || (
  start "NorthTeak screens" /d ui cmd /k npx next start -p 8310
  call :wait 8310 "" NorthTeak 30
  if errorlevel 1 (
    echo.
    echo The screens did not come up on port 8310. Read the "NorthTeak screens" window for the error,
    echo then run start.bat again.
    pause
    exit /b 1
  )
)

if not "%~1"=="--no-browser" start http://127.0.0.1:8310
exit /b 0

:up
rem %1 port, %2 path, %3 text the answer must contain: exit 0 only when NorthTeak itself answers there
powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%~1/%~2' -TimeoutSec 2).Content -match '%~3') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%

:wait
rem %1 port, %2 path, %3 text the answer must contain, %4 seconds to wait for it
powershell -NoProfile -Command "$ok=$false; foreach ($i in 1..%~4) { try { if ((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%~1/%~2' -TimeoutSec 2).Content -match '%~3') { $ok=$true; break } } catch { Start-Sleep 1 } }; if ($ok) { exit 0 } else { exit 1 }" >nul 2>&1
exit /b %errorlevel%
