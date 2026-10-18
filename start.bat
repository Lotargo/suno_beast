@echo off
title Suno Beast for Chrome / Edge
cd /d "%~dp0"
echo Opening Suno in your default browser. Use the Suno Beast extension to record.
node scripts\open-suno.js
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Application exited with error code %errorlevel%.
  pause
)
