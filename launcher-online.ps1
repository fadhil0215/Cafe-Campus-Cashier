$ErrorActionPreference = 'Continue'
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
$CloudflaredExe = Join-Path $Root 'cloudflared.exe'
$LauncherPidFile = Join-Path $RuntimeRoot 'online-launcher.pid'

# Pastikan folder logs dan .runtime siap
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
if (-not (Test-Path $RuntimeRoot)) { New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null }

Set-Content -Path $LauncherPidFile -Value $PID -Encoding Ascii

try {
    Write-Host ''
    Write-Host '======================================================================' -ForegroundColor Cyan
    Write-Host '          CAFE CAMPUS - ONLINE PUBLIC DEMO (CLOUDFLARE TUNNEL)        ' -ForegroundColor Cyan
    Write-Host '======================================================================' -ForegroundColor Cyan
    Write-Host ''

    # 1. Cek MySQL
    $mysqlActive = $false
    try {
        $mysqlActive = (Test-NetConnection 127.0.0.1 -Port 3306 -WarningAction SilentlyContinue).TcpTestSucceeded
    } catch {}

    if (-not $mysqlActive) {
        Write-Host '[PERINGATAN] Database MySQL belum aktif di port 3306!' -ForegroundColor Yellow
        Write-Host '  - Pastikan aplikasi Laragon / XAMPP sudah dinyalakan (Start All).' -ForegroundColor DarkYellow
        Write-Host ''
    } else {
        Write-Host '[OK] Database MySQL aktif di port 3306.' -ForegroundColor Green
    }

    # Fungsi deteksi Node.js
    function Test-NodeExecutable([string]$Path) {
        if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) { return $false }
        try {
            $version = & $Path --version 2>$null
            if ($LASTEXITCODE -ne 0 -or -not $version) { return $false }
            $major = [int](($version -replace '^v','').Split('.')[0])
            return ($major -ge 18)
        } catch { return $false }
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

    $node = Find-Node
    if (-not $node) {
        Write-Host '[ERROR] Node.js tidak ditemukan di sistem!' -ForegroundColor Red
        Write-Host 'Silakan instal Node.js v18+ atau jalankan start-demo.bat terlebih dahulu.' -ForegroundColor Red
        Read-Host 'Tekan Enter untuk keluar'
        exit 1
    }

    # 2. Cek apakah server lokal 4176 sudah aktif
    function Test-Health {
        try {
            $r = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2 -ErrorAction Stop
            if ($r.ok -eq $true -or $r.status -eq 'ok' -or $r.status -eq 'healthy') { return $true }
        } catch {}
        return $false
    }

    $serverRunning = Test-Health
    if (-not $serverRunning) {
        Write-Host '[INFO] Memeriksa & menjalankan migrasi database v7...' -ForegroundColor Cyan
        try { & $node (Join-Path $Root 'run-migration.mjs') *> $null } catch {}

        Write-Host '[INFO] Menyalakan server Cafe Campus lokal di port 4176...' -ForegroundColor Cyan
        $env:HOST = '0.0.0.0'
        $env:PORT = "$Port"
        $proc = Start-Process -FilePath $node `
            -ArgumentList @('server.mjs') `
            -WorkingDirectory $Root `
            -WindowStyle Hidden `
            -RedirectStandardOutput $StdoutLog `
            -RedirectStandardError $StderrLog `
            -PassThru
        Set-Content -Path (Join-Path $RuntimeRoot 'server.pid') -Value $proc.Id -Encoding Ascii

        Write-Host '[INFO] Menunggu server siap di http://127.0.0.1:4176/api/health ...' -ForegroundColor Gray
        $ready = $false
        for ($i = 0; $i -lt 25; $i++) {
            Start-Sleep -Seconds 1
            if ($proc.HasExited) { break }
            if (Test-Health) { $ready = $true; break }
        }

        if (-not $ready) {
            Write-Host ''
            Write-Host '[ERROR] Server lokal gagal merespons setelah 25 detik!' -ForegroundColor Red
            if (Test-Path $StderrLog) {
                Write-Host '--- Log Error Server ---' -ForegroundColor Yellow
                Get-Content $StderrLog -Tail 15 | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
            }
            Write-Host ''
            Read-Host 'Tekan Enter untuk keluar'
            exit 1
        }
    }

    Write-Host '[OK] Server lokal siap dan sehat!' -ForegroundColor Green
    Write-Host ''

    # 3. Jalankan Cloudflare Tunnel
    if (-not (Test-Path $CloudflaredExe)) {
        Write-Host "[ERROR] cloudflared.exe tidak ditemukan di $Root!" -ForegroundColor Red
        Read-Host 'Tekan Enter untuk keluar'
        exit 1
    }

    # Auto-reconnection loop for Cloudflare Tunnel
    while ($true) {
        if (-not (Test-Health)) {
            Write-Host "`n[INFO] Server Cafe Campus lokal telah berhenti. Menutup tunnel." -ForegroundColor Cyan
            break
        }

        Write-Host '======================================================================' -ForegroundColor Green
        Write-Host '  Membuka Tunnel Cloudflare Publik (Protokol HTTP/2 Stabil)...' -ForegroundColor Green
        Write-Host '  URL publik akan disalin otomatis ke CLIPBOARD Anda!' -ForegroundColor Green
        Write-Host '======================================================================' -ForegroundColor Green
        Write-Host ''

        # Bersihkan cloudflared lama
        Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

        $processInfo = New-Object System.Diagnostics.ProcessStartInfo
        $processInfo.FileName = $CloudflaredExe
        $processInfo.Arguments = "tunnel --protocol auto --url http://127.0.0.1:4176"
        $processInfo.RedirectStandardError = $true
        $processInfo.RedirectStandardOutput = $false
        $processInfo.UseShellExecute = $false
        $processInfo.CreateNoWindow = $true

        $tunnelProc = New-Object System.Diagnostics.Process
        $tunnelProc.StartInfo = $processInfo

        $urlFound = $false

        try {
            $tunnelProc.Start() | Out-Null
            Set-Content -Path (Join-Path $RuntimeRoot 'cloudflared.pid') -Value $tunnelProc.Id -Encoding Ascii

            while (-not $tunnelProc.HasExited) {
                $line = $tunnelProc.StandardError.ReadLine()
                if ($null -ne $line) {
                    if ($line -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
                        $tunnelUrl = $matches[0]
                        if (-not $urlFound) {
                            $urlFound = $true
                            Write-Host ''
                            Write-Host '======================================================================' -ForegroundColor Green
                            Write-Host '  ★ TUNNEL BERHASIL AKTIF (PROTOKOL HTTP/2 ANTI-DROP) ★' -ForegroundColor Green
                            Write-Host "  URL Publik Demo:  $tunnelUrl" -ForegroundColor Yellow
                            Write-Host '======================================================================' -ForegroundColor Green
                            Write-Host ''

                            try {
                                Set-Clipboard -Value $tunnelUrl
                                Write-Host '  [OK] Link telah disalin otomatis ke CLIPBOARD (Ctrl+V di HP/Browser)!' -ForegroundColor Green
                            } catch {
                                try { $tunnelUrl | clip.exe } catch {}
                            }

                            Write-Host "  [TIPS] Buka link di atas melalui Smartphone atau bagikan ke penguji!" -ForegroundColor Cyan
                            Write-Host "  [ADMIN] Login Admin: ${tunnelUrl}/admin/login" -ForegroundColor Cyan
                            Write-Host "  [KDS]   Kitchen Display: ${tunnelUrl}/admin/kds" -ForegroundColor Cyan
                            Write-Host "  [STOP]  Tekan Ctrl+C di terminal ini atau jalankan stop-demo.bat.`n" -ForegroundColor DarkGray
                        }
                    }
                    if ($line -match "ERR" -or $line -match "Your quick Tunnel has been created") {
                        Write-Host $line -ForegroundColor DarkGray
                    }
                }
            }
        } finally {
            if ($tunnelProc -and -not $tunnelProc.HasExited) {
                try { $tunnelProc.Kill() } catch {}
            }
            $cfPidFile = Join-Path $RuntimeRoot 'cloudflared.pid'
            if (Test-Path $cfPidFile) {
                try { Remove-Item -Path $cfPidFile -Force -ErrorAction SilentlyContinue } catch {}
            }
        }

        if (-not (Test-Health)) {
            Write-Host "`n[INFO] Server Cafe Campus lokal telah berhenti. Menutup launcher." -ForegroundColor Cyan
            break
        }

        Write-Host ''
        Write-Host '[PERINGATAN] Tunnel terputus! Melakukan auto-restart dalam 3 detik...' -ForegroundColor Yellow
        Start-Sleep -Seconds 3
    }
} finally {
    if (Test-Path $LauncherPidFile) {
        try { Remove-Item -Path $LauncherPidFile -Force -ErrorAction SilentlyContinue } catch {}
    }
}
