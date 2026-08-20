param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath,
  [int]$Port = 3000,
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$LogDirectory = Join-Path $ProjectPath "data\windows-server"
$LogPath = Join-Path $LogDirectory "api.log"
if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $NodePath = (Get-Command node -ErrorAction Stop).Source
}

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
Set-Location -LiteralPath $ProjectPath

$env:API_ONLY = "1"
$env:PORT = [string]$Port

$exitCode = 1
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  & $NodePath (Join-Path $ProjectPath "server\server.js")
  $exitCode = $LASTEXITCODE
} finally {
  try { Stop-Transcript | Out-Null } catch { }
}

exit $exitCode
