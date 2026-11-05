@echo off
rem Stops the Book Compare helper (the same as "Quit Book Compare" in the icon near the clock).
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $r = [Net.WebRequest]::Create('http://localhost:8765/api/quit'); $r.Method = 'POST'; $r.Headers.Add('X-BookCompare', '1'); $r.ContentLength = 0; $r.Proxy = $null; $r.GetResponse().Close(); 'Book Compare was stopped.' } catch { 'Book Compare is not running.' }"
echo.
pause
