# =====================================================================
# Refocus — Clipboard Watcher для каталога оправ
# =====================================================================
# Что делает:
#   Каждые 400 мс читает буфер обмена. Если там новое изображение
#   (Alt+PrtScn в WeChat) — загружает в Supabase Storage + создаёт
#   запись в frame_supplier_catalog. Дедуп по SHA-256.
#
# Запуск:
#   В PowerShell из корня проекта:
#     powershell -STA -ExecutionPolicy Bypass -File scripts\clipboard-watcher.ps1
#
#   Флаг -STA нужен для доступа к Windows.Forms.Clipboard.
#
# Окно держи открытым во время работы. Закрытие = остановка watcher'а.
# =====================================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Парсим .env.local
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) ".env.local"
if (-not (Test-Path $envPath)) {
    Write-Host "❌ Не нашёл .env.local по пути $envPath" -ForegroundColor Red
    exit 1
}

$envVars = @{}
Get-Content $envPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    if ($line -match '^([^=]+?)\s*=\s*"?(.*?)"?\s*$') {
        $envVars[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$supabaseUrl = $envVars['NEXT_PUBLIC_SUPABASE_URL']
$serviceKey = $envVars['SUPABASE_SERVICE_ROLE_KEY']

if (-not $supabaseUrl -or -not $serviceKey) {
    Write-Host "❌ Не нашёл NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY в .env.local" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📋  Refocus Clipboard Watcher" -ForegroundColor Cyan
Write-Host "    Project: $supabaseUrl" -ForegroundColor DarkGray
Write-Host "    Bucket:  frame-supplier-catalog" -ForegroundColor DarkGray
Write-Host ""
Write-Host "    Алгоритм работы:"
Write-Host "      1) Открой в WeChat фото поставщика на полный экран"
Write-Host "      2) Нажми Alt+PrtScn"
Write-Host "      3) Скрипт сам загрузит фото и оно появится на странице"
Write-Host "      4) Стрелка вправо в WeChat → следующее фото → Alt+PrtScn"
Write-Host ""
Write-Host "    Закрой это окно когда закончишь."
Write-Host ""
Write-Host "    Жду фото в буфере..." -ForegroundColor Yellow
Write-Host ""

$lastHash = ""
$counter = 0

function Get-ClipboardImageBytes {
    if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
        return $null
    }
    try {
        $img = [System.Windows.Forms.Clipboard]::GetImage()
        if ($null -eq $img) { return $null }

        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        $width = $img.Width
        $height = $img.Height
        $ms.Close()
        $img.Dispose()

        return @{
            Bytes = $bytes
            Width = $width
            Height = $height
        }
    } catch {
        return $null
    }
}

function Get-Sha256Hex([byte[]]$bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha.ComputeHash($bytes)
    $sha.Dispose()
    return [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()
}

function Upload-ImageToSupabase($payload) {
    $hash = Get-Sha256Hex $payload.Bytes
    $storagePath = "{0}/{1}.png" -f $hash.Substring(0, 2), $hash

    # 1) Загрузка в Storage
    $uploadUrl = "$supabaseUrl/storage/v1/object/frame-supplier-catalog/$storagePath"
    $uploadHeaders = @{
        "Authorization" = "Bearer $serviceKey"
        "x-upsert"      = "true"
    }

    try {
        Invoke-RestMethod -Uri $uploadUrl -Method Post `
            -Headers $uploadHeaders `
            -ContentType "image/png" `
            -Body $payload.Bytes `
            -ErrorAction Stop | Out-Null
    } catch {
        return @{ ok = $false; error = "Storage upload: $($_.Exception.Message)"; hash = $hash }
    }

    # 2) Вставка в БД
    $dbUrl = "$supabaseUrl/rest/v1/frame_supplier_catalog"
    $dbHeaders = @{
        "apikey"        = $serviceKey
        "Authorization" = "Bearer $serviceKey"
        "Prefer"        = "return=minimal,resolution=ignore-duplicates"
    }
    $dbBody = @{
        image_hash   = $hash
        storage_path = $storagePath
        width_px     = $payload.Width
        height_px    = $payload.Height
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri $dbUrl -Method Post `
            -Headers $dbHeaders `
            -ContentType "application/json" `
            -Body $dbBody `
            -ErrorAction Stop | Out-Null
        return @{ ok = $true; hash = $hash; isNew = $true }
    } catch {
        # 409 conflict = дубликат — это OK
        if ($_.Exception.Response.StatusCode.value__ -eq 409) {
            return @{ ok = $true; hash = $hash; isNew = $false }
        }
        return @{ ok = $false; error = "DB insert: $($_.Exception.Message)"; hash = $hash }
    }
}

# При старте запоминаем хэш того, что уже лежит в буфере — этот контент
# НЕ грузим (это "старое", было до запуска watcher'а). Грузим только новые
# скриншоты, которые появятся после запуска.
$startup = Get-ClipboardImageBytes
if ($null -ne $startup) {
    $lastHash = Get-Sha256Hex $startup.Bytes
    Write-Host "    (в буфере уже лежало фото — пропустил его)" -ForegroundColor DarkGray
    Write-Host ""
}

while ($true) {
    Start-Sleep -Milliseconds 400

    $payload = Get-ClipboardImageBytes
    if ($null -eq $payload) { continue }

    # Быстрый префикс-хэш для дедупа без полной хеш-операции каждый раз
    $quickHash = Get-Sha256Hex $payload.Bytes
    if ($quickHash -eq $lastHash) { continue }
    $lastHash = $quickHash

    $counter++
    $sizeKb = [math]::Round($payload.Bytes.Length / 1024)
    $stamp = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$stamp] 📸 #$counter — $($payload.Width)x$($payload.Height), $sizeKb КБ → загружаю..." -NoNewline

    $result = Upload-ImageToSupabase -payload $payload

    if ($result.ok) {
        if ($result.isNew) {
            Write-Host " ✓ загружено" -ForegroundColor Green
        } else {
            Write-Host " ⚠ дубль (уже было)" -ForegroundColor Yellow
        }
    } else {
        Write-Host " ❌ $($result.error)" -ForegroundColor Red
    }
}
