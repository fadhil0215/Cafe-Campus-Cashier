$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir ".runtime"
$cloudflared = Join-Path $runtimeDir "cloudflared.exe"

if (-not (Test-Path $cloudflared)) {
    try {
        if (-not (Test-Path $runtimeDir)) { New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Host '[DOWNLOAD] Mengambil Cloudflare Tunnel resmi untuk Windows x64...' -ForegroundColor Cyan
        Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflared -UseBasicParsing -TimeoutSec 180
        if ((Get-Item $cloudflared).Length -lt 1000000) { throw 'File Cloudflared hasil download tidak valid.' }
    } catch {
        Remove-Item $cloudflared -Force -ErrorAction SilentlyContinue
        Write-Host "[ERROR] Cloudflared gagal disiapkan: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# Bersihkan proses cloudflared lama jika ada
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Menghubungkan tunnel Cloudflare publik (auto-negotiation & keep-alive)..." -ForegroundColor Cyan

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $cloudflared
$processInfo.Arguments = "tunnel --protocol auto --url http://127.0.0.1:4176"
$processInfo.RedirectStandardError = $true
$processInfo.RedirectStandardOutput = $false
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $processInfo

$urlFound = $false

try {
    $process.Start() | Out-Null

    # Catat PID cloudflared
    $pidDir = Join-Path $scriptDir ".runtime"
    if (-not (Test-Path $pidDir)) { New-Item -ItemType Directory -Path $pidDir -Force | Out-Null }
    Set-Content -Path (Join-Path $pidDir "cloudflared.pid") -Value $process.Id -Encoding Ascii

    while (-not $process.HasExited) {
        $line = $process.StandardError.ReadLine()
        if ($null -ne $line) {
            if ($line -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
                $tunnelUrl = $matches[0]
                if (-not $urlFound) {
                    $urlFound = $true
                    Write-Host "`n======================================================================" -ForegroundColor Green
                    Write-Host "  TUNNEL BERHASIL AKTIF (PROTOKOL HTTP/2 ANTI-DROP)" -ForegroundColor Green
                    Write-Host "  URL Publik Demo:  $tunnelUrl" -ForegroundColor Yellow
                    Write-Host "======================================================================`n" -ForegroundColor Green
                    
                    try {
                        Set-Clipboard -Value $tunnelUrl
                        Write-Host "  [OK] Link telah disalin otomatis ke CLIPBOARD (Ctrl+V di HP/Browser)!`n" -ForegroundColor Green
                    } catch {
                        try { $tunnelUrl | clip.exe } catch {}
                    }
                    Write-Host "  [TIPS] Bagikan link ini atau buka langsung di browser / HP Anda." -ForegroundColor Cyan
                    Write-Host "  [INFO] Tekan Ctrl+C untuk menutup tunnel.`n" -ForegroundColor DarkGray
                }
            }
            if ($line -match "ERR" -or $line -match "Your quick Tunnel has been created") {
                Write-Host $line -ForegroundColor DarkGray
            }
        }
    }
} finally {
    if ($process -and -not $process.HasExited) {
        try { $process.Kill() } catch {}
    }
    $cfPidFile = Join-Path $scriptDir ".runtime\cloudflared.pid"
    if (Test-Path $cfPidFile) {
        try { Remove-Item -Path $cfPidFile -Force } catch {}
    }
}

if ($process) {
    exit $process.ExitCode
} else {
    exit 0
}
