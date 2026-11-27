@echo off
rem Double-click this with the Discord webhook URL on the clipboard.
rem It writes offers-board\.env.webhook (gitignored) and never prints the URL.
rem Pass a mention to get pinged:  save-webhook.cmd -Mention "<@&ROLE_ID>"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0save-webhook.ps1" %*
echo.
pause
