# Undoes install-windows.ps1: Docket no longer starts at sign-in, and leaves the Start menu and the desktop
# (only the Start Docket shortcut the install made; a Docket shortcut a browser put there is left alone).
# It does not stop a Docket that is running, and it deletes nothing in this folder.
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'Docket.lnk') -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Docket.lnk') -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Start Docket.lnk') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:LOCALAPPDATA 'Docket\signin-launcher.ps1') -ErrorAction SilentlyContinue  # its signin.log stays
Write-Host 'Docket will no longer start at sign-in, and is off the Start menu and the desktop.'
