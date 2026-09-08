$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$Port = 4176
$Url = "http://127.0.0.1:$Port"
$RuntimeRoot = Join-Path $Root '.runtime'
$NodeRoot = Join-Path $RuntimeRoot 'node'
$LogDir = Join-Path $Root 'logs'
$StdoutLog = Join-Path $LogDir 'demo-server.log'
$StderrLog = Join-Path $LogDir 'demo-server-error.log'

function Write-Title {
    Clear-Host
    Write-Host ''
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host '  CAFE CAMPUS - SISTEM PEMESANAN & DEMO' -ForegroundColor Cyan
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host ''
}

function Test-NodeExecutable([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) { return $false }
    try {
        $version = & $Path --version 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $version) { return $false }
        $major = [int](($version -replace '^v','').Split('.')[0])
        return ($major -ge 20)
    } catch { return $false }
}

function Get-LanIPv4 {
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.AddressState -eq 'Preferred' } |
            Sort-Object InterfaceMetric |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) { return $ip }
    } catch {}
    try {
        $ip = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=True" |
            ForEach-Object { $_.IPAddress } |
            Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notmatch '^(127\.|169\.254\.)' } |
            Select-Object -First 1
        if ($ip) { return $ip }
    } catch {}
    return $null
}

function Find-Node {
    $candidates = New-Object System.Collections.Generic.List[string]
    $portable = Join-Path $NodeRoot 'node.exe'
    $candidates.Add($portable)
    try { $cmd = Get-Command node.exe -ErrorAction Stop; if ($cmd.Source) { $candidates.Add($cmd.Source) } } catch {}
    if ($env:NVM_SYMLINK) { $candidates.Add((Join-Path $env:NVM_SYMLINK 'node.exe')) }
    $common = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:LOCALAPPDATA\nodejs\node.exe"
    )
    foreach ($p in $common) { if ($p) { $candidates.Add($p) } }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-NodeExecutable $candidate) { return $candidate }
    }
    return $null
}

function Get-PortableNode {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Write-Host '[AUTO] Node 20+ belum tersedia. Menyiapkan Node.js LTS portable resmi...' -ForegroundColor Yellow
    Write-Host '       Tidak mengubah instalasi Windows dan tidak membutuhkan npm install.' -ForegroundColor DarkGray
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 30
        $release = $index | Where-Object { $_.lts -and ([int](($_.version -replace '^v','').Split('.')[0]) -ge 20) } | Select-Object -First 1
        if (-not $release) { throw 'Release Node.js LTS tidak ditemukan.' }
        $archRaw = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        $arch = if ($archRaw -match 'ARM64') { 'arm64' } else { 'x64' }
        $version = $release.version
        $folder = "node-$version-win-$arch"
        $zipPath = Join-Path $RuntimeRoot "$folder.zip"
        $extractTemp = Join-Path $RuntimeRoot '_extract'
        if (Test-Path $extractTemp) { Remove-Item -Recurse -Force $extractTemp }
        if (Test-Path $NodeRoot) { Remove-Item -Recurse -Force $NodeRoot }
        Write-Host "[AUTO] Download $version ($arch)..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/$folder.zip" -OutFile $zipPath -UseBasicParsing -TimeoutSec 120
        Write-Host '[AUTO] Extract runtime...' -ForegroundColor Cyan
        Expand-Archive -Path $zipPath -DestinationPath $extractTemp -Force
        Move-Item -Path (Join-Path $extractTemp $folder) -Destination $NodeRoot
        Remove-Item -Recurse -Force $extractTemp
        Remove-Item -Force $zipPath
        $nodeExe = Join-Path $NodeRoot 'node.exe'
        if (-not (Test-NodeExecutable $nodeExe)) { throw 'Runtime portable selesai diekstrak tetapi node.exe tidak dapat dijalankan.' }
        return $nodeExe
    } catch {
        Write-Host ''
        Write-Host '[GAGAL] Node portable tidak dapat disiapkan otomatis.' -ForegroundColor Red
        Write-Host "Detail: $($_.Exception.Message)" -ForegroundColor Red
        throw
    }
}

