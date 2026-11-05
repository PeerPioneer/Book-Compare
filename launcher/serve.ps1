# Book Compare helper
# Runs on THIS computer only (address http://localhost:8765/). It does two things:
#   1. hands the Book Compare program files (the folder "app") to your browser, and
#   2. reads your scan folders for Book Compare, so that the browser never has to ask for permission to every folder.
# Nothing is uploaded anywhere and no internet connection is needed. Scan folders are only READ. The only thing this helper
# ever writes is the one project file (book-compare-project.json) in the project folder you chose.
# Only Book Compare running in a browser on this computer can talk to it (other web sites are refused).
param(
  [int]$Port = 8765,
  [switch]$NoBrowser,                 # do not open the browser
  [switch]$Hidden,                    # no console window: messages appear as pop-up windows
  [switch]$NoTray,                    # no icon near the clock
  [switch]$NoSetup,                   # do not ask the questions of the first start
  [string]$DataDir = '',              # where the settings and the log are kept (default: %LOCALAPPDATA%\BookCompare)
  [string]$TestPickFile = ''          # for automatic tests only: a file with folder paths to hand out instead of the Windows folder window
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
[void](Get-DataDir $DataDir)

$HelperVersion = '1.0'
$appDir  = Join-Path (Split-Path -Parent $PSScriptRoot) 'app'
$sep     = [System.IO.Path]::DirectorySeparatorChar
$appRoot = [System.IO.Path]::GetFullPath($appDir).TrimEnd('\', '/') + $sep
$url     = "http://localhost:$Port/"
$script:AllowedHosts   = @("localhost:$Port", "127.0.0.1:$Port")
$script:AllowedOrigins = @("http://localhost:$Port", "http://127.0.0.1:$Port")
$script:Roots = @{}                 # folders Book Compare may read (scans) or write its project file into (project), by random id
$script:Stop = $false
$script:Pending = $null             # a folder window that is open right now
$script:TrayProc = $null
$script:PathComparison = $(if ($script:IsWin) { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal })
$script:ImgExt = @('.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp', '.gif')
$script:ProjectFile = 'book-compare-project.json'
$script:BadName = @([System.IO.Path]::GetInvalidFileNameChars()) + @([char]':', [char]'\', [char]'/')
$script:Epoch = New-Object System.DateTime 1970, 1, 1, 0, 0, 0, ([System.DateTimeKind]::Utc)

function Say([string]$text, [bool]$isError = $false) {
  Write-Log $text
  if ($Hidden) { Show-Message $text $isError } else { Write-Host $text }
}
function Wait-Close {
  if ($Hidden) { return }
  Write-Host ''
  try { [void](Read-Host 'Press Enter to close this window') } catch { }
}

if (-not (Test-Path -LiteralPath (Join-Path $appDir 'index.html'))) {
  Say ('The folder "app" was not found next to the folder "launcher".' + [Environment]::NewLine + 'Please unzip the whole Book Compare download first, and start the launcher from the unzipped folder.') $true
  Wait-Close
  exit 1
}

function Open-App {
  if ($NoBrowser) { return }
  try { Start-Process $url } catch { Write-Log ('browser: ' + $_.Exception.Message) }
}
function Test-AlreadyRunning {
  try {
    $r = [System.Net.WebRequest]::Create($url + 'index.html')
    $r.Method = 'HEAD'; $r.Timeout = 2000; $r.Proxy = $null
    $resp = $r.GetResponse()
    $ours = ($resp.Headers['X-Served-By'] -eq 'BookCompareLauncher')
    $resp.Close()
    return $ours
  } catch { return $false }
}

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'; '.map' = 'application/json'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'; '.otf' = 'font/otf'; '.wasm' = 'application/wasm'
  '.txt' = 'text/plain; charset=utf-8'; '.tif' = 'image/tiff'; '.tiff' = 'image/tiff'; '.webp' = 'image/webp'; '.bmp' = 'image/bmp'
}

# ---------------------------------------------------------------------------------------------------------------- starting
function Get-RunningInfo {            # the answer of a Book Compare helper that already uses our port (text), or $null
  try {
    $r = [System.Net.WebRequest]::Create($url + 'api/ping'); $r.Timeout = 2000; $r.Proxy = $null
    $resp = $r.GetResponse()
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $txt = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
    if ($txt -match '"app":"BookCompare"') { return $txt }
  } catch { }
  return $null
}
function Stop-Running {
  try {
    $r = [System.Net.WebRequest]::Create($url + 'api/quit'); $r.Method = 'POST'; $r.Timeout = 3000; $r.Proxy = $null
    $r.Headers.Add('X-BookCompare', '1'); $r.ContentLength = 0
    $resp = $r.GetResponse(); $resp.Close()
  } catch { Write-Log ('could not stop the other helper: ' + $_.Exception.Message) }
}
$listener = $null
for ($attempt = 0; $attempt -lt 2 -and -not $listener; $attempt++) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add($url)
  try { $l.Start(); $listener = $l; break }
  catch {
    $startError = $_.Exception.Message
    $info = Get-RunningInfo
    if ($info) {
      if ($info -match [regex]::Escape((ConvertTo-JsonString $appRoot))) {            # the same copy of Book Compare is running already
        Write-Log 'already running; opening the browser'
        if (-not $Hidden) { Write-Host 'Book Compare is already running. Opening it ...' }
        Open-App
        Start-Sleep -Seconds 1
        exit 0
      }
      Write-Log 'a helper from another folder is running: asking it to stop'          # e.g. an older download: this one takes over
      Stop-Running
      for ($w = 0; $w -lt 20; $w++) { Start-Sleep -Milliseconds 500; if (-not (Get-RunningInfo)) { break } }
      continue
    }
    if (Test-AlreadyRunning) {
      Say ('An older Book Compare is still running (it has a black window).' + [Environment]::NewLine + 'Please close that window, then start Book Compare again.') $true
      Wait-Close
      exit 1
    }
    Say ("Book Compare could not start on port $Port. Another program is using it." + [Environment]::NewLine + "(Technical message: $startError)" + [Environment]::NewLine + 'Close that program, or ask for help.') $true
    Wait-Close
    exit 1
  }
}
if (-not $listener) {
  Say 'Book Compare could not take over from the other copy that is running. Please quit it (icon near the clock) and try again.' $true
  Wait-Close
  exit 1
}
Write-Log ("helper $HelperVersion started on port $Port (hidden=$([bool]$Hidden))")

# The questions of the very first start
if ($script:IsWin -and -not $NoSetup) {
  $settings = Read-Settings
  if ($settings.asked) { Update-Shortcuts }
  if (-not $settings.asked) {
    $a = Ask-YesNo ('Book Compare will now run quietly in the background (look for its icon near the clock).' + [Environment]::NewLine + [Environment]::NewLine + 'Start it automatically when Windows starts? Then it is always ready, and you never need to start anything yourself.' + [Environment]::NewLine + 'You can change this later with a right-click on the icon.')
    $b = Ask-YesNo 'Put a Book Compare shortcut on your Desktop?'
    Set-Autostart $a; Set-DesktopShortcut $b
    $settings.asked = $true; $settings.autostart = $a; $settings.desktop = $b
    Save-Settings $settings
  }
}
if ($script:IsWin -and -not $NoTray) {
  try {
    $trayScript = Join-Path $PSScriptRoot 'tray.ps1'
    $script:TrayProc = Start-Process -FilePath (Get-PsExe) -ArgumentList ('-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Port {1} -DataDir "{2}"' -f $trayScript, $Port, $script:DataDirG) -WindowStyle Hidden -PassThru
  } catch { Write-Log ('tray: ' + $_.Exception.Message) }
}
if (-not $Hidden) {
  try { $Host.UI.RawUI.WindowTitle = 'Book Compare helper - close this window to stop it' } catch { }
  Write-Host '================================================================'
  Write-Host ' Book Compare is running.'
  Write-Host " Address: $url   (works on this computer only, no internet needed)"
  Write-Host ''
  Write-Host ' Keep this window open while you use Book Compare in the browser.'
  Write-Host ' Close this window to stop it.'
  Write-Host '================================================================'
}
Open-App

# ----------------------------------------------------------------------------------------------------------------- sending
function Get-Ms($dt) { return [long]($dt.ToUniversalTime() - $script:Epoch).TotalMilliseconds }
function Send-Bytes($res, [int]$code, [string]$ctype, [byte[]]$b) {
  $res.StatusCode = $code
  $res.ContentType = $ctype
  $res.ContentLength64 = $b.Length
  if ($b.Length -gt 0) { $res.OutputStream.Write($b, 0, $b.Length) }
}
function Send-Plain($res, [int]$code, [string]$text) { Send-Bytes $res $code 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($text)) }
function Send-Json($res, [int]$code, [string]$json) {
  $res.Headers.Add('Cache-Control', 'no-store')
  Send-Bytes $res $code 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($json))
}
function Send-Err($res, [int]$code, [string]$err, [string]$msg = '') { Send-Json $res $code ('{"error":' + (ConvertTo-JsonString $err) + ',"message":' + (ConvertTo-JsonString $msg) + '}') }

