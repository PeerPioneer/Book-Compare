# Checks of the Windows-only parts of the Book Compare helper. Run by GitHub on a real Windows machine
# (see .github/workflows/windows-test.yml). They can not run on Linux.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:fail = 0
$script:progress = Join-Path $env:TEMP 'bc-progress.txt'
Remove-Item $script:progress -ErrorAction SilentlyContinue
function Note([string]$line) { Write-Host $line; Add-Content -Path $script:progress -Value $line -Encoding ASCII }
function Check([string]$name, [scriptblock]$test) {
  Note "START $name"
  try { $r = & $test; if ($r -is [bool] -and -not $r) { throw 'returned false' }; Note "PASS  $name" }
  catch { Note "FAIL  $name : $($_.Exception.Message)"; $script:fail++ }
}
function Get-BcProcesses([string]$script) {
  @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($script) })
}
function Wait-Until([scriptblock]$cond, [int]$seconds) {
  for ($i = 0; $i -lt $seconds * 2; $i++) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 500 }
  return $false
}
function Test-Ping { try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8765/api/ping' -TimeoutSec 2; return ($r.Content -match 'BookCompare') } catch { return $false } }

Check 'this is Windows PowerShell 5.1' { $PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1 }
Check 'all scripts are readable by this PowerShell' {
  foreach ($f in Get-ChildItem (Join-Path $root 'launcher\*.ps1')) {
    $e = $null; $t = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e)
    if ($e.Count) { throw "$($f.Name): $($e[0].Message) (line $($e[0].Extent.StartLineNumber))" }
  }
}
Check 'the icon file loads' { Add-Type -AssemblyName System.Drawing; $i = New-Object System.Drawing.Icon (Join-Path $root 'launcher\book-compare.ico'); $i.Width -gt 0 }

