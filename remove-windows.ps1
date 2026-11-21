# Undoes install-windows.ps1: Docket no longer starts at sign-in (its scheduled task, and a Startup shortcut from
# before the task or from a computer that refused it, both go), and leaves the Start menu and the desktop
# (only the Start Docket shortcut the install made; a Docket shortcut a browser put there is left alone).
# -Port: a test copy's, whose task and shortcuts carry the port in their names (install-windows.ps1 -Port).
# It does not stop a Docket that is running, and it deletes nothing in this folder.
param([int]$Port = 4400)
$n = if ($Port -ne 4400) { " $Port" } else { '' }
try { Unregister-ScheduledTask -TaskPath '\' -TaskName "Docket$n ($env:USERNAME)" -Confirm:$false -ErrorAction SilentlyContinue } catch {}
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) "Docket$n.lnk") -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) "Docket$n.lnk") -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) "Start Docket$n.lnk") -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:LOCALAPPDATA "Docket\task-refused$n.txt") -ErrorAction SilentlyContinue
# The launcher copy is shared by every port; it goes with the real Docket's entries. Its signin.log stays.
if ($Port -eq 4400) { Remove-Item (Join-Path $env:LOCALAPPDATA 'Docket\signin-launcher.ps1') -ErrorAction SilentlyContinue }
Write-Host 'Docket will no longer start at sign-in, and is off the Start menu and the desktop.'