# ---------------------------------------------------------------------------------------------------- folders Book Compare may use
function Get-Root($req) {
  $id = $req.QueryString['root']
  if ($id -and $script:Roots.ContainsKey($id)) { return $script:Roots[$id] }
  return $null
}
function Register-Root([string]$path, [string]$kind) {
  if (-not $path) { return $null }
  if (-not [System.IO.Path]::IsPathRooted($path)) { return $null }
  try { $full = [System.IO.Path]::GetFullPath($path) } catch { return $null }
  $pr = [System.IO.Path]::GetPathRoot($full)
  if ($full.Length -gt $pr.Length) { $full = $full.TrimEnd('\', '/') }
  if (-not (Test-Path -LiteralPath $full -PathType Container)) { return $null }
  foreach ($k in @($script:Roots.Keys)) {
    $r = $script:Roots[$k]
    if ($r.kind -eq $kind -and [string]::Equals($r.path, $full, $script:PathComparison)) { return @{ id = $k; root = $r } }
  }
  $name = [System.IO.Path]::GetFileName($full)
  if (-not $name) { $name = $full.TrimEnd('\', '/') }
  $id = [System.Guid]::NewGuid().ToString('N')
  $r = @{ path = $full; kind = $kind; name = $name }
  $script:Roots[$id] = $r
  return @{ id = $id; root = $r }
}
function Root-Json([string]$id, $r) {
  return '{"id":' + (ConvertTo-JsonString $id) + ',"path":' + (ConvertTo-JsonString $r.path) + ',"name":' + (ConvertTo-JsonString $r.name) + ',"kind":' + (ConvertTo-JsonString $r.kind) + '}'
}
# folder or file inside a root, from a path with "/" between the parts; null if it would leave the root
function Resolve-InRoot($r, [string]$rel) {
  $rel = $rel.Trim('/')
  if ($rel -eq '') { return $r.path }
  $parts = $rel.Split('/')
  foreach ($p in $parts) {
    if ($p -eq '' -or $p -eq '.' -or $p -eq '..' -or $p.IndexOfAny($script:BadName) -ge 0) { return $null }
  }
  try { $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($r.path, ($parts -join $sep))) } catch { return $null }
  $base = $r.path.TrimEnd('\', '/') + $sep
  if (-not $full.StartsWith($base, $script:PathComparison)) { return $null }
  return $full
}
function Test-ImageName([string]$name) { return ($script:ImgExt -contains [System.IO.Path]::GetExtension($name).ToLowerInvariant()) }

function Read-Body($req, [int]$max) {
  $ms = New-Object System.IO.MemoryStream
  $buf = New-Object byte[] 65536
  $total = 0
  while (($n = $req.InputStream.Read($buf, 0, $buf.Length)) -gt 0) {
    $total += $n
    if ($total -gt $max) { throw 'too large' }
    $ms.Write($buf, 0, $n)
  }
  return $ms.ToArray()
}
function Read-JsonBody($req) {
  $b = Read-Body $req 65536
  if ($b.Length -eq 0) { return $null }
  return ([System.Text.Encoding]::UTF8.GetString($b) | ConvertFrom-Json)
}

# ------------------------------------------------------------------------------------------------- the Windows folder window
function Get-StartDir([string]$requested, [string]$kind) {
  $cand = $requested
  if (-not $cand) {
    $s = Read-Settings
    $last = $(if ($kind -eq 'project') { $s.lastProject } else { $s.lastScans })
    if ($last) { try { $cand = Split-Path -Parent $last } catch { $cand = '' } }
  }
  for ($i = 0; $i -lt 40 -and $cand; $i++) {
    try { if (Test-Path -LiteralPath $cand -PathType Container) { return $cand } } catch { }
    try { $p = Split-Path -Parent $cand } catch { break }
    if ($p -eq $cand) { break }
    $cand = $p
  }
  return ''
}
function Finish-Pick($res, [string]$kind, [string]$chosen) {
  $reg = Register-Root $chosen $kind
  if (-not $reg) { Send-Err $res 404 'not-found' 'That folder does not exist.'; return }
  $s = Read-Settings
  if ($kind -eq 'project') { $s.lastProject = $reg.root.path } else { $s.lastScans = $reg.root.path }
  Save-Settings $s
  Send-Json $res 200 (Root-Json $reg.id $reg.root)
}
function Start-Pick($ctx, $body) {
  $res = $ctx.Response
  $kind = $(if ($body -and $body.kind -eq 'project') { 'project' } else { 'scans' })
  $requested = $(if ($body -and $body.start) { [string]$body.start } else { '' })
  $start = Get-StartDir $requested $kind
  if ($TestPickFile) {                                               # automatic tests: hand out the next path from the file
    $lines = @()
    if (Test-Path -LiteralPath $TestPickFile) { $lines = @(Get-Content -LiteralPath $TestPickFile -Encoding UTF8 | Where-Object { $_.Trim() -ne '' }) }
    if ($lines.Count -eq 0) { Send-Json $res 200 '{"cancelled":true}'; return $false }
    $first = $lines[0].Trim()
    if ($lines.Count -gt 1) { [System.IO.File]::WriteAllLines($TestPickFile, [string[]]$lines[1..($lines.Count - 1)]) } else { [System.IO.File]::WriteAllText($TestPickFile, '') }
    if ($first -eq 'FAIL') { Send-Err $res 501 'no-dialog' 'test: no folder window'; return $false }
    if ($first -eq 'CANCEL') { Send-Json $res 200 '{"cancelled":true}'; return $false }
    Finish-Pick $res $kind $first
    return $false
  }
  if (-not $script:IsWin) { Send-Err $res 501 'no-dialog' 'This computer cannot show a folder window.'; return $false }
  if ($script:Pending) { Send-Err $res 409 'busy' 'A folder window is already open.'; return $false }
  $title = $(if ($kind -eq 'project') { 'Book Compare: choose the project folder (not one of your scan folders)' } else { 'Book Compare: choose the folder with the scans' })
  $outFile = Join-Path $script:DataDirG ('pick-' + [System.Guid]::NewGuid().ToString('N') + '.txt')
  try {
    $env:BC_PICK_START = $start; $env:BC_PICK_TITLE = $title; $env:BC_PICK_OUT = $outFile
    $p = Start-Process -FilePath (Get-PsExe) -ArgumentList ('-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $PSScriptRoot 'pickfolder.ps1')) -WindowStyle Hidden -PassThru
  } catch {
    Write-Log ('folder window could not be started: ' + $_.Exception.Message)
    Send-Err $res 501 'no-dialog' 'The folder window could not be started.'; return $false
  } finally {
    Remove-Item Env:BC_PICK_START, Env:BC_PICK_TITLE, Env:BC_PICK_OUT -ErrorAction SilentlyContinue
  }
  $script:Pending = @{ ctx = $ctx; proc = $p; out = $outFile; kind = $kind; started = Get-Date }
  return $true                                                       # the answer is sent when the window is closed
}
function Poll-Pick {
  $pd = $script:Pending
  if (-not $pd) { return }
  $res = $pd.ctx.Response
  $timedOut = (((Get-Date) - $pd.started).TotalMinutes -gt 30)
  if (-not $pd.proc.HasExited -and -not $timedOut) { return }
  $script:Pending = $null
  try {
    if (-not $pd.proc.HasExited) { try { $pd.proc.Kill() } catch { } }
    $text = ''
    if (Test-Path -LiteralPath $pd.out) { $text = [System.IO.File]::ReadAllText($pd.out, [System.Text.Encoding]::UTF8).Trim() }
    $code = $(if ($pd.proc.HasExited) { $pd.proc.ExitCode } else { 2 })
    if ($code -eq 0 -and $text) { Finish-Pick $res $pd.kind $text }
    elseif ($code -eq 1) { Send-Json $res 200 '{"cancelled":true}' }
    else { Write-Log ('folder window failed (exit ' + $code + '): ' + $text); Send-Err $res 501 'no-dialog' 'The folder window did not work.' }
  } catch { Write-Log ('pick: ' + $_.Exception.Message); try { Send-Err $res 500 'error' 'Something went wrong.' } catch { } }
  finally {
    try { Remove-Item -LiteralPath $pd.out -Force -ErrorAction SilentlyContinue } catch { }
    try { $res.Close() } catch { }
  }
}

# --------------------------------------------------------------------------------------------------------------------- the /api
function Test-ApiAllowed($req) {
  $m = $req.HttpMethod
  if ($m -ne 'GET' -and $m -ne 'HEAD' -and $m -ne 'POST' -and $m -ne 'PUT') { return 'method' }
  $sfs = $req.Headers['Sec-Fetch-Site']
  if ($sfs -and $sfs -ne 'same-origin' -and $sfs -ne 'none') { return 'cross-site' }          # another web site is asking: refused
  $origin = $req.Headers['Origin']
  if ($origin -and ($script:AllowedOrigins -notcontains $origin.ToLowerInvariant())) { return 'cross-site' }
  if (($m -eq 'POST' -or $m -eq 'PUT') -and $req.Headers['X-BookCompare'] -ne '1') { return 'header' }
  return $null
}
# returns $true if the answer will be sent later (folder window open)
function Handle-Api($ctx, [string]$path) {
  $req = $ctx.Request; $res = $ctx.Response; $method = $req.HttpMethod
  $res.Headers.Add('Cross-Origin-Resource-Policy', 'same-origin')
  $why = Test-ApiAllowed $req
  if ($why) { Send-Err $res 403 'refused' ('Refused (' + $why + ').'); return $false }

  if ($path -eq '/api/ping') {
    $pick = $(if ($TestPickFile) { 'test' } elseif ($script:IsWin) { 'dialog' } else { 'none' })
    Send-Json $res 200 ('{"app":"BookCompare","api":1,"version":' + (ConvertTo-JsonString $HelperVersion) + ',"os":' + (ConvertTo-JsonString $(if ($script:IsWin) { 'windows' } else { 'other' })) + ',"dir":' + (ConvertTo-JsonString $appRoot) + ',"pick":"' + $pick + '","autostart":' + $(if (Test-Autostart) { 'true' } else { 'false' }) + '}')
    return $false
  }
  if ($path -eq '/api/quit') {
    if ($method -ne 'POST') { Send-Err $res 405 'method'; return $false }
    Send-Json $res 200 '{"ok":true}'
    $script:Stop = $true
    return $false
  }
  if ($path -eq '/api/pick') {
    if ($method -ne 'POST') { Send-Err $res 405 'method'; return $false }
    return (Start-Pick $ctx (Read-JsonBody $req))
  }
  if ($path -eq '/api/register') {
    if ($method -ne 'POST') { Send-Err $res 405 'method'; return $false }
    $b = Read-JsonBody $req
    $kind = $(if ($b -and $b.kind -eq 'project') { 'project' } else { 'scans' })
    $reg = $(if ($b) { Register-Root ([string]$b.path) $kind } else { $null })
    if (-not $reg) { Send-Err $res 404 'not-found' 'That folder does not exist (or is not a full folder address).'; return $false }
    Send-Json $res 200 (Root-Json $reg.id $reg.root)
    return $false
  }

  # everything below works on a folder that was registered before
  $r = Get-Root $req
  if (-not $r) { Send-Err $res 404 'unknown-root' 'The helper does not know this folder (it was restarted?).'; return $false }
  $rel = [string]$req.QueryString['path']
  $full = Resolve-InRoot $r $rel
  if (-not $full) { Send-Err $res 400 'bad-path' 'Bad path.'; return $false }
  $isProjectName = ($rel.Trim('/') -eq $script:ProjectFile)

  if ($path -eq '/api/list') {
    if ($r.kind -ne 'scans') { Send-Err $res 403 'refused' 'Not a scan folder.'; return $false }
    if (-not (Test-Path -LiteralPath $full -PathType Container)) { Send-Err $res 404 'not-found' 'Folder not found.'; return $false }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"entries":[')
    $first = $true
    $di = New-Object System.IO.DirectoryInfo($full)
    foreach ($e in $di.EnumerateFileSystemInfos()) {
      try {
        if ($e -is [System.IO.DirectoryInfo]) { $item = '{"n":' + (ConvertTo-JsonString $e.Name) + ',"d":true}' }
        elseif (Test-ImageName $e.Name) { $item = '{"n":' + (ConvertTo-JsonString $e.Name) + ',"d":false,"s":' + $e.Length + ',"m":' + (Get-Ms $e.LastWriteTimeUtc) + '}' }
        else { continue }
        if (-not $first) { [void]$sb.Append(',') }
        [void]$sb.Append($item); $first = $false
      } catch { }
    }
    [void]$sb.Append(']}')
    Send-Json $res 200 $sb.ToString()
    return $false
  }

  if ($path -eq '/api/stat') {
    if ($r.kind -eq 'project' -and $rel.Trim('/') -ne '' -and -not $isProjectName) { Send-Err $res 403 'refused' 'Not allowed.'; return $false }
    if (Test-Path -LiteralPath $full -PathType Container) { Send-Json $res 200 '{"exists":true,"dir":true}'; return $false }
    if ((Test-Path -LiteralPath $full -PathType Leaf) -and (($r.kind -eq 'project') -or (Test-ImageName $full))) {
      $fi = New-Object System.IO.FileInfo($full)
      Send-Json $res 200 ('{"exists":true,"dir":false,"size":' + $fi.Length + ',"mtime":' + (Get-Ms $fi.LastWriteTimeUtc) + '}')
      return $false
    }
    Send-Err $res 404 'not-found' 'Not found.'
    return $false
  }

  if ($path -eq '/api/file') {
    if ($method -ne 'GET' -and $method -ne 'HEAD') { Send-Err $res 405 'method'; return $false }
    if ($r.kind -eq 'project') { if (-not $isProjectName) { Send-Err $res 403 'refused' 'Not allowed.'; return $false } }
    elseif (-not (Test-ImageName $full)) { Send-Err $res 403 'refused' 'Only pictures can be read.'; return $false }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Send-Err $res 404 'not-found' 'File not found.'; return $false }
    $fi = New-Object System.IO.FileInfo($full)
    $ct = $types[$fi.Extension.ToLowerInvariant()]; if (-not $ct) { $ct = 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-store')
    $res.Headers.Add('X-Mtime-Ms', [string](Get-Ms $fi.LastWriteTimeUtc))
    $res.StatusCode = 200; $res.ContentType = $ct; $res.ContentLength64 = $fi.Length
    if ($method -eq 'GET') {
      $fs = [System.IO.File]::OpenRead($full)
      try { $fs.CopyTo($res.OutputStream, 1048576) } finally { $fs.Dispose() }
    }
    return $false
  }

  if ($path -eq '/api/write') {                                       # the ONLY thing this helper writes: the project file
    if ($method -ne 'PUT') { Send-Err $res 405 'method'; return $false }
    if ($r.kind -ne 'project' -or -not $isProjectName) { Send-Err $res 403 'refused' 'Only the project file in the project folder can be written.'; return $false }
    try { $bytes = Read-Body $req 67108864 } catch { Send-Err $res 413 'too-large' 'Too large.'; return $false }
    if (-not (Test-Path -LiteralPath $r.path -PathType Container)) { Send-Err $res 404 'not-found' 'The project folder does not exist.'; return $false }
    $tmp = $full + '.tmp'
    [System.IO.File]::WriteAllBytes($tmp, $bytes)
    if (Test-Path -LiteralPath $full -PathType Leaf) { [System.IO.File]::Replace($tmp, $full, [System.Management.Automation.Language.NullString]::Value) } else { [System.IO.File]::Move($tmp, $full) }
    Send-Json $res 200 '{"ok":true}'
    return $false
  }

  Send-Err $res 404 'not-found' 'Unknown request.'
  return $false
}

# ----------------------------------------------------------------------------------------------- the program files (folder "app")
function Handle-Static($ctx) {
  $req = $ctx.Request; $res = $ctx.Response
  $res.Headers.Add('Cache-Control', 'no-cache')
  $method = $req.HttpMethod
  if ($method -ne 'GET' -and $method -ne 'HEAD') { Send-Plain $res 405 'Method not allowed'; return }
  $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
  $rel = $rel.Replace('/', $sep)
  try { $full = [System.IO.Path]::GetFullPath((Join-Path $appDir $rel)) } catch { Send-Plain $res 400 'Bad request'; return }
  if (-not ($full + $sep).StartsWith($appRoot, [System.StringComparison]::OrdinalIgnoreCase)) { Send-Plain $res 403 'Forbidden'; return }
  if (Test-Path -LiteralPath $full -PathType Container) { $full = Join-Path $full 'index.html' }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Send-Plain $res 404 'Not found'; return }
  $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
  $ct = $types[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
  $bytes = [System.IO.File]::ReadAllBytes($full)
  $res.StatusCode = 200
  $res.ContentType = $ct
  $res.ContentLength64 = $bytes.Length
  if ($method -eq 'GET') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
}
function Handle-Request($ctx) {
  $res = $ctx.Response
  $deferred = $false
  try {
    $res.Headers.Add('X-Served-By', 'BookCompareLauncher')
    $res.Headers.Add('X-Content-Type-Options', 'nosniff')
    $hostHeader = $ctx.Request.Headers['Host']
    if (-not $hostHeader -or ($script:AllowedHosts -notcontains $hostHeader.ToLowerInvariant())) { Send-Plain $res 403 'Forbidden (wrong host name)'; return }
    $p = $ctx.Request.Url.AbsolutePath
    if ($p.StartsWith('/api/')) { $deferred = [bool](Handle-Api $ctx $p) } else { Handle-Static $ctx }
  } catch {
    # most often: the browser closed the connection while a file was being sent
    Write-Log ('request: ' + $_.Exception.Message)
  } finally {
    if (-not $deferred) { try { $res.Close() } catch { } }
  }
}

# --------------------------------------------------------------------------------------------------------------------- loop
$task = $null
try {
  while ($listener.IsListening -and -not $script:Stop) {
    if ($null -eq $task) { $task = $listener.GetContextAsync() }
    if ($task.AsyncWaitHandle.WaitOne(100)) {
      $ctx = $null
      try { $ctx = $task.Result } catch { Write-Log ('listener: ' + $_.Exception.Message) }
      $task = $null
      if ($ctx) { Handle-Request $ctx }
    }
    Poll-Pick
  }
} finally {
  try { $listener.Stop() } catch { }
  if ($script:TrayProc) { try { if (-not $script:TrayProc.HasExited) { $script:TrayProc.Kill() } } catch { } }
  Write-Log 'helper stopped'
}
