@echo off
rem Starts Book Compare on this computer (no internet needed) and opens it in Edge.
title Book Compare
if not exist "%~dp0launcher\serve.ps1" (
  echo The folder "launcher" was not found next to this file.
  echo Please unzip the whole Book Compare download first, then start this file from the unzipped folder.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\serve.ps1"
if errorlevel 1 pause
