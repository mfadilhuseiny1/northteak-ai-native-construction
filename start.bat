@echo off
rem Starts SiteSwarm: the API on port 8300 and the screens on port 8310. Add --no-browser to leave the browser alone.
cd /d "%~dp0"
if not exist ui\.next\BUILD_ID (
  pushd ui
  call npm install
  call npm run build
  popd
)
start "SiteSwarm API" cmd /k .venv\Scripts\python.exe -W ignore -m swarm.firm_api
start "SiteSwarm screens" /d ui cmd /k npx next start -p 8310
if not "%~1"=="--no-browser" (
  timeout /t 4 >nul
  start http://127.0.0.1:8310
)
