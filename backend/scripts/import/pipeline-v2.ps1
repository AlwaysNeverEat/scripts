# Полный импорт для обычного Windows-компьютера.
# Все легковые Motul -> ROLF -> новые строки -> backfill старой базы
# -> MANN -> BIG FILTER -> безопасная дозапись.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$Backend = (Get-Location).Path
$Root = (Resolve-Path (Join-Path $Backend '..')).Path
$DataDir = Join-Path $Root 'data\import'
$LogDir = Join-Path $DataDir 'logs'
$null = New-Item -ItemType Directory -Force -Path $LogDir
$Log = Join-Path $LogDir 'pipeline.log'
$ImportUser = if ($env:IMPORT_USER) { $env:IMPORT_USER } else { 'gtrixoff' }
$SleepSec = if ($env:PIPELINE_SLEEP) { [int]$env:PIPELINE_SLEEP } else { 600 }

function Say([string]$Message) {
    $line = "== {0} {1}" -f (Get-Date -Format 'dd.MM HH:mm'), $Message
    Write-Host $line
    Add-Content -Path $Log -Value $line -Encoding UTF8
}

try { $nodeVersion = (& node --version) 2>$null } catch { $nodeVersion = $null }
if (-not $nodeVersion) {
    Write-Host 'Node.js не найден. Установи: winget install OpenJS.NodeJS.LTS' -ForegroundColor Yellow
    exit 1
}
Say "Node $nodeVersion, пользователь: $ImportUser"
if (-not (Test-Path (Join-Path $Backend 'node_modules'))) {
    Say 'Устанавливаю зависимости'
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Expand-Gzip([string]$GzipPath, [string]$OutputPath) {
    $input = [System.IO.File]::OpenRead($GzipPath)
    $output = [System.IO.File]::Create($OutputPath)
    $gzip = New-Object System.IO.Compression.GzipStream($input, [System.IO.Compression.CompressionMode]::Decompress)
    try { $gzip.CopyTo($output) } finally { $gzip.Dispose(); $output.Dispose(); $input.Dispose() }
}
foreach ($name in 'motul-cars','cars-enriched','filters') {
    $json = Join-Path $DataDir "$name.json"
    $gzip = Join-Path $DataDir "$name.json.gz"
    if ((-not (Test-Path $json)) -and (Test-Path $gzip)) { Expand-Gzip $gzip $json }
}

$ConfigPath = Join-Path $env:USERPROFILE '.cars-import.json'
if ($env:SUPABASE_ACCESS_TOKEN -and $env:SUPABASE_PROJECT_REF) {
    Say 'Доступ к Supabase взят из переменных окружения'
} elseif (Test-Path $ConfigPath) {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $env:SUPABASE_ACCESS_TOKEN = $config.token
    $env:SUPABASE_PROJECT_REF = $config.projectRef
} else {
    Write-Host 'Нужен Supabase access token: https://supabase.com/dashboard/account/tokens' -ForegroundColor Cyan
    $token = Read-Host 'Вставь токен (sbp_...)'
    $defaultRef = 'whcqsletieyxikdvpbfu'
    $projectRef = Read-Host "Project ref (Enter = $defaultRef)"
    if ([string]::IsNullOrWhiteSpace($projectRef)) { $projectRef = $defaultRef }
    @{ token = $token.Trim(); projectRef = $projectRef.Trim() } | ConvertTo-Json | Set-Content $ConfigPath -Encoding UTF8
    $env:SUPABASE_ACCESS_TOKEN = $token.Trim()
    $env:SUPABASE_PROJECT_REF = $projectRef.Trim()
}

function Run-Stage([string]$Title, [string[]]$Arguments) {
    Say "Этап: $Title"
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & node @Arguments 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath $Log -Append
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
    }
    if ($code -ne 0) {
        Say "Этап '$Title' завершился с кодом $code"
        return $false
    }
    return $true
}

if (-not $env:SCRAPE_INTERVAL_MS) { $env:SCRAPE_INTERVAL_MS = '500' }
Say 'Конвейер запущен. Его можно остановить и позже запустить снова.'
while ($true) {
    $allOk = $true
    if (-not (Run-Stage 'все легковые марки Motul' @('scripts/import/scrape-motul-all.js'))) { $allOk = $false }
    if (-not (Run-Stage 'допуски ROLF' @('scripts/import/scrape-rolf.js','--in','data/import/motul-cars.json','--out','data/import/cars-enriched.json'))) { $allOk = $false }
    if (-not (Run-Stage 'добавление новых машин' @('scripts/import/import-cars.js','data/import/cars-enriched.json','--user',$ImportUser,'--state','data/import/.imported-keys.json'))) { $allOk = $false }
    if (-not (Run-Stage 'старые машины с пропусками' @('scripts/import/build-enrichment-workset.js','--in','data/import/cars-enriched.json','--out','data/import/cars-workset.json'))) { $allOk = $false }
    if (-not (Run-Stage 'подготовка повторного MANN-подбора' @('scripts/import/prepare-filter-retry.js','--cars','data/import/cars-workset.json','--filters','data/import/filters.json'))) { $allOk = $false }
    if (-not (Run-Stage 'MANN-FILTER' @('scripts/import/scrape-filters.js','--in','data/import/cars-workset.json','--out','data/import/filters.json'))) { $allOk = $false }
    if (-not (Run-Stage 'BIG FILTER fallback' @('scripts/import/scrape-big-filter.js','--in','data/import/cars-workset.json','--out','data/import/filters.json'))) { $allOk = $false }
    if (-not (Run-Stage 'дозапись фильтров и мощности' @('scripts/import/apply-enrichment.js','--cars','data/import/cars-workset.json','--filters','data/import/filters.json','--user',$ImportUser))) { $allOk = $false }

    if ($allOk) {
        Say 'ГОТОВО: полный проход завершён без ошибок'
        break
    }
    Say "Есть незавершённые этапы. Повтор через $SleepSec секунд; чекпоинты сохраняются."
    Start-Sleep -Seconds $SleepSec
}
