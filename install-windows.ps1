# Installs Docket on this Windows account, from this folder:
# - starts it hidden at sign-in, through signin-launcher.ps1 copied to %LOCALAPPDATA%\Docket, which waits for this
#   folder when it is on a drive that connects late (network, mapped, subst). It starts from a scheduled task of this
#   account's own, "Docket (<user name>)", run at sign-in (no admin needed), which starts within seconds. Windows runs
#   a Startup-folder shortcut only after every sign-in Run entry, one at a time, which can be minutes. Where Windows
#   will not make the task (a policy, or admin rights needed), it starts from the Startup folder as before, and
#   task-refused.txt beside the launcher says so, so Docket does not try again at every start,
# - adds "Docket" to the Start menu (opens it, starting it first if needed),
# - removes the old Docket desktop icon (one that ran start-docket.cmd).
# -ShortcutOnly: does not start it at sign-in (and stops doing so, if it did); adds "Docket" to the Start menu and
#   "Start Docket" to the desktop instead, each starting Docket if needed and opening it.
# -Desktop: adds "Start Docket" to the desktop as well. (Not "Docket": a browser may have put its own Docket shortcut
#   there for a pinned page, which can only open Docket, never start it.)
# -Port: the port Docket answers on, for a test copy; 4400 unless given. A test copy's task and shortcuts carry the
#   port in their names ("Docket 4401"), so they never replace the real ones.
# Docket's own banner and ☰ > Settings > Starting Docket run this script too, so the page and the script agree; at
# its start Docket also runs it again by itself when the sign-in start would not work or still uses the Startup folder.
# Docket keeps running from this folder, so edits and pulls are taken in as before.
# Run it again any time the folder moves. remove-windows.ps1 undoes it.
param([switch]$ShortcutOnly, [switch]$Desktop, [int]$Port = 4400)
$ErrorActionPreference = 'Stop'  # a failure stops here and reaches Docket, which reports it
$folder = $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$ps = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$icon = "$folder\icon\docket.ico,0"  # the scroll; remade from the PNGs beside it by icon\make-ico.ps1
$portArg = if ($Port -ne 4400) { " -Port $Port" } else { '' }
$n = if ($Port -ne 4400) { " $Port" } else { '' }
# The task's setup. Raise it when the task changes, so a computer that refused it tries again once (TASK_SETUP in platform.mjs).
$taskSetup = 1

function Make($file, $script, $arguments, $description) {
  $l = $shell.CreateShortcut($file)
  $l.TargetPath = $ps
  $l.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" $arguments"
  $l.WorkingDirectory = Split-Path $script
  $l.IconLocation = $icon
  $l.WindowStyle = 7
  $l.Description = $description
  $l.Save()
}
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) "Docket$n.lnk"
$deskDir = [Environment]::GetFolderPath('Desktop')
$launcher = Join-Path $env:LOCALAPPDATA 'Docket'
$task = "Docket$n ($env:USERNAME)"
$refused = Join-Path $launcher "task-refused$n.txt"
function DropTask { Unregister-ScheduledTask -TaskPath '\' -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue }
$how = ''
if ($ShortcutOnly) { Remove-Item $startup -ErrorAction SilentlyContinue; try { DropTask } catch {} }
else {
  New-Item -ItemType Directory -Force $launcher | Out-Null
  Copy-Item -LiteralPath "$folder\signin-launcher.ps1" -Destination $launcher -Force
  $run = "-Folder `"$folder`"$portArg"
  try {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher\signin-launcher.ps1`" $run" -WorkingDirectory $launcher
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    # On batteries too, never stopped for running long, and at normal priority (a task's own default is below normal,
    # which Docket and its sessions would take on).
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Priority 4
    Register-ScheduledTask -TaskPath '\' -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts Docket at sign-in, with no window (install-windows.ps1 in the Docket folder made this).' -Force | Out-Null
    Remove-Item $startup -ErrorAction SilentlyContinue  # the old way, so it never starts twice
    Remove-Item $refused -ErrorAction SilentlyContinue
    $how = "from the scheduled task `"$task`""
  } catch {
    Set-Content -LiteralPath $refused -Value "$taskSetup`n$(Get-Date -Format s) Windows would not make the scheduled task `"$task`": $($_.Exception.Message)"
    try { DropTask } catch {}
    Make $startup "$launcher\signin-launcher.ps1" $run 'Start Docket at sign-in, with no window'
    $how = "from the Startup folder (Windows would not make a scheduled task: $($_.Exception.Message))"
  }
}
Make (Join-Path ([Environment]::GetFolderPath('Programs')) "Docket$n.lnk") "$folder\start-hidden.ps1" "-Open$portArg" 'Open Docket (starts it first if needed)'
if ($ShortcutOnly -or $Desktop) { Make (Join-Path $deskDir "Start Docket$n.lnk") "$folder\start-hidden.ps1" "-Open$portArg" 'Open Docket (starts it first if needed)' }
$old = Join-Path $deskDir 'Docket.lnk'
if ((Test-Path $old) -and $shell.CreateShortcut($old).TargetPath -like '*\start-docket.cmd') { Remove-Item $old }
if ($ShortcutOnly) { Write-Host "Docket's shortcuts point at $folder. It does not start at sign-in; open it from the Start menu or the desktop, which starts it if needed." }
else { Write-Host "Docket installed from $folder. It starts at sign-in $how; open it from the Start menu." }
# One anonymous count of a finished install, carrying only the platform (README.md, "Usage stats"). Never stops or
# slows the install by more than a few seconds; DOCKET_NO_USAGE=1 skips it. Docket's own reruns of this script skip it.
if (-not $env:DOCKET_RERUN -and (-not $env:DOCKET_NO_USAGE -or $env:DOCKET_NO_USAGE -match '^(0|false|no|off)$')) {
  try { Invoke-WebRequest -UseBasicParsing -Method Post -TimeoutSec 5 -ContentType 'application/json' -Body '{"platform":"windows"}' -Uri 'https://docket-usage.dbrazelton.workers.dev/v1/install' | Out-Null } catch {}
}
