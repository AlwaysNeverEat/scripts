# Конвейер импорта ЛУКОЙЛ для обычного Windows-компьютера.
# Делает то же самое, что scripts/import/pipeline-lukoil.sh:
#   сбор всех легковых марок ЛУКОЙЛ -> заливка в БД частями -> фильтры по марке.
#
# Запуск из папки backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\import\pipeline-lukoil.ps1
#   $env:IMPORT_USER='vasya'; powershell -ExecutionPolicy Bypass -File .\scripts\import\pipeline-lukoil.ps1
#
# Полезные переменные окружения:
#   IMPORT_USER=<login>         на кого начислять машины (по умолчанию gtrixoff)
#   PIPELINE_SLEEP=600          пауза между циклами при незавершённом сборе
#   LUKOIL_BRANDS="kia,skoda"   ограничить марки (иначе все легковые)
#   LUKOIL_LIMIT_BRANDS=N       ограничить число марок
#   LUKOIL_WITH_FILTERS=0       выключить поиск фильтров по марке
#   LUKOIL_PACE_SIZE=25 LUKOIL_PACE_PAUSE_MS=30000    темп заливки в БД
#   SNAPSHOT_PUSH=1             коммитить снапшот данных на ветку после цикла
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Скрипт лежит в backend/scripts/import/ -> переходим в backend/.
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$Backend = (Get-Location).Path
$Root = (Resolve-Path (Join-Path $Backend '..')).Path
$DataDir = Join-Path $Root 'data\import'
$LogDir = Join-Path $DataDir 'logs'
$null = New-Item -ItemType Directory -Force -Path $LogDir
$Log = Join-Path $LogDir 'pipeline-lukoil.log'
$ImportUser = if ($env:IMPORT_USER) { $env:IMPORT_USER } else { 'gtrixoff' }
$SleepSec = if ($env:PIPELINE_SLEEP) { [int]$env:PIPELINE_SLEEP } else { 600 }

function Say([string]$Message) {
    $line = "── {0} {1}" -f (Get-Date -Format 'dd.MM HH:mm'), $Message
    Write-Host $line
    Add-Content -Path $Log -Value $line -Encoding UTF8
}

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { return }
        $key, $value = $line.Split('=', 2)
        $key = $key.Trim()
        $value = $value.Trim().Trim('"').Trim("'")
        if ($key -and -not [Environment]::GetEnvironmentVariable($key, 'Process')) {
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

function Get-CarCount {
    $file = Join-Path $DataDir 'lukoil-cars.json'
    if (-not (Test-Path $file)) { return 0 }
    try {
        $n = & node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(Array.isArray(d)?d.length:0)" $file
        return [int]$n
    } catch { return 0 }
}

function Invoke-NodeLogged([string[]]$Arguments) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $code = 1
    try {
        & node @Arguments 2>&1 | ForEach-Object {
            $line = $_.ToString()
            Write-Host $line
            Add-Content -Path $Log -Value $line -Encoding UTF8
        }
        $code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    } finally {
        $ErrorActionPreference = $oldPreference
    }
    return $code
}

function Invoke-StatusLogged {
    [void](Invoke-NodeLogged @('scripts/import/show-import-status.js'))
}

function Compress-Gzip([string]$InputPath, [string]$OutputPath) {
    if (-not (Test-Path $InputPath)) { return }
    $inputStream = [System.IO.File]::OpenRead($InputPath)
    $outputStream = [System.IO.File]::Create($OutputPath)
    $gzipStream = New-Object System.IO.Compression.GzipStream($outputStream, [System.IO.Compression.CompressionMode]::Compress)
    try { $inputStream.CopyTo($gzipStream) } finally { $gzipStream.Dispose(); $outputStream.Dispose(); $inputStream.Dispose() }
}

try { $nodeVersion = (& node --version) 2>$null } catch { $nodeVersion = $null }
if (-not $nodeVersion) {
    Write-Host 'Node.js не найден. Установи: winget install OpenJS.NodeJS.LTS' -ForegroundColor Yellow
    exit 1
}

Import-DotEnv (Join-Path $Backend '.env')

Say "конвейер ЛУКОЙЛ запущен (Node $nodeVersion, юзер: $ImportUser, pid $PID)"
if (-not (Test-Path (Join-Path $Backend 'node_modules'))) {
    Say 'Устанавливаю зависимости'
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

while ($true) {
    $argsList = @(
        'scripts/import/scrape-lukoil-all.js',
        '--import-new',
        '--user', $ImportUser,
        '--pace-size', $(if ($env:LUKOIL_PACE_SIZE) { $env:LUKOIL_PACE_SIZE } else { '25' }),
        '--pace-pause-ms', $(if ($env:LUKOIL_PACE_PAUSE_MS) { $env:LUKOIL_PACE_PAUSE_MS } else { '30000' })
    )
    if ($env:LUKOIL_WITH_FILTERS -ne '0') { $argsList += '--with-filters' }
    if ($env:LUKOIL_BRANDS) { $argsList += @('--brands', $env:LUKOIL_BRANDS) }
    if ($env:LUKOIL_LIMIT_BRANDS) { $argsList += @('--limit-brands', $env:LUKOIL_LIMIT_BRANDS) }

    Say 'этап: полный сбор ЛУКОЙЛ + заливка в БД + фильтры'
    $status = Invoke-NodeLogged $argsList
    Invoke-StatusLogged

    if ($env:SNAPSHOT_PUSH -eq '1') {
        Say 'SNAPSHOT_PUSH=1: сохраняю gzip-снапшот данных'
        try {
            Compress-Gzip (Join-Path $DataDir 'lukoil-cars.json') (Join-Path $DataDir 'lukoil-cars.json.gz')
            Push-Location $Root
            try {
                & git add 'data/import/lukoil-cars.json.gz' 2>$null
                & git diff --cached --quiet
                if ($LASTEXITCODE -ne 0) { & git commit -q -m 'Импорт ЛУКОЙЛ: снапшот данных' }
            } finally { Pop-Location }
        } catch { Say "снапшот пропущен: $($_.Exception.Message)" }
    }

    if ($status -eq 0) {
        Say "ГОТОВО: все легковые ЛУКОЙЛ собраны и залиты (машин: $(Get-CarCount))"
        break
    }

    Say "цикл не завершён (код $status). Повтор через $SleepSec секунд; прогресс с чекпоинта."
    Start-Sleep -Seconds $SleepSec
}