function Test-DemoServer([string]$NodeExe) {
    try {
        & $NodeExe -e "const u=process.argv[1];const c=new AbortController();setTimeout(()=>c.abort(),700);fetch(u,{signal:c.signal,cache:'no-store'}).then(r=>process.exit(r.ok?0:2)).catch(()=>process.exit(3));" "$Url/api/health" *> $null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

function Run-SmokeCheck([string]$NodeExe) {
    & $NodeExe (Join-Path $Root 'smoke-check.mjs') $Url
    if ($LASTEXITCODE -ne 0) { throw 'Self-check API/static demo gagal.' }
}

function Start-Demo([string]$NodeExe) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

    Write-Host "[OK] Node: $NodeExe" -ForegroundColor Green
    Write-Host "[OK] Versi: $(& $NodeExe --version)" -ForegroundColor Green

    if (Test-DemoServer $NodeExe) {
        Write-Host '[OK] Demo server sudah berjalan.' -ForegroundColor Green
        Run-SmokeCheck $NodeExe
        return
    }

    Write-Host '[START] Menjalankan server demo...' -ForegroundColor Cyan
    $lanIp = Get-LanIPv4
    $env:HOST = '0.0.0.0'
    $env:PORT = "$Port"
    if ($lanIp) { $env:DEMO_PUBLIC_BASE = "http://${lanIp}:$Port" } else { $env:DEMO_PUBLIC_BASE = $Url }
    $proc = Start-Process -FilePath $NodeExe `
        -ArgumentList @('server.mjs') `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog `
        -PassThru
    Set-Content -Path (Join-Path $RuntimeRoot 'server.pid') -Value $proc.Id -Encoding Ascii

    $ready = $false
    for ($i=0; $i -lt 24; $i++) {
        Start-Sleep -Milliseconds 250
        if ($proc.HasExited) { break }
        if (Test-DemoServer $NodeExe) { $ready = $true; break }
    }
    if (-not $ready) {
        Write-Host ''
        Write-Host '[GAGAL] Server tidak memberikan health-check dalam batas waktu.' -ForegroundColor Red
        if (Test-Path $StderrLog) { Get-Content $StderrLog -Tail 25 | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow } }
        throw 'Server Cafe Campus Demo gagal start.'
    }

    Write-Host '[CHECK] Server aktif. Menjalankan self-check halaman + API...' -ForegroundColor Cyan
    Run-SmokeCheck $NodeExe
    Write-Host '[OK] Self-check lulus.' -ForegroundColor Green
}

Write-Title
try {
    $node = Find-Node
    if (-not $node) { $node = Get-PortableNode }
    Start-Demo $node
    Write-Host ''
    Write-Host "[OPEN] Desktop: $Url" -ForegroundColor Cyan
    $lanIp = Get-LanIPv4
    if ($lanIp) {
        Write-Host "[MOBILE] http://${lanIp}:$Port" -ForegroundColor Green
        Write-Host '         HP harus berada di Wi-Fi/LAN yang sama. Jika Windows Firewall bertanya, izinkan Private networks.' -ForegroundColor DarkGray
    }
    Start-Process $Url
    Write-Host '[READY] Cafe Campus Demo siap direview di desktop dan mobile.' -ForegroundColor Green
    Write-Host 'Jendela ini akan menutup otomatis. Gunakan stop-demo.bat untuk menghentikan server.' -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
    exit 0
} catch {
    Write-Host ''
    Write-Host '[ERROR] Demo tidak dibuka karena self-check belum lulus.' -ForegroundColor Red
    Write-Host "Detail: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log server: $StderrLog" -ForegroundColor Yellow
    Write-Host ''
    Read-Host 'Tekan Enter untuk menutup'
    exit 1
}
