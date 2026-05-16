@echo off
:: deploy_vercel.bat — Despliega apps/web a Vercel (produccion o preview)
:: 
:: Uso:
::   deploy_vercel.bat          → deploy a produccion
::   deploy_vercel.bat preview  → deploy preview branch
::
:: Requisitos:
::   - Vercel CLI instalado: npm install -g vercel
::   - Autenticado: vercel login
::   - Proyecto vinculado: apps/web/.vercel/project.json debe existir
::
:: El proyecto en Vercel se llama: etl-v1
:: Root Directory configurado en Vercel: apps/web

setlocal

set SCRIPT_DIR=%~dp0
set WEB_DIR=%SCRIPT_DIR%apps\web

echo.
echo ========================================
echo  ETL_V1 - Deploy a Vercel
echo ========================================
echo.

:: Verificar que Vercel CLI esta instalado
where vercel >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Vercel CLI no encontrado.
    echo Instalar con: npm install -g vercel
    pause
    exit /b 1
)

:: Verificar que el proyecto esta vinculado
if not exist "%WEB_DIR%\.vercel\project.json" (
    echo ERROR: Proyecto no vinculado a Vercel.
    echo Ejecutar primero: cd apps\web ^&^& vercel link
    pause
    exit /b 1
)

:: Ir al directorio del proyecto Next.js
cd /d "%WEB_DIR%"

:: Verificar dependencias instaladas
if not exist "node_modules" (
    echo Instalando dependencias...
    npm install
    if %ERRORLEVEL% neq 0 (
        echo ERROR: npm install fallo.
        pause
        exit /b 1
    )
)

:: Ejecutar build local para detectar errores antes del deploy
echo.
echo [1/2] Ejecutando build local...
npm run build
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Build local fallo. Corregir errores antes de desplegar.
    pause
    exit /b 1
)
echo Build local exitoso.

:: Deploy a Vercel
echo.
if "%1"=="preview" (
    echo [2/2] Desplegando preview a Vercel...
    vercel
) else (
    echo [2/2] Desplegando a PRODUCCION en Vercel...
    vercel --prod
)

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Deploy a Vercel fallo.
    echo Revisar: https://vercel.com/team_CZKhh9Ht7oXvYCK4ao8pNTic/etl-v1
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Deploy completado!
echo  URL: https://etl-v1.vercel.app
echo ========================================
echo.

cd /d "%SCRIPT_DIR%"
endlocal
