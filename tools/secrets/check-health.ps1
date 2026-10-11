# Is the Worker configured correctly? Prints booleans only (never values).
param([string]$HealthUrl = 'https://ecosilk-ai.ecosilk.workers.dev/health')
$h = Invoke-RestMethod $HealthUrl
$h.stripeSecretsOk.PSObject.Properties | ForEach-Object { '{0,-14} {1}' -f $_.Name, $(if ($_.Value) { 'OK' } else { 'WRONG SHAPE / MISSING' }) }
if ($h.stripeSecretsOk.PSObject.Properties.Value -contains $false) { exit 1 }
