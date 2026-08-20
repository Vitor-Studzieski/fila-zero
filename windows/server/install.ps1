[CmdletBinding()]
param(
  [string]$ProjectPath = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$TaskName = "SenhaHub - API",
  [int]$Port = 3000,
  [string]$PublicAppUrl = "https://senhahub.vercel.app",
  [string]$ApiAllowedOrigins = "https://senhahub.vercel.app",
  [string]$LocalDatabaseUrl = "",
  [string]$KioskId = "totem-pompeia-01",
  [string]$PrinterPort = "COM3",
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Abra o PowerShell como Administrador e execute novamente."
  }
}

function Get-EnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $escapedName = [regex]::Escape($Name)
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^\s*$escapedName\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $value = $line -replace "^\s*$escapedName\s*=\s*", ""
  $value = $value.Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    return $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Set-EnvValue {
  param([string]$Path, [string]$Name, [string]$Value)
  $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
  $escapedName = [regex]::Escape($Name)
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match "^\s*$escapedName\s*=") {
      $found = $true
      "$Name=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $updated += "$Name=$Value" }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($Path, [string[]]$updated, $utf8NoBom)
}

function New-RandomSecret {
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $bytes = New-Object byte[] 48
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

function Get-ConfiguredValue {
  param([string]$Name)
  $value = Get-EnvValue -Path $EnvPath -Name $Name
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = Get-EnvValue -Path (Join-Path $ProjectPath ".env") -Name $Name
  }
  return $value
}

function Set-SecretIfMissing {
  param([string]$Name)
  $value = Get-ConfiguredValue -Name $Name
  if ([string]::IsNullOrWhiteSpace($value) -or $value -like "troque-por-*") {
    Set-EnvValue -Path $EnvPath -Name $Name -Value (New-RandomSecret)
    Write-Host "$Name foi gerado no .env.local."
  }
}

function Assert-Node22 {
  $node = Get-Command node -ErrorAction Stop
  $version = (& $node.Source --version).Trim()
  if ($version -notmatch '^v22\.') {
    throw "Node.js 22.x é obrigatório. Versão encontrada: $version"
  }
  Write-Host "Node.js $version encontrado."
}

function Invoke-ProjectCommand {
  param([string]$Command, [string[]]$Arguments)
  Push-Location $ProjectPath
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Command falhou com código $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

Assert-Administrator
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$EnvPath = Join-Path $ProjectPath ".env.local"
$RunnerPath = Join-Path $ProjectPath "windows\server\run-api.ps1"

if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath "package.json"))) {
  throw "package.json não foi encontrado em $ProjectPath"
}
if (-not (Test-Path -LiteralPath $RunnerPath)) {
  throw "Runner do servidor não foi encontrado em $RunnerPath"
}

Assert-Node22
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm não foi encontrado. Instale o Node.js 22 LTS e reabra o PowerShell."
}

if ([string]::IsNullOrWhiteSpace($LocalDatabaseUrl)) {
  $LocalDatabaseUrl = Get-ConfiguredValue -Name "LOCAL_DATABASE_URL"
}
if ([string]::IsNullOrWhiteSpace($LocalDatabaseUrl)) {
  $LocalDatabaseUrl = Read-Host "Informe LOCAL_DATABASE_URL (postgresql://usuario:senha@servidor:5432/banco)"
}
if ($LocalDatabaseUrl -notmatch '^postgres(?:ql)?://') {
  throw "LOCAL_DATABASE_URL precisa começar com postgres:// ou postgresql://"
}

