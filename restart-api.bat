@echo off
rem Restarts the NorthTeak API on port 8300: stops whoever is listening there, starts a fresh one,
rem and waits until it answers before saying so. The screens on 8310 keep running and pick it back up.
cd /d "%~dp0"

echo Stopping the API on port 8300...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -State Listen -LocalPort 8300 -ErrorAction SilentlyContinue; if (-not $c) { Write-Host 'Nothing is listening on port 8300.'; exit 0 }; foreach ($pid8300 in ($c.OwningProcess | Select-Object -Unique)) { $proc = Get-CimInstance Win32_Process -Filter \"ProcessId=$pid8300\" -ErrorAction SilentlyContinue; if ($proc -and $proc.CommandLine -match 'swarm\.firm_api') { Write-Host ('Stopping the NorthTeak API, PID ' + $pid8300); Stop-Process -Id $pid8300 -Force -ErrorAction SilentlyContinue } else { Write-Host ('Port 8300 belongs to PID ' + $pid8300 + ' (' + $proc.Name + '), which is not the NorthTeak API. Close it yourself first.'); exit 3 } }"
if errorlevel 3 (
  pause
  exit /b 1
)
powershell -NoProfile -Command "foreach ($i in 1..10) { if (-not (Get-NetTCPConnection -State Listen -LocalPort 8300 -ErrorAction SilentlyContinue)) { exit 0 }; Start-Sleep 1 }; exit 1" >nul 2>&1
if errorlevel 1 (
  echo Port 8300 is still in use. Close the old "NorthTeak API" window yourself, then run this again.
  pause
  exit /b 1
)

rem Each restart opens a new window and leaves the last one empty, so close the ones that run nothing now
powershell -NoProfile -Command "$all = Get-CimInstance Win32_Process; foreach ($w in $all) { if ($w.Name -eq 'cmd.exe' -and $w.CommandLine -match '/k\s+.*swarm\.firm_api' -and -not ($all | Where-Object { $_.ParentProcessId -eq $w.ProcessId -and $_.Name -ne 'conhost.exe' })) { Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue } }" >nul 2>&1

echo Starting the API...
start "NorthTeak API" cmd /k .venv\Scripts\python.exe -W ignore -m swarm.firm_api
powershell -NoProfile -Command "$ok=$false; foreach ($i in 1..60) { try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8300/api/project/overview' -TimeoutSec 2).StatusCode | Out-Null; $ok=$true; break } catch { Start-Sleep 1 } }; if ($ok) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo.
  echo The API did not come up on port 8300. Read the "NorthTeak API" window for the error.
  pause
  exit /b 1
)

echo API is up: http://127.0.0.1:8300
exit /b 0
