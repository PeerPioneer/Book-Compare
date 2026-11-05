# Book Compare launcher
# Serves the folder "app" on THIS computer only (address http://localhost:8765/) and opens it in Edge.
# Nothing is uploaded anywhere and no internet connection is needed. Your scans are never touched by this script:
# it only hands the program files of Book Compare to your browser.
# Close the window (or press Ctrl+C) to stop it.
param(
  [int]$Port = 8765,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$appDir  = Join-Path (Split-Path -Parent $PSScriptRoot) 'app'
$sep     = [System.IO.Path]::DirectorySeparatorChar
$appRoot = [System.IO.Path]::GetFullPath($appDir).TrimEnd('\', '/') + $sep
$url     = "http://localhost:$Port/"

function Wait-Close($text) {
  Write-Host ''
  Write-Host $text
  try { [void](Read-Host 'Press Enter to close this window') } catch { }
}
if (-not (Test-Path -LiteralPath (Join-Path $appDir 'index.html'))) {
  Write-Host 'The folder "app" was not found next to the folder "launcher".'
  Write-Host 'Please unzip the whole Book Compare download first, and start the launcher from the unzipped folder.'
  Wait-Close ''
  exit 1
}

function Open-App {
  if ($NoBrowser) { return }
  try { Start-Process 'msedge.exe' $url } catch { Start-Process $url }
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
  '.txt' = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try {
  $listener.Start()
} catch {
  if (Test-AlreadyRunning) {
    Write-Host 'Book Compare is already running. Opening it ...'
    Open-App
    Start-Sleep -Seconds 2
    exit 0
  }
  Write-Host "Book Compare could not start on port $Port. Another program is using it."
  Write-Host "(Technical message: $($_.Exception.Message))"
  Wait-Close 'Close that program, or ask for help.'
  exit 1
}

try { $Host.UI.RawUI.WindowTitle = 'Book Compare is running - close this window to stop it' } catch { }
Write-Host '================================================================'
Write-Host ' Book Compare is running.'
Write-Host " Address: $url   (works on this computer only, no internet needed)"
Write-Host ''
Write-Host ' Keep this window open while you use Book Compare in the browser.'
Write-Host ' Close this window to stop it.'
Write-Host '================================================================'
Open-App

function Send-Plain($res, [int]$code, [string]$text) {
  $res.StatusCode = $code
  $b = [System.Text.Encoding]::UTF8.GetBytes($text)
  $res.ContentType = 'text/plain; charset=utf-8'
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
}

try {
  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(250)) { }     # short waits, so that Ctrl+C works
    $ctx = $task.Result
    $res = $ctx.Response
    try {
      $res.Headers.Add('X-Served-By', 'BookCompareLauncher')
      $res.Headers.Add('Cache-Control', 'no-cache')
      $method = $ctx.Request.HttpMethod
      if ($method -ne 'GET' -and $method -ne 'HEAD') { Send-Plain $res 405 'Method not allowed'; continue }
      $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      $rel = $rel.Replace('/', $sep)
      try { $full = [System.IO.Path]::GetFullPath((Join-Path $appDir $rel)) } catch { Send-Plain $res 400 'Bad request'; continue }
      if (-not ($full + $sep).StartsWith($appRoot, [System.StringComparison]::OrdinalIgnoreCase)) { Send-Plain $res 403 'Forbidden'; continue }
      if (Test-Path -LiteralPath $full -PathType Container) { $full = Join-Path $full 'index.html' }
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Send-Plain $res 404 'Not found'; continue }
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $ct = $types[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.StatusCode = 200
      $res.ContentType = $ct
      $res.ContentLength64 = $bytes.Length
      if ($method -eq 'GET') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    } catch {
      # the browser closed the connection while a file was being sent: nothing to do
    } finally {
      try { $res.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}
