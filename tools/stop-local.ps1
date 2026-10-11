$ErrorActionPreference = 'Stop'
$arenaRoot = Split-Path -Parent $PSScriptRoot
foreach ($arenaService in @('tunnel', 'server')) {
    $arenaPidFile = Join-Path $arenaRoot ".runtime/$arenaService.pid"
    if (Test-Path -LiteralPath $arenaPidFile) {
        $arenaPid = [int](Get-Content -LiteralPath $arenaPidFile)
        $arenaProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $arenaPid" -ErrorAction SilentlyContinue
        if ($arenaProcess -and (($arenaService -eq 'tunnel' -and $arenaProcess.ExecutablePath -eq (Join-Path $arenaRoot '.runtime/cloudflared.exe')) -or ($arenaService -eq 'server' -and $arenaProcess.CommandLine -like '*server/index.mjs*'))) {
            Stop-Process -Id $arenaPid
            Write-Host "$arenaService stopped"
        }
    }
}
