@echo off
echo Iniciando Scala Leads Scraper...

start "Backend - Scala Leads" cmd /k "cd /d "%~dp0backend" && python main.py"
timeout /t 3 /nobreak >nul
start "Frontend - Scala Leads" cmd /k "cd /d "%~dp0frontend" && npm run dev"
timeout /t 4 /nobreak >nul

echo.
echo Backend:  http://localhost:8010
echo Frontend: http://localhost:5173
echo.
start http://localhost:5173
