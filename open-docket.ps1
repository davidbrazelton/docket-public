# Opens Docket in its own window, like an app, so Docket's own Start menu entry is the only one anybody needs:
# it starts Docket and gives it a window of its own, with no browser tabs or address bar. Chrome, Edge, Brave and
# Vivaldi do that with --app, so the default browser opens it that way when it is one of them. Any other default
# browser (Firefox, say) gets a normal tab in that same browser: never a browser the person does not use, which on a
# new computer may first show its own welcome screens.
# -Print says what it would run instead of running it (for tests and for checking a computer by hand).
param([int]$Port = 4400, [switch]$Print)
$url = "http://localhost:$Port"
$appBrowsers = 'chrome.exe', 'msedge.exe', 'brave.exe', 'vivaldi.exe'

# The program in a registry command line: "C:\path\brave.exe" --single-argument %1 gives C:\path\brave.exe.
function ExeOf($cmd) {
  if ($cmd -match '^\s*"([^"]+)"') { return $Matches[1] }
  if ($cmd -match '^\s*(\S+?\.exe)') { return $Matches[1] }
}
function DefaultBrowser {
  try {
    $prog = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId
    ExeOf (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$prog\shell\open\command" -ErrorAction Stop).'(default)'
  } catch {}
}

$browser = DefaultBrowser
if (-not ($browser -and (Test-Path -LiteralPath $browser) -and ($appBrowsers -contains (Split-Path $browser -Leaf).ToLower()))) { $browser = $null }
if ($Print) { if ($browser) { "$browser --app=$url" } else { $url }; return }
if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$url" } else { Start-Process $url }
