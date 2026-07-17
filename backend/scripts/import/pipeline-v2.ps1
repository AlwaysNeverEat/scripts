# Полный импорт для обычного Windows-компьютера.
# ФАЗА 1: все легковые Motul -> немедленная базовая запись в БД по каждой марке.
# ФАЗА 2: только после полного сбора -> ROLF -> MANN -> BIG -> backfill старых.
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
    $line = "== {0} {1}" -f (Get-Date -Format 'dd.MM HH:mm:ss'), $Message
    Write-Host $line
    Add-Content -Path $Log -Value $line -Encoding UTF8
}

function Run-Stage([string]$Title, [string[]]$Arguments) {
    Say "СТАРТ: $Title"
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $code = 1
    try {
        & node @Arguments 2>&1 | ForEach-Object {
            $line = $_.ToString()
            Write-Host $line
            Add-Content -Path $Log -Value $line -Encoding UTF8
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
        $watch.Stop()
    }
    if ($code -ne 0) {
        Say "ОШИБКА: '$Title', код=$code, время=$($watch.Elapsed.ToString())"
        return $false
    }
    Say "ГОТОВО: '$Title', время=$($watch.Elapsed.ToString())"
    return $true
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
    if ((-not (Test-Path $json)) -and (Test-Path $gzip)) {
        Say "Распаковываю $name.json.gz"
        Expand-Gzip $gzip $json
    }
}

$ConfigPath = Join-Path $env:USERPROFILE '.cars-import.json'
if ($env:SUPABASE_ACCESS_TOKEN -and $env:SUPABASE_PROJECT_REF) {
    Say 'Доступ к Supabase взят из переменных окружения'
} elseif (Test-Path $ConfigPath) {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $env:SUPABASE_ACCESS_TOKEN = $config.token
    $env:SUPABASE_PROJECT_REF = $config.projectRef
    Say "Доступ к Supabase загружен из $ConfigPath"
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

if (-not $env:SCRAPE_INTERVAL_MS) { $env:SCRAPE_INTERVAL_MS = '500' }
if (-not $env:HTTP_TIMEOUT_MS) { $env:HTTP_TIMEOUT_MS = '45000' }
if (-not $env:IMPORT_HEARTBEAT_SECONDS) { $env:IMPORT_HEARTBEAT_SECONDS = '20' }

Say 'Конвейер запущен. В окне будут видны марка, счётчики, heartbeat и записи в БД.'
if (-not (Run-Stage 'состояние базы ДО запуска' @('scripts/import/show-import-status.js'))) {
    Say 'Нет доступа к БД. Сбор не начинаю: сначала должен работать Supabase.'
    exit 2
}

# ── ФАЗА LM. Liqui Moly в основе ──────────────────────────────────────────────
# Объёмы по агрегатам + кВт + л.с. Идём по одной марке; существующие машины
# пополняются недостающими объёмами (недеструктивно), новые добавляются кадэнсом
# 25 записей / 30 сек. LM_SKIP=1 — пропустить; LM_ONLY=1 — только LM; LM_BRANDS —
# ограничить марками; LM_LIMIT_BRANDS — числом марок.
if ($env:LM_SKIP -ne '1') {
    $lmDone = $false
    while (-not $lmDone) {
        Say 'ФАЗА LM: Liqui Moly по одной марке. Кадэнс в БД 25/30с; существующие пополняются, новые добавляются.'
        $lmArgs = @('scripts/import/scrape-liquimoly-all.js','--import-new','--user',$ImportUser)
        if ($env:LM_BRANDS) { $lmArgs += @('--brands',$env:LM_BRANDS) }
        if ($env:LM_LIMIT_BRANDS) { $lmArgs += @('--limit-brands',$env:LM_LIMIT_BRANDS) }
        $lmDone = Run-Stage 'полный сбор Liqui Moly + запись в БД (кадэнс 25/30с)' $lmArgs
        Run-Stage 'состояние базы ПОСЛЕ прохода Liqui Moly' @('scripts/import/show-import-status.js') | Out-Null
        if (-not $lmDone) {
            Say "ФАЗА LM не закончена (возможно, сайт притормозил — обходить не будем). Повтор через $SleepSec секунд."
            Start-Sleep -Seconds $SleepSec
        }
    }
    if ($env:LM_ONLY -eq '1') { Say 'LM_ONLY=1: Liqui Moly собран, остальные источники отключены.'; exit 0 }
}

# ── ФАЗА 1. Только наполнение базы ────────────────────────────────────────────
$motulDone = $false
while (-not $motulDone) {
    Say 'ФАЗА 1/2: собираю все легковые Motul. Новые машины пишутся в БД после каждой марки.'
    $motulArgs = @('scripts/import/scrape-motul-all.js','--import-new','--user',$ImportUser)
    if ($env:MOTUL_BRANDS) { $motulArgs += @('--brands',$env:MOTUL_BRANDS) }
    if ($env:MOTUL_LIMIT_BRANDS) { $motulArgs += @('--limit-brands',$env:MOTUL_LIMIT_BRANDS) }
    $motulDone = Run-Stage 'полный сбор Motul + немедленная заливка в БД' $motulArgs
    Run-Stage 'состояние базы ПОСЛЕ прохода Motul' @('scripts/import/show-import-status.js') | Out-Null
    if (-not $motulDone) {
        Say "ФАЗА 1 не закончена. ROLF и фильтры пока НЕ запускаю. Повтор через $SleepSec секунд."
        Start-Sleep -Seconds $SleepSec
    }
}

if ($env:IMPORT_BASE_ONLY -eq '1') {
    Say 'IMPORT_BASE_ONLY=1: первичное наполнение закончено, обогащение отключено.'
    exit 0
}

# ── ФАЗА 2. Обогащение уже собранной базы ─────────────────────────────────────
while ($true) {
    Say 'ФАЗА 2/2: Motul собран. Теперь добавляю допуски, мощность и фильтры.'
    $allOk = $true
    if (-not (Run-Stage 'допуски ROLF' @('scripts/import/scrape-rolf.js','--in','data/import/motul-cars.json','--out','data/import/cars-enriched.json'))) { $allOk = $false }
    if (-not (Run-Stage 'дозапись допусков новым машинам' @('scripts/import/import-cars.js','data/import/cars-enriched.json','--user',$ImportUser,'--state','data/import/.imported-keys.json'))) { $allOk = $false }
    if (-not (Run-Stage 'рабочий набор: новые + старые машины с пропусками' @('scripts/import/build-enrichment-workset.js','--in','data/import/cars-enriched.json','--out','data/import/cars-workset.json'))) { $allOk = $false }
    if (-not (Run-Stage 'подготовка повторного MANN-подбора' @('scripts/import/prepare-filter-retry.js','--cars','data/import/cars-workset.json','--filters','data/import/filters.json'))) { $allOk = $false }
    if (-not (Run-Stage 'MANN-FILTER' @('scripts/import/scrape-filters.js','--in','data/import/cars-workset.json','--out','data/import/filters.json'))) { $allOk = $false }
    if (-not (Run-Stage 'BIG FILTER fallback' @('scripts/import/scrape-big-filter.js','--in','data/import/cars-workset.json','--out','data/import/filters.json'))) { $allOk = $false }
    if (-not (Run-Stage 'дозапись фильтров и мощности в БД' @('scripts/import/apply-enrichment.js','--cars','data/import/cars-workset.json','--filters','data/import/filters.json','--user',$ImportUser))) { $allOk = $false }
    Run-Stage 'финальное состояние базы' @('scripts/import/show-import-status.js') | Out-Null

    if ($allOk) {
        Say 'ГОТОВО: база сначала наполнена Motul, затем обогащена доступными каталогами.'
        break
    }
    Say "ФАЗА 2 завершилась не полностью. Повтор обогащения через $SleepSec секунд; Motul заново не собираю."
    Start-Sleep -Seconds $SleepSec
}
