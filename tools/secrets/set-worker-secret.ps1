<#
  Set one Worker secret safely: validate its SHAPE first, upload it, then confirm via /health.
  Never prints the value. Refuses masked placeholders ("whsec_········"), quotes, stray whitespace and wrong-kind keys.

  Usage (from anywhere):
    .\set-worker-secret.ps1 -Name STRIPE_WEBHOOK_SECRET                 # takes the value from the clipboard
    .\set-worker-secret.ps1 -Name ORDER_SINK_TOKEN -BwsSecretId <uuid>  # takes it from Bitwarden Secrets Manager (bws)

  Bitwarden mode uses the existing user env var BWS_ACCESS_TOKEN_KPC. The value goes bws -> wrangler stdin only.
#>
param(
  [Parameter(Mandatory)][ValidateSet('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ORDER_SINK_TOKEN')][string]$Name,
  [string]$BwsSecretId,
  [string]$WorkerDir = (Join-Path $PSScriptRoot '..\..\worker'),
  [string]$HealthUrl = 'https://ecosilk-ai.ecosilk.workers.dev/health'
)
$ErrorActionPreference = 'Stop'

# Keep these in step with secretShapes() in worker/src/stripe.js.
$shape = @{
  STRIPE_SECRET_KEY     = @{ rx = '^(sk|rk)_test_[A-Za-z0-9]{16,}$'; hint = 'a TEST secret key: sk_test_ followed by letters/digits'; health = 'stripeKey' }
  STRIPE_WEBHOOK_SECRET = @{ rx = '^whsec_[A-Za-z0-9]{16,}$';        hint = "the REVEALED signing secret: whsec_ plus ~32 letters/digits (not the dots)"; health = 'webhookSecret' }
  ORDER_SINK_TOKEN      = @{ rx = '^\S{32,}$';                       hint = 'one unbroken string of 32+ characters'; health = 'sinkToken' }
}[$Name]

if ($BwsSecretId) {
  $env:BWS_ACCESS_TOKEN = [Environment]::GetEnvironmentVariable('BWS_ACCESS_TOKEN_KPC', 'User')
  if (-not $env:BWS_ACCESS_TOKEN) { throw 'BWS_ACCESS_TOKEN_KPC is not set for this user.' }
  $raw = (bws secret get $BwsSecretId --output json | ConvertFrom-Json).value
  $source = 'Bitwarden'
} else {
  $raw = Get-Clipboard -Raw
  $source = 'clipboard'
}
$value = ([string]$raw).Trim().Trim('"').Trim("'")
Remove-Variable raw

if ($value -notmatch $shape.rx) {
  $prefix = if ($value -match '^(sk_test_|sk_live_|rk_test_|pk_test_|whsec_)') { $Matches[1] } else { 'unrecognised' }
  Write-Host "REFUSED. The $source value for $Name is the wrong shape (length $($value.Length), prefix $prefix)." -ForegroundColor Red
  Write-Host "Expected $($shape.hint)." -ForegroundColor Red
  if ($value -match '[·•●*]') { Write-Host 'It contains mask characters: you copied the hidden placeholder. Click the eye/reveal first, then copy.' -ForegroundColor Yellow }
  exit 1
}

Push-Location $WorkerDir
try { $value | npx --yes wrangler secret put $Name } finally { Pop-Location; Remove-Variable value }
if ($source -eq 'clipboard') { Set-Clipboard -Value ' ' }   # don't leave the secret sitting on the clipboard

Start-Sleep -Seconds 6
$ok = (Invoke-RestMethod $HealthUrl).stripeSecretsOk.($shape.health)
if ($ok) { Write-Host "$Name uploaded and the Worker reports it is the right shape." -ForegroundColor Green }
else { Write-Host "$Name uploaded but /health says it is NOT the right shape. Wait a few seconds and rerun .\check-health.ps1." -ForegroundColor Yellow; exit 2 }