Check 'the folder window code compiles and talks to Windows' {
  $out = Join-Path $env:TEMP 'bc-selftest.txt'; Remove-Item $out -ErrorAction SilentlyContinue
  $env:BC_PICK_SELFTEST = '1'; $env:BC_PICK_OUT = $out; $env:BC_PICK_START = $env:TEMP
  $p = Start-Process powershell -ArgumentList ('-NoProfile -STA -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $root 'launcher\pickfolder.ps1')) -PassThru -Wait -WindowStyle Hidden
  $text = ''; if (Test-Path $out) { $text = (Get-Content $out -Raw).Trim() }
  Remove-Item Env:BC_PICK_SELFTEST
  if ($p.ExitCode -ne 0 -or $text -ne 'ok') { throw "exit $($p.ExitCode): $text" }
}

Check 'the folder window opens, and closing it counts as cancelled' {
  $out = Join-Path $env:TEMP 'bc-dialog.txt'; Remove-Item $out -ErrorAction SilentlyContinue
  $env:BC_PICK_OUT = $out; $env:BC_PICK_START = $env:TEMP; $env:BC_PICK_TITLE = 'Book Compare CI dialog'
  Add-Type -Namespace BcWin -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
public static string ListFor(uint pid) {
  System.Text.StringBuilder sb = new System.Text.StringBuilder();
  EnumWindows(delegate(IntPtr h, IntPtr l) {
    uint p; GetWindowThreadProcessId(h, out p);
    if (p == pid) {
      System.Text.StringBuilder t = new System.Text.StringBuilder(256); System.Text.StringBuilder c = new System.Text.StringBuilder(256);
      GetWindowText(h, t, 256); GetClassName(h, c, 256);
      sb.Append("[" + c + "|" + t + "|visible=" + IsWindowVisible(h) + "] ");
    }
    return true;
  }, IntPtr.Zero);
  return sb.ToString();
}
'@
  $p = Start-Process powershell -ArgumentList ('-NoProfile -STA -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $root 'launcher\pickfolder.ps1')) -PassThru -WindowStyle Hidden
  [void](Wait-Until { $script:h = [BcWin.Native]::FindWindow([NullString]::Value, 'Book Compare CI dialog'); $script:h -ne [IntPtr]::Zero } 30)
  Remove-Item Env:BC_PICK_TITLE
  if ($script:h -eq [IntPtr]::Zero) {
    $exited = $p.HasExited; $code = $(if ($exited) { $p.ExitCode } else { 'still running' })
    $wins = [BcWin.Native]::ListFor([uint32]$p.Id)
    $res = ''; if (Test-Path $out) { $res = (Get-Content $out -Raw) }
    $sess = (Get-Process -Id $PID).SessionId
    if (-not $p.HasExited) { $p.Kill() }
    throw ("the folder window did not appear. Process: $code. Its windows: $wins. Result file: $res. Interactive: $([Environment]::UserInteractive), session $sess")
  }
  [void][BcWin.Native]::PostMessage($script:h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)      # WM_CLOSE = the user cancels
  if (-not $p.WaitForExit(20000)) { $p.Kill(); throw 'the folder window did not close' }
  if ($p.ExitCode -ne 1) { throw "expected 'cancelled' (exit code 1), got $($p.ExitCode)" }
}

Check 'shortcuts for Windows start and Desktop are created and removed' {
  . (Join-Path $root 'launcher\lib.ps1')
  [void](Get-DataDir (Join-Path $env:TEMP 'bc-data'))
  Set-Autostart $true; Set-DesktopShortcut $true
  if (-not (Test-Autostart)) { throw 'start-with-Windows shortcut missing' }
  if (-not (Test-Path (Get-DesktopLink))) { throw 'desktop shortcut missing' }
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut((Get-StartupLink))
  if ($lnk.Arguments -notmatch 'serve\.ps1' -or $lnk.Arguments -notmatch '-Hidden') { throw "wrong arguments: $($lnk.Arguments)" }
  Set-Autostart $false; Set-DesktopShortcut $false
  if ((Test-Autostart) -or (Test-Path (Get-DesktopLink))) { throw 'shortcuts were not removed' }
}

Check 'the icon program (tray.ps1) starts and keeps running' {
  $dd = Join-Path $env:TEMP 'bc-tray-data'; New-Item -ItemType Directory -Force -Path $dd | Out-Null
  $err = Join-Path $env:TEMP 'bc-tray-err.txt'; $o = Join-Path $env:TEMP 'bc-tray-out.txt'
  Remove-Item $err, $o, (Join-Path $dd 'helper.log') -ErrorAction SilentlyContinue
  $p = Start-Process powershell -ArgumentList ('-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Port 8799 -DataDir "{1}"' -f (Join-Path $root 'launcher\tray.ps1'), $dd) -PassThru -WindowStyle Hidden -RedirectStandardError $err -RedirectStandardOutput $o
  Start-Sleep -Seconds 6
  $alive = -not $p.HasExited
  $info = "exit " + $(if ($alive) { 'none (still running)' } else { $p.ExitCode })
  foreach ($f in @($err, $o, (Join-Path $dd 'helper.log'))) { if (Test-Path $f) { $t = (Get-Content $f -Raw); if ($t) { $info += " | $(Split-Path $f -Leaf): $t" } } }
  if ($alive) { $p.Kill() }
  if (-not $alive) { throw $info }
}

Check 'the start file starts the helper hidden, the icon near the clock appears, quit stops both' {
  $dir = Join-Path $env:LOCALAPPDATA 'BookCompare'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  '{"asked":true,"autostart":false,"desktop":false,"lastScans":"","lastProject":""}' | Set-Content -Path (Join-Path $dir 'settings.json') -Encoding ASCII     # no first-start questions
  $bat = Start-Process -FilePath (Join-Path $root 'Start Book Compare.bat') -WindowStyle Hidden -PassThru       # (not "& cmd.exe": that would wait for the helper, which keeps running)
  if (-not $bat.WaitForExit(20000)) { throw 'the start file did not finish' }
  if ($bat.ExitCode -ne 0) { throw "the start file ended with code $($bat.ExitCode)" }
  if (-not (Wait-Until { Test-Ping } 40)) { throw 'the helper did not answer' }
  if (-not (Wait-Until { @(Get-BcProcesses 'tray.ps1').Count -ge 1 } 20)) { $lg = ''; $lf = Join-Path $dir 'helper.log'; if (Test-Path $lf) { $lg = Get-Content $lf -Raw }; throw ('the tray program is not running. helper.log: ' + $lg + ' | powershell processes: ' + ((Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object { $_.CommandLine }) -join ' ;; ')) }
  Start-Sleep -Seconds 4
  if (@(Get-BcProcesses 'tray.ps1').Count -lt 1) { throw ('the tray program stopped by itself. ' + (Get-Content (Join-Path $dir 'helper.log') -Raw)) }
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8765/index.html' -TimeoutSec 5
  if ($r.StatusCode -ne 200) { throw 'index.html not served' }
  $q = [System.Net.WebRequest]::Create('http://localhost:8765/api/quit'); $q.Method = 'POST'; $q.ContentLength = 0; $q.Headers.Add('X-BookCompare', '1')
  $q.GetResponse().Close()
  if (-not (Wait-Until { @(Get-BcProcesses 'serve.ps1').Count -eq 0 } 15)) { throw 'the helper did not stop' }
  if (-not (Wait-Until { @(Get-BcProcesses 'tray.ps1').Count -eq 0 } 25)) { throw 'the tray program did not stop' }
}
Write-Host ''
if ($script:fail) { Note "$($script:fail) check(s) failed"; Get-ChildItem (Join-Path $env:LOCALAPPDATA 'BookCompare\*.log') -ErrorAction SilentlyContinue | ForEach-Object { Note "--- $($_.Name)"; Get-Content $_.FullName | ForEach-Object { Note $_ } }; exit 1 }
Write-Host 'ALL WINDOWS CHECKS PASSED'
