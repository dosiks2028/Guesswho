$ErrorActionPreference = 'Stop'
$arenaRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $arenaRoot
$arenaRuntime = Join-Path $arenaRoot '.runtime'
New-Item -ItemType Directory -Force -Path $arenaRuntime | Out-Null
$arenaExecutable = Join-Path $arenaRuntime 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $arenaExecutable)) {
    Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $arenaExecutable
}
$arenaPidFile = Join-Path $arenaRuntime 'tunnel.pid'
if (Test-Path -LiteralPath $arenaPidFile) {
    $arenaExisting = Get-Process -Id (Get-Content -LiteralPath $arenaPidFile) -ErrorAction SilentlyContinue
    if ($arenaExisting -and $arenaExisting.Path -eq $arenaExecutable) {
        Select-String -Path (Join-Path $arenaRuntime 'tunnel-error.log') -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | ForEach-Object { $_.Matches.Value }
        exit 0
    }
}
$arenaTunnel = Start-Process -FilePath $arenaExecutable -ArgumentList 'tunnel','--url','http://127.0.0.1:3000','--no-autoupdate','--protocol','http2' -WorkingDirectory $arenaRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $arenaRuntime 'tunnel.log') -RedirectStandardError (Join-Path $arenaRuntime 'tunnel-error.log') -PassThru
$arenaTunnel.Id | Set-Content -LiteralPath $arenaPidFile
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    $arenaMatch = Select-String -Path (Join-Path $arenaRuntime 'tunnel-error.log') -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue
    if ($arenaMatch) { $arenaMatch.Matches.Value; exit 0 }
}
throw 'Tunnel did not start. Check .runtime/tunnel-error.log'
