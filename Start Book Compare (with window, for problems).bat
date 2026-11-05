@echo off
rem Same as "Start Book Compare.bat", but with a visible window that shows what is happening. Use it if Book Compare does not start.
title Book Compare
if not exist "%~dp0launcher\serve.ps1" (
  echo The folder "launcher" was not found next to this file.
  echo Please unzip the whole Book Compare download first, then double-click this file again.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\serve.ps1"
if errorlevel 1 pause
