@echo off
chcp 65001 >nul
title ETL Contable — Despliegue Local + Cloudflare Tunnel

:: ════════════════════════════════════════════════════════════════════════════
::  ETL CONTABLE — Script de Despliegue Local con Cloudflare Tunnel
::  Cada ejecución REINICIA todos los procesos desde cero
::  Autor: GitHub Copilot · ETL_V1 · 2026
:: ════════════════════════════════════════════════════════════════════════════

set "PROJECT_DIR=%~dp0"
set "LOG_DIR=%PROJECT_DIR%logs"
set "API_PORT=8000"
set "WEB_PORT=3000"
set "CLOUDFLARED_URL=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
set "CLOUDFLARED_BIN=%PROJECT_DIR%cloudflared.exe"
set "TUNNEL_LOG=%LOG_DIR%\tunnel.log"

:: ─── Crear carpeta de logs ───────────────────────────────────────────────────
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

call :header
call :step_banner "PASO 1/6" "Deteniendo procesos anteriores..."
call :stop_all

call :step_banner "PASO 2/6" "Verificando dependencias..."
call :check_deps

call :step_banner "PASO 3/6" "Construyendo e iniciando contenedores..."
call :start_containers

call :step_banner "PASO 4/6" "Esperando que los servicios estén listos..."
call :wait_healthy

call :step_banner "PASO 5/6" "Aplicando migraciones de base de datos..."
call :run_migrations

call :step_banner "PASO 6/6" "Iniciando Cloudflare Tunnel..."
call :start_tunnel

call :show_urls
call :footer
goto :eof


:: ════════════════════════════════════════════════════════════════════════════
::  FUNCIONES
:: ════════════════════════════════════════════════════════════════════════════

:header
echo.
echo  ╔══════════════════════════════════════════════════════════════════════╗
echo  ║          ETL CONTABLE SaaS — Sistema de Despliegue Local            ║
echo  ║                Reinicia y lanza todos los servicios                  ║
echo  ╚══════════════════════════════════════════════════════════════════════╝
echo.
echo  Directorio: %PROJECT_DIR%
echo  Fecha:      %DATE% %TIME%
echo.
goto :eof

:step_banner
echo.
echo  ┌──────────────────────────────────────────────────────────────────────┐
echo  │  %~1  →  %~2
echo  └──────────────────────────────────────────────────────────────────────┘
goto :eof

:stop_all
echo    [*] Terminando túnel de Cloudflare anterior...
taskkill /F /IM cloudflared.exe >nul 2>&1
echo    [*] Deteniendo y eliminando contenedores Docker anteriores...
cd /d "%PROJECT_DIR%"
docker compose down --remove-orphans --timeout 15 >nul 2>&1
:: Limpiar también contenedor suelto "etl-contable" si existe
docker rm -f etl-contable >nul 2>&1
docker rm -f etl_api etl_web etl_worker etl_postgres etl_redis etl_rabbitmq >nul 2>&1
echo    [OK] Procesos anteriores detenidos.
goto :eof

:check_deps
:: Docker
docker info >nul 2>&1
if errorlevel 1 (
    echo    [ERROR] Docker Desktop no está corriendo. Inícialo y vuelve a ejecutar este script.
    pause
    exit /b 1
)
echo    [OK] Docker Desktop está activo.

:: cloudflared
if not exist "%CLOUDFLARED_BIN%" (
    echo    [*] cloudflared.exe no encontrado. Descargando...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri '%CLOUDFLARED_URL%' -OutFile '%CLOUDFLARED_BIN%' -UseBasicParsing" 2>&1
    if not exist "%CLOUDFLARED_BIN%" (
        echo    [WARN] No se pudo descargar cloudflared. El túnel no estará disponible.
        echo    [WARN] Descarga manual: https://developers.cloudflare.com/cloudflared/install
    ) else (
        echo    [OK] cloudflared descargado.
    )
) else (
    echo    [OK] cloudflared.exe encontrado.
)
goto :eof

:start_containers
cd /d "%PROJECT_DIR%"
echo    [*] Construyendo imágenes Docker (puede tardar en la primera ejecución)...
echo.
docker compose build --progress=plain 2>&1
if errorlevel 1 (
    echo    [ERROR] Fallo en el build. Revisa los errores arriba.
    pause
    exit /b 1
)
echo.
echo    [*] Iniciando todos los contenedores en segundo plano...
docker compose up -d 2>&1
if errorlevel 1 (
    echo    [ERROR] Fallo al iniciar contenedores.
    pause
    exit /b 1
)
echo    [OK] Contenedores iniciados.
goto :eof

