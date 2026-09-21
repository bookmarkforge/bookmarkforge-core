# Script de grabación con automatización humana V2
# Manejo mejorado de cierre de FFmpeg para evitar corrupción de archivos

$ErrorActionPreference = "Stop"

# Configuración
$OutputDir = "demo-recordings"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$OutputFile = "$OutputDir\bookmarkforge_automated_demo_$Timestamp.mp4"
$Fps = 30
$Bitrate = "5M"

# Ruta de FFmpeg
$ffmpegPath = "C:\Users\CASA\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe"

function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-ColorOutput Green "=== Demo Automatizada de BookmarkForge V2 ==="
Write-Output "Mejoras: Cierre limpio de FFmpeg para evitar corrupción de archivos"
Write-Output ""

# Crear directorio de salida
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Verificar FFmpeg
if (-not (Test-Path $ffmpegPath)) {
    Write-ColorOutput Red "Error: FFmpeg no encontrado en $ffmpegPath"
    exit 1
}

# Verificar servidor
Write-ColorOutput Yellow "Verificando servidor..."
try {
    Invoke-WebRequest -Uri "http://localhost:4173" -UseBasicParsing -TimeoutSec 2 | Out-Null
    Write-ColorOutput Green "Servidor detectado en http://localhost:4173"
} catch {
    Write-ColorOutput Red "Error: Servidor no corriendo. Iniciarlo con: npm run preview"
    exit 1
}

Write-ColorOutput Green "=== Iniciando grabación ==="
Write-Output "Archivo: $OutputFile"
Write-Output ""

# Iniciar FFmpeg capturando ventana específica (más robusto)
$ffmpegArgs = @(
    "-y"
    "-f", "gdigrab"
    "-framerate", $Fps
    "-i", "title=BookmarkForge"  # Capturar ventana específica por título
    "-c:v", "libx264"
    "-preset", "medium"  # Mejor calidad
    "-crf", "23"
    "-pix_fmt", "yuv420p"
    "-r", $Fps
    "-b:v", $Bitrate
    "-t", "180"  # Limitar a 3 minutos máximo
    "$OutputFile.mp4"
)

$ffmpegProcess = Start-Process -FilePath $ffmpegPath -ArgumentList $ffmpegArgs -PassThru -WindowStyle Hidden

Write-ColorOutput Yellow "FFmpeg iniciado (PID: $($ffmpegProcess.Id))"
Write-ColorOutput Yellow "Iniciando automatización Playwright..."
Write-Output ""

# Esperar estabilización
Start-Sleep -Seconds 3

# Ejecutar Playwright
try {
    $playwrightArgs = @(
        "test"
        "tests/e2e/demo-automation.spec.ts"
        "--config=playwright.config.ts"
        "--headed"
        "--reporter=list"
    )
    
    & npx playwright @playwrightArgs
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ Automatización Playwright completada exitosamente"
    } else {
        Write-ColorOutput Yellow "⚠️ Playwright terminó con código: $LASTEXITCODE"
    }
} catch {
    Write-ColorOutput Red "Error ejecutando Playwright: $_"
} finally {
    # Cierre limpio de FFmpeg
    Write-ColorOutput Yellow "Cerrando FFmpeg limpiamente..."
    
    try {
        # Esperar un momento para que el archivo se escriba
        Start-Sleep -Seconds 2
        
        # Terminar proceso
        if (!$ffmpegProcess.HasExited) {
            $ffmpegProcess.Kill()
            Write-ColorOutput Green "✅ FFmpeg cerrado"
        }
    } catch {
        Write-ColorOutput Yellow "Advertencia: Error cerrando FFmpeg"
    }
    
    # Esperar escritura final
    Start-Sleep -Seconds 3
}

# Verificar archivo creado
if (Test-Path $OutputFile) {
    $fileInfo = Get-Item $OutputFile
    $size = [math]::Round($fileInfo.Length / 1MB, 2)
    Write-ColorOutput Green "=== Grabación completada ==="
    Write-Output "Archivo: $OutputFile"
    Write-Output "Tamaño: $size MB"
    Write-Output "Creado: $($fileInfo.CreationTime)"
    Write-Output ""
    
    # Verificar integridad básica
    if ($fileInfo.Length -gt 100KB) {
        Write-ColorOutput Green "✅ Archivo parece válido (>$([math]::Round(100KB/1MB, 2)) MB)"
        Write-Output ""
        Write-ColorOutput Green "Siguiente paso: .\demo-postprocess.ps1"
    } else {
        Write-ColorOutput Red "⚠️ Archivo parece demasiado pequeño, posible corrupción"
    }
} else {
    Write-ColorOutput Red "Error: El archivo de video no se creó"
    exit 1
}