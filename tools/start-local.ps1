$ErrorActionPreference = 'Stop'
$arenaRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $arenaRoot
$arenaRuntime = Join-Path $arenaRoot '.runtime'
New-Item -ItemType Directory -Force -Path $arenaRuntime | Out-Null
$arenaRunning = $false
try { $arenaHealth = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 3; $arenaRunning = $arenaHealth.status -eq 'ok' } catch {}
if (-not $arenaRunning) {
    if (-not (Test-Path 'node_modules')) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' } }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    $arenaProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.mjs' -WorkingDirectory $arenaRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $arenaRuntime 'server.log') -RedirectStandardError (Join-Path $arenaRuntime 'server-error.log') -PassThru
    $arenaProcess.Id | Set-Content (Join-Path $arenaRuntime 'server.pid')
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try { $arenaHealth = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; if ($arenaHealth.status -eq 'ok') { $arenaRunning = $true; break } } catch {}
    }
    if (-not $arenaRunning) { throw 'Server did not start. Check .runtime/server-error.log' }
}
Write-Host 'GuessWho Arena is running at http://localhost:3000'
Write-Host 'The database is stored in server/.data. Keep this folder to preserve progress.'
Write-Host 'To create a temporary HTTPS link, run tools/start-tunnel.ps1.'
