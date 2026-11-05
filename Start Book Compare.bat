@echo off
rem Starts the Book Compare helper quietly in the background (no window) and opens Book Compare in your browser.
rem If something goes wrong, use "Start Book Compare (with window, for problems).bat" instead.
if not exist "%~dp0launcher\serve.ps1" (
  echo The folder "launcher" was not found next to this file.
  echo Please unzip the whole Book Compare download first, then double-click this file again.
  echo.
  pause
  exit /b 1
)
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0launcher\serve.ps1" -Hidden
exit /b 0