Write-Host "Configurando $EnvPath..."
Set-EnvValue -Path $EnvPath -Name "NODE_ENV" -Value "production"
Set-EnvValue -Path $EnvPath -Name "DATA_BACKEND" -Value "local-postgres"
Set-EnvValue -Path $EnvPath -Name "LOCAL_DATABASE_URL" -Value $LocalDatabaseUrl
Set-EnvValue -Path $EnvPath -Name "LOCAL_POSTGRES_ROUTES_ENABLED" -Value "1"
Set-EnvValue -Path $EnvPath -Name "LOCAL_POSTGRES_APP_ENABLED" -Value "1"
Set-EnvValue -Path $EnvPath -Name "LOCAL_POSTGRES_ALLOW_LEGACY_FALLBACK" -Value "0"
Set-EnvValue -Path $EnvPath -Name "SUPABASE_AUTH_ENABLED" -Value "0"
Set-EnvValue -Path $EnvPath -Name "API_ONLY" -Value "1"
Set-EnvValue -Path $EnvPath -Name "PORT" -Value ([string]$Port)
Set-EnvValue -Path $EnvPath -Name "PUBLIC_APP_URL" -Value $PublicAppUrl
Set-EnvValue -Path $EnvPath -Name "PUBLIC_INSTALL_URL" -Value "$PublicAppUrl/instalar"
Set-EnvValue -Path $EnvPath -Name "API_ALLOWED_ORIGINS" -Value $ApiAllowedOrigins
Set-EnvValue -Path $EnvPath -Name "LOCAL_PUBLIC_REGISTRATION_ENABLED" -Value "0"
Set-EnvValue -Path $EnvPath -Name "ALLOW_DEMO_USERS" -Value "0"
Set-EnvValue -Path $EnvPath -Name "DEMO_USERS_JSON" -Value "[]"
Set-EnvValue -Path $EnvPath -Name "PUSH_NOTIFICATIONS_ENABLED" -Value "0"
Set-EnvValue -Path $EnvPath -Name "SUPABASE_AUTO_CONFIRM_CUSTOMERS" -Value "0"
Set-EnvValue -Path $EnvPath -Name "KIOSK_ID" -Value ($(if (Get-ConfiguredValue -Name "KIOSK_ID") { Get-ConfiguredValue -Name "KIOSK_ID" } else { $KioskId }))
Set-EnvValue -Path $EnvPath -Name "KIOSK_PRINTER_PORT" -Value ($(if (Get-ConfiguredValue -Name "KIOSK_PRINTER_PORT") { Get-ConfiguredValue -Name "KIOSK_PRINTER_PORT" } else { $PrinterPort }))
Set-EnvValue -Path $EnvPath -Name "KIOSK_NAME" -Value ($(if (Get-ConfiguredValue -Name "KIOSK_NAME") { Get-ConfiguredValue -Name "KIOSK_NAME" } else { "Totem SenhaHub" }))
Set-EnvValue -Path $EnvPath -Name "KIOSK_PRINTER_NAME" -Value ($(if (Get-ConfiguredValue -Name "KIOSK_PRINTER_NAME") { Get-ConfiguredValue -Name "KIOSK_PRINTER_NAME" } else { "Bematech MP - 4200 TH" }))
Set-SecretIfMissing -Name "AUTH_SECRET"
Set-SecretIfMissing -Name "CRON_SECRET"
Set-SecretIfMissing -Name "PRINT_AGENT_TOKEN"

& icacls $EnvPath /inheritance:r /grant:r "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" | Out-Null

if (-not $SkipNpmInstall) {
  Write-Host "Instalando dependências travadas pelo package-lock.json..."
  Invoke-ProjectCommand -Command "npm" -Arguments @("ci", "--omit=dev")
}

Write-Host "Validando sintaxe do projeto..."
Invoke-ProjectCommand -Command "npm" -Arguments @("run", "check")

Write-Host "Validando conexão, schema, RLS e permissões do PostgreSQL..."
Invoke-ProjectCommand -Command "npm" -Arguments @("run", "preflight:local-postgres")

$nodePath = (Get-Command node -ErrorAction Stop).Source
$powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$taskArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$RunnerPath`" -ProjectPath `"$ProjectPath`" -Port $Port -NodePath `"$nodePath`""
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $taskArguments -WorkingDirectory $ProjectPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "API do SenhaHub com PostgreSQL local." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 4

try {
  $ready = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/ready" -TimeoutSec 10
  Write-Host "API pronta: $($ready.StatusCode) $($ready.Content)"
} catch {
  Write-Warning "A tarefa foi registrada, mas a API ainda não respondeu. Consulte data\windows-server\api.log."
  Write-Warning $_.Exception.Message
}

Write-Host ""
Write-Host "Instalação concluída."
Write-Host "Tarefa: $TaskName"
Write-Host "API local: http://127.0.0.1:$Port"
Write-Host "Configuração: $EnvPath"
Write-Host "Log: $(Join-Path $ProjectPath 'data\windows-server\api.log')"
Write-Host "O PostgreSQL não deve ser exposto diretamente à internet; publique apenas a API HTTPS."
