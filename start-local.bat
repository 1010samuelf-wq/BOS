@echo off
REM ============================================================
REM  BOS - one-click local launcher (backend + web dashboard)
REM  Double-click this file. It opens two windows:
REM    * Backend  -> http://localhost:8000  (SQLite dev DB)
REM    * Website  -> http://localhost:5173
REM  Close those two windows to stop everything.
REM ============================================================
setlocal
REM Make sure Node is reachable even if this shell has a stale PATH.
set "PATH=C:\Program Files\nodejs;%PATH%"
REM Run from this script's folder (the bos\ project root).
cd /d "%~dp0"

echo Starting BOS backend on http://localhost:8000 ...
start "BOS Backend (port 8000)" cmd /k ".venv\Scripts\python.exe dev_server.py"

echo Starting BOS web dashboard on http://localhost:5173 ...
start "BOS Web dashboard (port 5173)" cmd /k "cd web && npm run dev"

echo Waiting a few seconds for the servers to come up ...
timeout /t 6 >nul
start "" "http://localhost:5173"

echo.
echo BOS is starting in two separate windows.
echo   Website : http://localhost:5173   (log in with an employee PIN)
echo   Backend : http://localhost:8000/docs
echo.
echo To stop: close those two windows.
echo (You can close THIS window now.)
pause >nul
