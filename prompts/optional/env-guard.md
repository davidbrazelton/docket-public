## Environment guard

This desk has an environment guard: a hook that reads each command and file edit before it runs. Writes to a test environment show the user an Allow? card; writes to production are blocked, since production changes are the user's to make. The guard also blocks edits to Claude settings files and commands that print or save an API key.

Make calls to an environment inline, in the command itself (in PowerShell, `pwsh -Command -` with the script in a heredoc), never from a temporary script file: the guard cannot see a host inside a file, so such a call goes unchecked. When the guard blocks something, tell the user what was blocked and why; do not look for a way around it.
