@echo off
rem NexoMente: levanta todo en local y abre la app.
rem Primera vez: ver "Instalar" en README.md (venv del backend y npm install del frontend).
setlocal
cd /d "%~dp0"

if not exist "backend\venv\Scripts\python.exe" (
  echo Falta el entorno del backend. Ejecuta primero:
  echo   cd backend ^&^& python -m venv venv ^&^& venv\Scripts\python -m pip install -r requirements.txt
  pause
  exit /b 1
)
if not exist "frontend\node_modules" (
  echo Faltan las dependencias del frontend. Ejecuta primero:
  echo   cd frontend ^&^& npm install
  pause
  exit /b 1
)

rem Ollama (opcional): si esta instalado y apagado, se prende
where ollama >nul 2>&1
if %errorlevel%==0 (
  tasklist /fi "imagename eq ollama.exe" | find /i "ollama.exe" >nul || start "Ollama" /min ollama serve
)

start "NexoMente - backend" /min cmd /c "cd /d backend && venv\Scripts\python -m uvicorn app.main:app --port 8001"
start "NexoMente - frontend" /min cmd /c "cd /d frontend && npm run dev"

echo Iniciando NexoMente...
timeout /t 10 /nobreak >nul
start "" http://localhost:3000
echo Listo: http://localhost:3000  (cierra las ventanas "NexoMente" para apagarlo)
