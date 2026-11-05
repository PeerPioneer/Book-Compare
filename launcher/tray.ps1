# Book Compare helper - the small icon near the clock (right-click: open, start with Windows, quit).
# This is a separate little program on purpose: if it ever has a problem, Book Compare itself keeps working.
# It closes by itself as soon as the helper is no longer running.
param(
  [int]$Port = 8765,
  [string]$DataDir = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
[void](Get-DataDir $DataDir)
$url = "http://localhost:$Port/"

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $created = $false
  $mutex = New-Object System.Threading.Mutex($true, "Local\BookCompareTray$Port", [ref]$created)
  if (-not $created) { exit 0 }                                    # an icon is already there

  function Ping-Helper {
    try {
      $r = [System.Net.WebRequest]::Create($url + 'api/ping'); $r.Timeout = 2000; $r.Proxy = $null
      $resp = $r.GetResponse(); $resp.Close(); return $true
    } catch { return $false }
  }
  function Quit-Helper {
    try {
      $r = [System.Net.WebRequest]::Create($url + 'api/quit'); $r.Method = 'POST'; $r.Timeout = 3000; $r.Proxy = $null
      $r.Headers.Add('X-BookCompare', '1'); $r.ContentLength = 0
      $resp = $r.GetResponse(); $resp.Close()
    } catch { Write-Log ('tray quit: ' + $_.Exception.Message) }
  }

  $icon = $null
  $icoFile = Join-Path $PSScriptRoot 'book-compare.ico'
  if (Test-Path -LiteralPath $icoFile) { try { $icon = New-Object System.Drawing.Icon($icoFile) } catch { $icon = $null } }
  if (-not $icon) { $icon = [System.Drawing.SystemIcons]::Application }

  $ni = New-Object System.Windows.Forms.NotifyIcon
  $ni.Icon = $icon
  $ni.Text = 'Book Compare'
  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $open = $menu.Items.Add('Open Book Compare')
  $auto = New-Object System.Windows.Forms.ToolStripMenuItem 'Start with Windows'
  $auto.CheckOnClick = $true
  $auto.Checked = (Test-Autostart)
  [void]$menu.Items.Add($auto)
  [void]$menu.Items.Add('-')
  $quit = $menu.Items.Add('Quit Book Compare')
  $ni.ContextMenuStrip = $menu
  $ni.Visible = $true

  $open.add_Click({ try { Start-Process $url } catch { } })
  $ni.add_DoubleClick({ try { Start-Process $url } catch { } })
  $auto.add_Click({
    Set-Autostart $auto.Checked
    $s = Read-Settings; $s.autostart = [bool]$auto.Checked; $s.asked = $true; Save-Settings $s
  })
  $quit.add_Click({ Quit-Helper; [System.Windows.Forms.Application]::Exit() })

  $script:misses = 0
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 5000
  $timer.add_Tick({
    if (Ping-Helper) { $script:misses = 0 } else { $script:misses++ }
    if ($script:misses -ge 2) { [System.Windows.Forms.Application]::Exit() }
  })
  $timer.Start()

  [System.Windows.Forms.Application]::Run()
} catch {
  Write-Log ('tray: ' + $_.Exception.Message)
} finally {
  try { $ni.Visible = $false; $ni.Dispose() } catch { }
}
