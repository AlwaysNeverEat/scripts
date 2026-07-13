# -----------------------------------------------------------------------------
# Конвейер импорта для Windows (PowerShell-зеркало pipeline.sh).
# Этапы циклом: Motul (объёмы) → ROLF (допуски) → заливка → Mann (фильтры+
# кВт/ЛС+ссылки) → дозапись. Сам перезапускает упавший скрейпер Motul,
# останавливается когда всё собрано и долито.
#
# Проще всего — двойной клик по run-import.bat (он вызывает этот файл).
# Вручную:  powershell -ExecutionPolicy Bypass -File pipeline.ps1
#
# Доступ к БД (Supabase Management API через HTTPS): токен и ref спрашиваются
# один раз и сохраняются в %USERPROFILE%\.cars-import.json. Сбросить —
# удалить этот файл.
# -----------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# → backend/ (скрипт лежит в backend/scripts/import/)
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$Backend = (Get-Location).Path
$Root    = (Resolve-Path (Join-Path $Backend '..')).Path
$DataDir = Join-Path $Root 'data\import'
$LogDir  = Join-Path $DataDir 'logs'
$null = New-Item -ItemType Directory -Force -Path $LogDir
$PipeLog  = Join-Path $LogDir 'pipeline.log'
$MotulLog = Join-Path $LogDir 'scrape-motul.log'

$ImportUser = if ($env:IMPORT_USER) { $env:IMPORT_USER } else { 'gtrixoff' }
$SleepSec   = if ($env:PIPELINE_SLEEP) { [int]$env:PIPELINE_SLEEP } else { 600 }

function Say([string]$msg) {
    $line = "== {0} {1}" -f (Get-Date -Format 'dd.MM HH:mm'), $msg
    Write-Host $line
    Add-Content -Path $PipeLog -Value $line -Encoding UTF8
}

# -- Проверка Node ------------------------------------------------------------
try { $nodeVer = (& node --version) 2>$null } catch { $nodeVer = $null }
if (-not $nodeVer) {
    Write-Host ''
    Write-Host 'Node.js не найден — без него скрипты не запустятся.' -ForegroundColor Yellow
    Write-Host 'Установи одним из способов и запусти снова:' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  1) В этом окне:   winget install OpenJS.NodeJS.LTS'
    Write-Host '  2) Или скачай:    https://nodejs.org  (кнопка LTS, дальше «Далее-Далее»)'
    Write-Host ''
    Write-Host 'После установки закрой это окно и запусти run-import.bat заново.' -ForegroundColor Yellow
    exit 1
}
Say "Node $nodeVer, юзер: $ImportUser"

# -- Зависимости --------------------------------------------------------------
if (-not (Test-Path (Join-Path $Backend 'node_modules'))) {
    Say 'ставлю зависимости (npm install)…'
    & npm install --no-audit --no-fund
}

# -- Распаковка снапшотов данных (.json.gz → .json), если сырых ещё нет --------
function Expand-Gzip([string]$gz, [string]$out) {
    $inS  = [System.IO.File]::OpenRead($gz)
    $outS = [System.IO.File]::Create($out)
    $gzS  = New-Object System.IO.Compression.GzipStream($inS, [System.IO.Compression.CompressionMode]::Decompress)
    try { $gzS.CopyTo($outS) } finally { $gzS.Dispose(); $outS.Dispose(); $inS.Dispose() }
}
foreach ($name in 'motul-cars','cars-enriched','filters') {
    $json = Join-Path $DataDir "$name.json"
    $gz   = Join-Path $DataDir "$name.json.gz"
    if ((-not (Test-Path $json)) -and (Test-Path $gz)) {
        Say "распаковываю $name.json.gz"
        Expand-Gzip $gz $json
    }
}

