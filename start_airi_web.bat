@echo off
:: AIRI Web - Local Dev Starter
:: Use this for a simple, one-click startup.

set /p PORT_NUM="Enter port (default 5173): "
if "%PORT_NUM%"=="" set PORT_NUM=5173

echo [1/2] Building packages...
call pnpm run build:packages

echo [2/2] Starting Web version on Port %PORT_NUM%...
call pnpm -F @proj-anima/stage-web run dev --port %PORT_NUM%
