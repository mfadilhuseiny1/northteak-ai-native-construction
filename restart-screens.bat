@echo off
rem Rebuilds the screens and restarts them on port 8310. A build replaces the files a running server still
rem points at, which breaks its pages, so the two always go together. Add --no-build if it is already built.
cd /d "%~dp0"

if "%~1"=="--no-build" goto restart

powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'next.?\s+(build|dev)\b' }) { exit 3 }" >nul 2>&1
if errorlevel 3 (
  echo Another build or next dev is running in ui. Wait for it to finish, then run this again.
  pause
  exit /b 1
)
pushd ui
call npm run build
if errorlevel 1 (
  popd
  echo The screens did not build. Read the errors above, fix them, then run this again.
  pause
  exit /b 1
)
popd

:restart
echo Stopping the screens on port 8310...
powershell -NoProfile -Command "$all = Get-CimInstance Win32_Process; $c = Get-NetTCPConnection -State Listen -LocalPort 8310 -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $c) { Write-Host 'Nothing is listening on port 8310.'; exit 0 }; $p = $all | Where-Object { $_.ProcessId -eq $c.OwningProcess }; if ($p.CommandLine -notmatch 'next') { Write-Host ('Port 8310 belongs to PID ' + $p.ProcessId + ' (' + $p.Name + '), which is not the screens. Close it yourself first.'); exit 3 }; while ($p -and $p.Name -in 'node.exe','cmd.exe' -and $p.CommandLine -match 'next') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $up = $p.ParentProcessId; $p = $all | Where-Object { $_.ProcessId -eq $up } }"
if errorlevel 3 (
  pause
  exit /b 1
)
powershell -NoProfile -Command "foreach ($i in 1..10) { if (-not (Get-NetTCPConnection -State Listen -LocalPort 8310 -ErrorAction SilentlyContinue)) { exit 0 }; Start-Sleep 1 }; exit 1" >nul 2>&1
if errorlevel 1 (
  echo Port 8310 is still in use. Close the old "SiteSwarm screens" window yourself, then run this again.
  pause
  exit /b 1
)

echo Starting the screens...
rem Until accounts exist the screens listen only on this computer, so nothing is open to the network by accident.
set "LISTEN=127.0.0.1"
for /f %%a in ('.venv\Scripts\python.exe -W ignore -c "from swarm import accounts; print('0.0.0.0' if accounts.enabled() else '127.0.0.1')"') do set "LISTEN=%%a"
start "SiteSwarm screens" /d ui cmd /k npx next start -p 8310 -H %LISTEN%
powershell -NoProfile -Command "$ok=$false; foreach ($i in 1..30) { try { if ((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8310/' -TimeoutSec 2).Content -match 'SiteSwarm') { $ok=$true; break } } catch { Start-Sleep 1 } }; if ($ok) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo.
  echo The screens did not come up on port 8310. Read the "SiteSwarm screens" window for the error.
  pause
  exit /b 1
)

echo Screens are up: http://127.0.0.1:8310
exit /b 0
