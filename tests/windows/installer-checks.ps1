# Book Compare installer (desktop program), checked on a real Windows machine (GitHub, .github/workflows/desktop.yml).
#   powershell -File tests\windows\installer-checks.ps1 <path of Book-Compare-Setup-x.y.z.exe>
# 1. Silent install into a folder of our choice (/D=...): program there, Start-menu AND Desktop shortcut (silent = both), test mode runs,
#    the uninstaller removes program and shortcuts.
# 2. The installer's pages clicked through like a person would: the "Choose Install Location" page is there, the new "Shortcuts" page
#    is there with both boxes ticked; "Desktop" is unticked, "Run Book Compare" on the last page is unticked. Result: Start-menu
#    shortcut yes, Desktop shortcut no. Then uninstalled again.
param([Parameter(Mandatory = $true)][string]$Setup)
$ErrorActionPreference = 'Stop'
$fail = 0
function Check($name, [scriptblock]$body) {
  try { & $body; Write-Host "  ok   $name" } catch { $script:fail++; Write-Host "  FAIL $name -- $($_.Exception.Message)" }
}
function Wait-Until([scriptblock]$cond, [int]$seconds) { $end = (Get-Date).AddSeconds($seconds); while ((Get-Date) -lt $end) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 250 }; return $false }

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Book Compare.lnk'
$startMenuAll = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Book Compare.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Book Compare.lnk'
$desktopAll = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Book Compare.lnk'
function Has-StartMenu { (Test-Path $startMenu) -or (Test-Path $startMenuAll) }
function Has-Desktop { (Test-Path $desktop) -or (Test-Path $desktopAll) }
function Uninstall($dir) {
  $un = Get-ChildItem $dir -Filter 'Uninstall*.exe' | Select-Object -First 1
  if (-not $un) { throw "no uninstaller in $dir" }
  Start-Process $un.FullName -ArgumentList '/S' -Wait
  [void](Wait-Until { -not (Test-Path (Join-Path $dir 'Book Compare.exe')) } 30)
}

Write-Host "installer: $Setup ($([math]::Round((Get-Item $Setup).Length / 1MB)) MB)"

# ---------------------------------------------------------------------------------------------- 1. silent, own folder
$dir1 = 'C:\BC-Test\Book Compare'
Check 'silent install into a chosen folder, both shortcuts, test mode, uninstall' {
  Start-Process $Setup -ArgumentList '/S', "/D=$dir1" -Wait
  $exe = Join-Path $dir1 'Book Compare.exe'
  if (-not (Test-Path $exe)) { throw "not installed in $dir1" }
  if (-not (Has-StartMenu)) { throw 'no Start-menu shortcut' }
  if (-not (Has-Desktop)) { throw 'no Desktop shortcut' }
  $out = Join-Path $env:TEMP 'bc-smoke-1.json'
  $p = Start-Process $exe -ArgumentList '--smoke-test', $out -PassThru -Wait
  Get-Content $out | Write-Host
  if ($p.ExitCode -ne 0) { throw "test mode failed (exit $($p.ExitCode))" }
  # project files (.bookcompare) open with Book Compare, and a project file given to the program opens
  $assoc = Get-ItemProperty -Path 'Registry::HKEY_CURRENT_USER\Software\Classes\.bookcompare' -ErrorAction SilentlyContinue
  if (-not $assoc) { $assoc = Get-ItemProperty -Path 'Registry::HKEY_LOCAL_MACHINE\Software\Classes\.bookcompare' -ErrorAction SilentlyContinue }
  if (-not $assoc) { throw '.bookcompare files are not registered' }
  $projDir = 'C:\BC-Test\proj'; New-Item -ItemType Directory -Force $projDir | Out-Null
  $projFile = Join-Path $projDir 'test.bookcompare'
  Set-Content -Path $projFile -Encoding UTF8 -Value '{"format":"book-compare-project","version":2,"projectId":"smoke","roots":[],"copies":[],"labels":{},"skip":{},"pair":[null,null],"sel":{"ci":null,"row":0}}'
  $out2 = Join-Path $env:TEMP 'bc-smoke-2.json'
  $p = Start-Process $exe -ArgumentList '--smoke-test', $out2, $projFile -PassThru -Wait
  Get-Content $out2 | Write-Host
  if ($p.ExitCode -ne 0) { throw "the project file did not open (exit $($p.ExitCode))" }
  Uninstall $dir1
  if (Test-Path $exe) { throw 'uninstall left the program behind' }
  if (Has-StartMenu) { throw 'uninstall left the Start-menu shortcut' }
  if (Has-Desktop) { throw 'uninstall left the Desktop shortcut' }
  if (Test-Path 'Registry::HKEY_CURRENT_USER\Software\Classes\.bookcompare') { $v = (Get-ItemProperty 'Registry::HKEY_CURRENT_USER\Software\Classes\.bookcompare').'(default)'; if ($v) { Write-Host "  note: .bookcompare still registered after uninstall ($v)" } }
}

