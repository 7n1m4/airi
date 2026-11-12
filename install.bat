@echo off
setlocal

echo [1/3] Installing pnpm globally...
call npm install -g pnpm

echo [2/3] Installing project dependencies...
call pnpm install

echo [3/3] Building target packages...
call pnpm run build

echo.
echo ===================================================
echo  Installation complete! You can now launch AIRI:
echo    - Standard: start_airi.bat
echo    - Dual / Dedicated GPU: start_airi_hiperf.bat
echo ===================================================
echo.

endlocal
