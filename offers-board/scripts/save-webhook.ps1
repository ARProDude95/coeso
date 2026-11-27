# Saves the Discord webhook URL sitting on your clipboard into a gitignored
# file, so the URL never has to be pasted into a chat window.
#
#   Discord: Channel settings -> Integrations -> Webhooks -> Copy Webhook URL
#   Then run:  powershell.exe -NoProfile -ExecutionPolicy Bypass -File offers-board/scripts/save-webhook.ps1
#
# Optional role/user ping (so a new application actually @-mentions you):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File offers-board/scripts/save-webhook.ps1 -Mention '<@&ROLE_ID>'

param(
  [string]$Mention
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if ($Mention) {
  $trimmed = $Mention.Trim()
  if ($trimmed -notmatch '^<@[!&]?\d+>$') {
    Write-Error "Mention must look like <@123456789012345678> (user) or <@&123456789012345678> (role)."
  }
  Set-Content -NoNewline -Path (Join-Path $root '.env.mention') -Value $trimmed -Encoding utf8
  Write-Host "Saved the mention to .env.mention"
  exit 0
}

$url = (Get-Clipboard -Raw)
if ($null -eq $url) { $url = '' }
$url = $url.Trim()

if ($url -notmatch '^https://(discord(app)?)\.com/api/webhooks/\d+/[\w-]+$') {
  Write-Error "The clipboard does not hold a Discord webhook URL. Copy it from Channel settings -> Integrations -> Webhooks, then run this again."
}

Set-Content -NoNewline -Path (Join-Path $root '.env.webhook') -Value $url -Encoding utf8
Write-Host "Saved the webhook to .env.webhook ($($url.Length) characters). Nothing was printed."
