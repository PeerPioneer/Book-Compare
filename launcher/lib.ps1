# Book Compare helper - small shared functions (used by serve.ps1 and tray.ps1).
# Plain text on purpose: you can open this file in Notepad and read everything it does.

$script:LauncherDir = $PSScriptRoot
$script:IsWin = ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT)
$script:DataDirG = ''

function Get-DataDir([string]$override) {
  if ($override) { $d = $override }
  elseif ($script:IsWin -and $env:LOCALAPPDATA) { $d = Join-Path $env:LOCALAPPDATA 'BookCompare' }
  else { $d = Join-Path ([System.Environment]::GetFolderPath('UserProfile')) '.local/share/BookCompare' }
  if (-not (Test-Path -LiteralPath $d)) { [void](New-Item -ItemType Directory -Path $d -Force) }
  $script:DataDirG = $d
  return $d
}

# ---- a short log, so that problems can be found even though there is no window ------------------------------------------
function Write-Log([string]$text) {
  try {
    if (-not $script:DataDirG) { return }
    $f = Join-Path $script:DataDirG 'helper.log'
    if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -gt 200000)) { Move-Item -LiteralPath $f -Destination ($f + '.old') -Force }
    Add-Content -LiteralPath $f -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) -Encoding UTF8
  } catch { }
}

# ---- settings (what you answered on the first start, the folder windows start where you chose last) ----------------------
function Read-Settings {
  $h = @{ asked = $false; autostart = $false; desktop = $false; lastScans = ''; lastProject = '' }
  try {
    $f = Join-Path $script:DataDirG 'settings.json'
    if (Test-Path -LiteralPath $f) {
      $o = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($k in @('asked', 'autostart', 'desktop')) { if ($null -ne $o.$k) { $h[$k] = [bool]$o.$k } }
      foreach ($k in @('lastScans', 'lastProject')) { if ($null -ne $o.$k) { $h[$k] = [string]$o.$k } }
    }
  } catch { Write-Log ('settings could not be read: ' + $_.Exception.Message) }
  return $h
}
function Save-Settings($h) {
  try {
    $f = Join-Path $script:DataDirG 'settings.json'
    $json = '{"asked":' + $(if ($h.asked) { 'true' } else { 'false' }) + ',"autostart":' + $(if ($h.autostart) { 'true' } else { 'false' }) + ',"desktop":' + $(if ($h.desktop) { 'true' } else { 'false' }) +
      ',"lastScans":' + (ConvertTo-JsonString $h.lastScans) + ',"lastProject":' + (ConvertTo-JsonString $h.lastProject) + '}'
    [System.IO.File]::WriteAllText($f, $json, (New-Object System.Text.UTF8Encoding($false)))
  } catch { Write-Log ('settings could not be saved: ' + $_.Exception.Message) }
}

# A JSON string literal (written by hand: fast, and safe for any characters in folder names).
function ConvertTo-JsonString([string]$s) {
  if ($null -eq $s) { return 'null' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($c -eq 34) { [void]$sb.Append('\"') }
    elseif ($c -eq 92) { [void]$sb.Append('\\') }
    elseif ($c -lt 32 -or $c -eq 0x2028 -or $c -eq 0x2029) { [void]$sb.Append(('\u{0:x4}' -f $c)) }
    else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

# ---- pop-up windows (used when there is no console window) --------------------------------------------------------------
function New-TopOwner {
  Add-Type -AssemblyName System.Windows.Forms
  $o = New-Object System.Windows.Forms.Form
  $o.TopMost = $true; $o.ShowInTaskbar = $false; $o.StartPosition = 'Manual'
  $o.Location = New-Object System.Drawing.Point(-2000, -2000); $o.Size = New-Object System.Drawing.Size(1, 1)
  $o.Show()
  return $o
}
function Show-Message([string]$text, [bool]$isError = $false) {
  if ($script:IsWin) {
    try {
      $o = New-TopOwner
      [void][System.Windows.Forms.MessageBox]::Show($o, $text, 'Book Compare', 'OK', $(if ($isError) { 'Error' } else { 'Information' }))
      $o.Dispose()
      return
    } catch { }
  }
  Write-Host $text
}
function Ask-YesNo([string]$text) {
  if (-not $script:IsWin) { return $false }
  try {
    $o = New-TopOwner
    $r = [System.Windows.Forms.MessageBox]::Show($o, $text, 'Book Compare', 'YesNo', 'Question')
    $o.Dispose()
    return ($r -eq [System.Windows.Forms.DialogResult]::Yes)
  } catch { return $false }
}

# ---- shortcuts: start with Windows, Desktop ---------------------------------------------------------------------------
function Get-PsExe { return (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') }
function New-BcShortcut([string]$lnk, [string]$arguments, [string]$description) {
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = (Get-PsExe)
  $s.Arguments = $arguments
  $s.WorkingDirectory = $script:LauncherDir
  $s.Description = $description
  $s.WindowStyle = 7
  $ico = Join-Path $script:LauncherDir 'book-compare.ico'
  if (Test-Path -LiteralPath $ico) { $s.IconLocation = $ico }
  $s.Save()
}
function Get-StartupLink { return (Join-Path ([System.Environment]::GetFolderPath('Startup')) 'Book Compare helper.lnk') }
function Get-DesktopLink { return (Join-Path ([System.Environment]::GetFolderPath('Desktop')) 'Book Compare.lnk') }
function Test-Autostart { if (-not $script:IsWin) { return $false }; return (Test-Path -LiteralPath (Get-StartupLink)) }
function Set-Autostart([bool]$on) {
  if (-not $script:IsWin) { return }
  try {
    if ($on) { New-BcShortcut (Get-StartupLink) ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Hidden -NoBrowser' -f (Join-Path $script:LauncherDir 'serve.ps1')) 'Starts the Book Compare helper quietly when Windows starts' }
    else { Remove-Item -LiteralPath (Get-StartupLink) -Force -ErrorAction SilentlyContinue }
  } catch { Write-Log ('autostart: ' + $_.Exception.Message) }
}
function Set-DesktopShortcut([bool]$on) {
  if (-not $script:IsWin) { return }
  try {
    if ($on) { New-BcShortcut (Get-DesktopLink) ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Hidden' -f (Join-Path $script:LauncherDir 'serve.ps1')) 'Book Compare' }
    else { Remove-Item -LiteralPath (Get-DesktopLink) -Force -ErrorAction SilentlyContinue }
  } catch { Write-Log ('desktop shortcut: ' + $_.Exception.Message) }
}
