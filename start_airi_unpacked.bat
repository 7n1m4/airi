@echo off
:: AIRI Tamagotchi - Unpacked Production Starter (Electrobun/Hutch)
:: Electrobun bundles its own CEF runtime and copies dependencies during
:: `hutch electrobun build`; there is no separate copy-deps or electron-builder step.

echo [1/2] Building packages...
call pnpm run build:packages

echo [2/2] Building Tamagotchi with Hutch/Electrobun...
call pnpm -F @proj-airi/stage-tamagotchi run build

echo Starting unpacked production application...
start "" "apps\stage-tamagotchi\artifacts\AIRI.exe"
