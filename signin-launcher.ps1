# Starts Docket at Windows sign-in. install-windows.ps1 copies this file to %LOCALAPPDATA%\Docket, which is
# always there, and the Startup shortcut runs that copy with -Folder (the Docket folder). The Docket folder may be on
# a network, mapped or subst drive that Windows connects only after sign-in has started, and a shortcut that ran
# start-hidden.ps1 from there directly failed before Docket's code could run. So this waits for the folder, up to
# -WaitSeconds, then runs its start-hidden.ps1. Each start, and giving up, goes in signin.log beside this file.
param([Parameter(Mandatory = $true)][string]$Folder, [int]$Port = 4400, [int]$WaitSeconds = 300)
$log = Join-Path $PSScriptRoot 'signin.log'
function Log($m) {
  try {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 100KB) { Set-Content -LiteralPath $log -Value (Get-Content -LiteralPath $log -Tail 200) }
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) $m"
  } catch {}
}
$start = Join-Path $Folder 'start-hidden.ps1'
$t0 = Get-Date
while (-not (Test-Path -LiteralPath $start)) {
  if (((Get-Date) - $t0).TotalSeconds -ge $WaitSeconds) {
    Log "gave up: $start was not there after $WaitSeconds seconds. Is $([System.IO.Path]::GetPathRoot($Folder)) connected? Start Docket from the Start menu once it is."
    exit 1
  }
  Start-Sleep -Seconds 5
}
$waited = [int]((Get-Date) - $t0).TotalSeconds
try { & $start -Port $Port; Log "started Docket from $Folder$(if ($waited) { " after waiting $waited seconds for the folder" })" }
catch { Log "could not start Docket from ${Folder}: $($_.Exception.Message)"; exit 1 }
