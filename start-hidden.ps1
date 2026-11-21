# Starts Docket with no window (if it is not running already).
# -Open also opens Docket in its own window (open-docket.ps1), once it answers. Used at Windows sign-in (through signin-launcher.ps1)
# and by the Start menu and desktop shortcuts that install-windows.ps1 makes. Run it by hand, with -Open, to start
# Docket after a restart when nothing else does.
param([switch]$Open, [int]$Port = 4400)
$folder = $PSScriptRoot
$url = "http://localhost:$Port"

function Answers { try { Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 3 | Out-Null; $true } catch { $false } }

# A copy put here by Docket-Setup.exe has its own Node.js and Git in runtime\ beside this folder (marked by
# docket-runtime.txt). Docket runs on that Node.js, and both go at the END of the PATH Docket and its sessions get,
# so a computer's own git and node, when it has them, are still the ones found first.
$runtime = Join-Path (Split-Path $folder) 'runtime'
$bundled = Test-Path -LiteralPath "$runtime\docket-runtime.txt"
if ($bundled) { $env:PATH = "$env:PATH;$runtime\node;$runtime\git\cmd" }

if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
  if ($Port -ne 4400) { $env:PORTAL_PORT = $Port }  # a test copy (install-windows.ps1 -Port)
  $node = if ($bundled) { "$runtime\node\node.exe" } else { (Get-Command node -ErrorAction Stop).Source }
  # The private browser sessions use, fetched in the background the first time (about 150 MB), so setup never waits on it.
  if ($bundled -and -not (Test-Path "$env:LOCALAPPDATA\ms-playwright\chromium-*")) {
    Start-Process -FilePath $node -ArgumentList "`"$folder\node_modules\playwright\cli.js`" install chromium" -WorkingDirectory $folder -WindowStyle Hidden -RedirectStandardOutput "$runtime\browser-download.log" -RedirectStandardError "$runtime\browser-download-errors.log"
  }
  Start-Process -FilePath $node -ArgumentList "`"$folder\supervisor.mjs`"" -WorkingDirectory $folder -WindowStyle Hidden
}
if ($Open) {
  # Open the page only once Docket answers, so the browser never lands on a page that isn't there yet.
  for ($i = 0; $i -lt 120 -and -not (Answers); $i++) { Start-Sleep -Milliseconds 500 }
  # A folder without open-docket.ps1 (a copy made from an older file list) still opens Docket, in a tab.
  if (Test-Path -LiteralPath "$folder\open-docket.ps1") { & "$folder\open-docket.ps1" -Port $Port } else { Start-Process $url }
}