:wait_healthy
echo    [*] Esperando que API responda en puerto %API_PORT%...
set /a "WAIT_SECS=0"
set /a "MAX_WAIT=120"
:wait_loop
timeout /t 3 /nobreak >nul
set /a "WAIT_SECS+=3"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%API_PORT%/api/v1/health/live' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo    [OK] API lista en %WAIT_SECS%s.
    goto :wait_done
)
if %WAIT_SECS% LSS %MAX_WAIT% (
    echo    [..] Esperando... (%WAIT_SECS%s / %MAX_WAIT%s)
    goto :wait_loop
)
echo    [WARN] La API tardó más de %MAX_WAIT%s. Continuando de todas formas...
:wait_done
goto :eof

:run_migrations
echo    [*] Aplicando migraciones Alembic...
docker compose exec -T api alembic upgrade head 2>&1
if errorlevel 1 (
    echo    [WARN] Migraciones fallaron o ya están aplicadas. Continuando...
) else (
    echo    [OK] Migraciones aplicadas.
)
goto :eof

:start_tunnel
if not exist "%CLOUDFLARED_BIN%" (
    echo    [SKIP] cloudflared no disponible. Solo acceso local.
    goto :eof
)

echo    [*] Iniciando túnel Cloudflare para puerto %API_PORT% (API)...
start /B "" "%CLOUDFLARED_BIN%" tunnel --url http://localhost:%API_PORT% --logfile "%TUNNEL_LOG%" --no-autoupdate 2>&1

echo    [*] Iniciando túnel Cloudflare para puerto %WEB_PORT% (Web)...
start /B "" "%CLOUDFLARED_BIN%" tunnel --url http://localhost:%WEB_PORT% --logfile "%LOG_DIR%\tunnel_web.log" --no-autoupdate 2>&1

echo    [*] Esperando que el túnel se establezca (15s)...
timeout /t 15 /nobreak >nul

echo    [OK] Túneles iniciados. Extrayendo URLs públicas...
goto :eof

:show_urls
echo.
echo  ╔══════════════════════════════════════════════════════════════════════╗
echo  ║                   ✅  DESPLIEGUE COMPLETADO                          ║
echo  ╠══════════════════════════════════════════════════════════════════════╣
echo  ║                                                                      ║
echo  ║  ACCESO LOCAL                                                        ║
echo  ║  ─────────────────────────────────────────────────────────────────  ║
echo  ║  🌐  Frontend (Web)    →  http://localhost:3000                      ║
echo  ║  🔌  API REST          →  http://localhost:8000/api/v1               ║
echo  ║  📚  Swagger UI        →  http://localhost:8000/api/v1/docs          ║
echo  ║  🐰  RabbitMQ Admin    →  http://localhost:15672  (guest/guest)      ║
echo  ║                                                                      ║
echo  ║  ACCESO PÚBLICO — CLOUDFLARE TUNNEL                                  ║
echo  ║  ─────────────────────────────────────────────────────────────────  ║
:: Extraer URL del log del túnel API
powershell -NoProfile -Command "$log='%TUNNEL_LOG%'; if (Test-Path $log) { $url = (Select-String -Path $log -Pattern 'https://[a-z0-9\-]+\.trycloudflare\.com' | Select-Object -First 1).Matches.Value; if ($url) { Write-Host '  ║  🌍  API Pública  →  ' $url + '/api/v1' '                           ║' } else { Write-Host '  ║  [..] URL del tunel API en: logs\tunnel.log                          ║' } }"
powershell -NoProfile -Command "$log='%LOG_DIR%\tunnel_web.log'; if (Test-Path $log) { $url = (Select-String -Path $log -Pattern 'https://[a-z0-9\-]+\.trycloudflare\.com' | Select-Object -First 1).Matches.Value; if ($url) { Write-Host '  ║  🌍  Web Pública  →  ' $url '                                         ║' } else { Write-Host '  ║  [..] URL del tunel Web en: logs\tunnel_web.log                      ║' } }"
echo  ║                                                                      ║
echo  ║  CONTENEDORES ACTIVOS                                                ║
echo  ╠══════════════════════════════════════════════════════════════════════╣
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>&1
echo  ╠══════════════════════════════════════════════════════════════════════╣
echo  ║  Logs en tiempo real:  docker compose logs -f                        ║
echo  ║  Detener todo:         docker compose down                           ║
echo  ╚══════════════════════════════════════════════════════════════════════╝
echo.
goto :eof

:footer
echo  Presiona cualquier tecla para ver los logs en tiempo real...
echo  (Ctrl+C para salir de los logs — los servicios seguirán corriendo)
echo.
pause >nul
docker compose logs -f --tail=50
goto :eof