# -- Конфиг БД (токен Supabase) -----------------------------------------------
$CfgPath = Join-Path $env:USERPROFILE '.cars-import.json'
if ($env:SUPABASE_ACCESS_TOKEN -and $env:SUPABASE_PROJECT_REF) {
    # уже в окружении — ничего не спрашиваем
} elseif (Test-Path $CfgPath) {
    $cfg = Get-Content $CfgPath -Raw | ConvertFrom-Json
    $env:SUPABASE_ACCESS_TOKEN = $cfg.token
    $env:SUPABASE_PROJECT_REF  = $cfg.projectRef
} else {
    Write-Host ''
    Write-Host 'Первый запуск — нужен доступ к базе Supabase (спрошу один раз).' -ForegroundColor Cyan
    Write-Host 'Токен: https://supabase.com/dashboard/account/tokens → Generate new token'
    $tok = Read-Host 'Вставь токен (sbp_…)'
    $refDefault = 'whcqsletieyxikdvpbfu'
    $ref = Read-Host "ID проекта (Enter = $refDefault)"
    if ([string]::IsNullOrWhiteSpace($ref)) { $ref = $refDefault }
    @{ token = $tok.Trim(); projectRef = $ref.Trim() } | ConvertTo-Json | Set-Content -Path $CfgPath -Encoding UTF8
    $env:SUPABASE_ACCESS_TOKEN = $tok.Trim()
    $env:SUPABASE_PROJECT_REF  = $ref.Trim()
    Write-Host "Сохранил в $CfgPath (удали этот файл, чтобы сбросить)." -ForegroundColor Cyan
}

# -- Хелперы ------------------------------------------------------------------
function Count-Json([string]$file) {
    if (-not (Test-Path $file)) { return 0 }
    try {
        $n = & node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(Array.isArray(d)?d.length:Object.keys(d).length)" $file
        return [int]$n
    } catch { return 0 }
}

# Запуск одного этапа: node-скрипт, вывод дописываем в общий лог.
function Run-Stage([string]$title, [string[]]$argList) {
    Say "этап: $title"
    & node @argList *>> $PipeLog
}

# -- Основной цикл ------------------------------------------------------------
Say "конвейер запущен"
$motulProc  = $null
$motulDone  = $false
$prevCount  = -1

while ($true) {
    $count = Count-Json (Join-Path $DataDir 'motul-cars.json')

    if (-not $motulDone) {
        $alive = ($motulProc -ne $null) -and (-not $motulProc.HasExited)
        if (-not $alive) {
            if ($count -ne $prevCount) {
                Say "скрейпер Motul не работает — (пере)запускаю (машин: $count)"
                $motulProc = Start-Process -FilePath 'node' `
                    -ArgumentList 'scripts/import/scrape-motul.js' `
                    -RedirectStandardOutput $MotulLog -RedirectStandardError (Join-Path $LogDir 'scrape-motul.err.log') `
                    -NoNewWindow -PassThru
            } else {
                Say "скрейпер Motul закончил (машин: $count)"
                $motulDone = $true
            }
        }
    }
    $prevCount = $count

    Run-Stage 'допуски ROLF' @('scripts/import/scrape-rolf.js','--in','data/import/motul-cars.json','--out','data/import/cars-enriched.json')
    Run-Stage 'заливка машин в БД' @('scripts/import/import-cars.js','data/import/cars-enriched.json','--user',$ImportUser,'--state','data/import/.imported-keys.json')
    if (-not $env:SCRAPE_INTERVAL_MS) { $env:SCRAPE_INTERVAL_MS = '500' }
    Run-Stage 'подбор фильтров Mann' @('scripts/import/scrape-filters.js')
    Run-Stage 'дозапись фильтров/мощности/ссылок' @('scripts/import/apply-filters.js','--user',$ImportUser)

    $inC  = Count-Json (Join-Path $DataDir 'motul-cars.json')
    $outC = Count-Json (Join-Path $DataDir 'cars-enriched.json')
    Say "итог цикла: собрано=$inC обогащено=$outC motul_done=$motulDone"

    if ($motulDone -and ($inC -eq $outC)) {
        Say 'ГОТОВО: всё собрано и долито, конвейер останавливается'
        break
    }
    Start-Sleep -Seconds $SleepSec
}
