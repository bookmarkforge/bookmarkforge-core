# Script de grabación con automatización humana
# Integra FFmpeg para grabación + Playwright para automatización

$ErrorActionPreference = "Stop"

# Configuración
$OutputDir = "demo-recordings"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$OutputFile = "$OutputDir\bookmarkforge_automated_demo_$Timestamp.mp4"
$Fps = 30
$Bitrate = "5M"

# Ruta de FFmpeg
$ffmpegPath = "C:\Users\CASA\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe"

# Ruta de Node/Playwright
$nodePath = "node"
$playwrightConfig = "playwright.config.ts"

function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-ColorOutput Green "=== Demo Automatizada de BookmarkForge ==="
Write-Output "Este script:"
Write-Output "1. Inicia grabación de pantalla con FFmpeg"
Write-Output "2. Ejecuta automatización Playwright con comportamiento humano"
Write-Output "3. Detiene grabación automáticamente al finalizar"
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
    $response = Invoke-WebRequest -Uri "http://localhost:4173" -UseBasicParsing -TimeoutSec 2
    Write-ColorOutput Green "Servidor detectado en http://localhost:4173"
} catch {
    Write-ColorOutput Red "Error: Servidor no corriendo. Iniciarlo con: npm run preview"
    exit 1
}

Write-ColorOutput Green "=== Iniciando grabación ==="
Write-Output "Archivo: $OutputFile"
Write-Output ""

# Iniciar FFmpeg en background
$ffmpegArgs = @(
    "-y"
    "-f", "gdigrab"
    "-framerate", $Fps
    "-i", "desktop"
    "-c:v", "libx264"
    "-preset", "ultrafast"
    "-crf", "23"
    "-pix_fmt", "yuv420p"
    "-r", $Fps
    "-b:v", $Bitrate
    $OutputFile
)

$ffmpegProcess = Start-Process -FilePath $ffmpegPath -ArgumentList $ffmpegArgs -PassThru -WindowStyle Hidden

Write-ColorOutput Yellow "FFmpeg iniciado (PID: $($ffmpegProcess.Id))"
Write-ColorOutput Yellow "Iniciando automatización Playwright..."
Write-Output ""

# Esperar un momento para que FFmpeg se estabilice
Start-Sleep -Seconds 2

# Ejecutar Playwright
try {
    $playwrightArgs = @(
        "test"
        "tests/e2e/demo-automation.spec.ts"
        "--config=$playwrightConfig"
        "--headed"
        "--reporter=list"
    )
    
    # Usar npx para ejecutar Playwright correctamente en Windows
    $npxArgs = @("playwright") + $playwrightArgs
    & npx @npxArgs
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ Automatización Playwright completada exitosamente"
    } else {
        Write-ColorOutput Yellow "⚠️ Playwright terminó con código: $LASTEXITCODE"
    }
} catch {
    Write-ColorOutput Red "Error ejecutando Playwright: $_"
} finally {
    # Detener FFmpeg limpiamente (enviar 'q' para cerrar archivo correctamente)
    Write-ColorOutput Yellow "Deteniendo grabación limpiamente..."
    
    try {
        # Enviar 'q' a FFmpeg para cerrar correctamente
        Add-Content -Path "temp_ffmpeg_input.txt" -Value "q"
        Start-Sleep -Seconds 3
        
        # Si aún está corriendo, forzar cierre
        if (!$ffmpegProcess.HasExited) {
            Stop-Process -Id $ffmpegProcess.Id -Force
            Write-ColorOutput Yellow "FFmpeg forzado a cerrar"
        } else {
            Write-ColorOutput Green "✅ FFmpeg cerrado correctamente"
        }
    } catch {
        Write-ColorOutput Yellow "Advertencia: Error cerrando FFmpeg limpiamente"
        try {
            Stop-Process -Id $ffmpegProcess.Id -Force
        } catch {
            # Ignorar si ya no existe
        }
    }
    
    # Esperar a que FFmpeg termine de escribir el archivo
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
    Write-ColorOutput Green "Siguiente paso: .\demo-postprocess.ps1"
} else {
    Write-ColorOutput Red "Error: El archivo de video no se creó"
    exit 1
}