# ---------------------------------------------------------------------------------------------- 2. the pages, clicked through
Add-Type -Namespace BcInst -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc p, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
public static string Text(IntPtr h) { System.Text.StringBuilder s = new System.Text.StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
public static string Cls(IntPtr h) { System.Text.StringBuilder s = new System.Text.StringBuilder(128); GetClassName(h, s, 128); return s.ToString(); }
// the visible top window of a process
public static IntPtr MainOf(uint pid) {
  IntPtr found = IntPtr.Zero;
  EnumWindows(delegate(IntPtr h, IntPtr l) { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h) && Cls(h) == "#32770") { found = h; return false; } return true; }, IntPtr.Zero);
  return found;
}
// all visible child texts (to know which page is showing)
public static string Texts(IntPtr top) {
  System.Text.StringBuilder all = new System.Text.StringBuilder();
  EnumChildWindows(top, delegate(IntPtr h, IntPtr l) { if (IsWindowVisible(h)) { string t = Text(h); if (t.Length > 0) all.Append(t).Append(" | "); } return true; }, IntPtr.Zero);
  return all.ToString();
}
// a visible button whose text contains the given words
public static IntPtr Button(IntPtr top, string part) {
  IntPtr found = IntPtr.Zero;
  EnumChildWindows(top, delegate(IntPtr h, IntPtr l) { if (IsWindowVisible(h) && Cls(h) == "Button" && Text(h).Replace("&", "").Contains(part)) { found = h; return false; } return true; }, IntPtr.Zero);
  return found;
}
'@
$BM_GETCHECK = 0xF0; $BM_SETCHECK = 0xF1; $WM_COMMAND = 0x111
$seen = @()
Check 'pages: install location, shortcuts (both ticked), untick Desktop -> Start menu only' {
  $p = Start-Process $Setup -PassThru
  $desktopBoxSeen = $false; $locationSeen = $false; $startBoxTicked = $false; $desktopBoxTicked = $false
  for ($i = 0; $i -lt 60 -and -not $p.HasExited; $i++) {
    $top = [IntPtr]::Zero
    [void](Wait-Until { $script:top = [BcInst.Native]::MainOf([uint32]$p.Id); $script:top -ne [IntPtr]::Zero } 20)
    $top = $script:top
    if ($top -eq [IntPtr]::Zero) { if ($p.HasExited) { break }; throw 'installer window not found' }
    Start-Sleep -Milliseconds 700
    $t = [BcInst.Native]::Texts($top)
    $script:seen += $t
    if ($t -match 'Destination Folder|Choose Install Location') { $locationSeen = $true }
    $desk = [BcInst.Native]::Button($top, 'icon on the Desktop')
    if ($desk -ne [IntPtr]::Zero) {
      $desktopBoxSeen = $true
      $desktopBoxTicked = ([int][BcInst.Native]::SendMessage($desk, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero) -eq 1)
      $sm = [BcInst.Native]::Button($top, 'Start menu')
      $startBoxTicked = ($sm -ne [IntPtr]::Zero) -and ([int][BcInst.Native]::SendMessage($sm, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero) -eq 1)
      [void][BcInst.Native]::SendMessage($desk, $BM_SETCHECK, [IntPtr]::Zero, [IntPtr]::Zero)          # untick "Desktop"
    }
    $run = [BcInst.Native]::Button($top, 'Run Book Compare')
    if ($run -ne [IntPtr]::Zero) { [void][BcInst.Native]::SendMessage($run, $BM_SETCHECK, [IntPtr]::Zero, [IntPtr]::Zero) }   # do not start it at the end
    $installing = $t -match 'Installing|Please wait'
    if (-not $installing) { [void][BcInst.Native]::PostMessage($top, $WM_COMMAND, [IntPtr]1, [IntPtr]::Zero) }  # "Next" / "Install" / "Finish"
    Start-Sleep -Milliseconds 1500
  }
  if (-not $p.HasExited) { $p.Kill(); throw "installer did not finish; pages seen: $($script:seen -join ' ### ')" }
  if (-not $locationSeen) { throw "no 'Choose Install Location' page; pages seen: $($script:seen -join ' ### ')" }
  if (-not $desktopBoxSeen) { throw "no 'Shortcuts' page; pages seen: $($script:seen -join ' ### ')" }
  if (-not ($startBoxTicked -and $desktopBoxTicked)) { throw 'both boxes should be ticked at first' }
  $hit = @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles) | ForEach-Object { Get-ChildItem $_ -Recurse -Depth 2 -Filter 'Book Compare.exe' -ErrorAction SilentlyContinue } | Select-Object -First 1
  if (-not $hit) { throw 'Book Compare.exe was not installed' }
  $exe = $hit.FullName
  Write-Host "  installed: $exe"
  if (-not (Has-StartMenu)) { throw 'no Start-menu shortcut although ticked' }
  if (Has-Desktop) { throw 'a Desktop shortcut although unticked' }
  Uninstall (Split-Path $exe)
  if (Has-StartMenu) { throw 'uninstall left the Start-menu shortcut' }
}

if ($fail) { Write-Host "$fail INSTALLER CHECK(S) FAILED"; exit 1 }
Write-Host 'ALL INSTALLER CHECKS PASSED'
