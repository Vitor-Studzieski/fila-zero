param(
  [string]$ProjectPath = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$TaskName = "SenhaHub - Agente de Impressao"
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Abra o PowerShell como Administrador e execute novamente."
  }
}

Assert-Administrator

$ProjectPath = (Resolve-Path $ProjectPath).Path
$AgentPath = Join-Path $ProjectPath "scripts\print-agent.js"
$ConfigPath = Join-Path $ProjectPath ".env.print-agent"
$NodePath = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $AgentPath)) {
  throw "Agente nao encontrado em $AgentPath"
}

if (-not (Test-Path $ConfigPath)) {
  throw "Crie $ConfigPath usando .env.print-agent.example antes de instalar."
}

Write-Host "Instalando dependencias..."
Push-Location $ProjectPath
try {
  npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci falhou com codigo $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

# O token fica legivel somente para SYSTEM e administradores locais.
& icacls $ConfigPath /inheritance:r /grant:r "*S-1-5-18:(R)" "*S-1-5-32-544:(R)" | Out-Null

$Arguments = "`"$AgentPath`""
$Action = New-ScheduledTaskAction `
  -Execute $NodePath `
  -Argument $Arguments `
  -WorkingDirectory $ProjectPath
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal `
  -UserId "SYSTEM" `
  -LogonType ServiceAccount `
  -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet `
  -RestartCount 20 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Settings $Settings `
  -Description "Consome a fila do SenhaHub e imprime senhas na Bematech MP-4200 TH." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Agente instalado e iniciado."
Write-Host "Logs: $ProjectPath\data\print-agent\print-agent.log"
