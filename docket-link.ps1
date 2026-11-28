# The docket:// link (#1275). A page cannot start a program, so when Docket stops answering, the page offers a
# Start Docket button that opens docket://start, which Windows hands to this script.
# -Url: the link opened. Only docket://start does anything: it starts Docket with no window (start-hidden.ps1), which
#   does nothing when Docket already runs. The open page reloads by itself once Docket answers, so nothing is opened.
# -Register: makes docket:// run this script, for this Windows account (no admin needed). install-windows.ps1 runs it,
#   and Docket runs it at its start when the link is missing or points at another folder.
# -Unregister: takes the link away, only when it points at this folder and port (remove-windows.ps1 runs it).
# -Port: a test copy's (install-windows.ps1 -Port). There is one docket:// link per account, so the last copy to
#   register it is the one it starts.
param([string]$Url = '', [switch]$Register, [switch]$Unregister, [int]$Port = 4400)
$folder = $PSScriptRoot
$key = 'HKCU:\Software\Classes\docket'
$portArg = if ($Port -ne 4400) { " -Port $Port" } else { '' }
$ps = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$command = "`"$ps`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$folder\docket-link.ps1`"$portArg -Url `"%1`""
if ($Register) {
  New-Item -Path "$key\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value 'URL:Docket'
  Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
  New-Item -Path "$key\DefaultIcon" -Force | Out-Null
  Set-ItemProperty -Path "$key\DefaultIcon" -Name '(default)' -Value "$folder\icon\docket.ico,0"
  Set-ItemProperty -Path "$key\shell\open\command" -Name '(default)' -Value $command
  exit 0
}
if ($Unregister) {
  $now = try { (Get-ItemProperty -Path "$key\shell\open\command" -ErrorAction Stop).'(default)' } catch { $null }
  if ($now -eq $command) { Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue }
  exit 0
}
if ($Url -notmatch '^docket://start/?$') { exit 0 }
& "$folder\start-hidden.ps1" -Port $Port
