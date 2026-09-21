# Script de grabación de demostración de BookmarkForge con FFmpeg (PowerShell)
# Versión para Windows nativo

$ErrorActionPreference = "Stop"

# Configuración de grabación
$OutputDir = "demo-recordings"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$OutputFile = "$OutputDir\bookmarkforge_demo_$Timestamp.mp4"
$ScreenResolution = "1920x1080"
$Fps = 30
$Bitrate = "5M"

# Colores para output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-ColorOutput Green "=== Grabación de Demo BookmarkForge ==="
Write-Output "Directorio de salida: $OutputDir"
Write-Output "Archivo: $OutputFile"

# Crear directorio de salida
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Ruta de FFmpeg (instalado via winget)
$ffmpegPath = "C:\Users\CASA\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe"

# Verificar que ffmpeg está instalado
if (-not (Test-Path $ffmpegPath)) {
    Write-ColorOutput Red "Error: FFmpeg no está instalado en $ffmpegPath"
    Write-Output "Instalar con: winget install Gyan.FFmpeg"
    exit 1
}

try {
    $ffmpegVersion = & $ffmpegPath -version 2>&1 | Select-Object -First 1
    Write-ColorOutput Green "FFmpeg detectado: $ffmpegVersion"
} catch {
    Write-ColorOutput Red "Error: No se pudo ejecutar FFmpeg"
    exit 1
}

# Listar dispositivos de audio disponibles (Windows)
Write-ColorOutput Yellow "Dispositivos de audio disponibles:"
try {
    ffmpeg -list_devices true -f dshow -i dummy 2>&1 | Select-String "audio" | Select-Object -First 10
} catch {
    Write-Output "No se pudieron listar dispositivos de audio"
}

# Verificar que el servidor de desarrollo está corriendo
Write-ColorOutput Yellow "Verificando servidor de desarrollo..."
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4173" -UseBasicParsing -TimeoutSec 2
    Write-ColorOutput Green "Servidor de producción detectado en http://localhost:4173"
} catch {
    Write-ColorOutput Yellow "Advertencia: El servidor no parece estar corriendo en http://localhost:4173"
    Write-Output "Iniciarlo con: cd D:\bookmark7; npm run preview"
    $continue = Read-Host "¿Continuar de todos modos? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

Write-ColorOutput Green "=== Iniciando grabación ==="
Write-Output "Presiona Ctrl+C para detener la grabación"
Write-Output ""

# Comando de grabación para Windows con GDIGrab
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

Write-ColorOutput Yellow "Ejecutando: $ffmpegPath $ffmpegArgs"
& $ffmpegPath @ffmpegArgs

Write-ColorOutput Yellow "Ejecutando: ffmpeg $ffmpegArgs"
& ffmpeg @ffmpegArgs

Write-ColorOutput Green "=== Grabación completada ==="
Write-Output "Archivo guardado: $OutputFile"
Write-Output ""

# Mostrar información del archivo
if (Test-Path $OutputFile) {
    Write-ColorOutput Yellow "Información del archivo:"
    $fileInfo = Get-Item $OutputFile
    Write-Output "Tamaño: $([math]::Round($fileInfo.Length / 1MB, 2)) MB"
    Write-Output "Creado: $($fileInfo.CreationTime)"
    
    try {
        ffprobe -v quiet -print_format json -show_format -show_streams $OutputFile | ConvertFrom-Json | Format-List
    } catch {
        Write-Output "No se pudo mostrar información detallada"
    }
} else {
    Write-ColorOutput Red "Error: El archivo no se creó correctamente"
    exit 1
}

Write-ColorOutput Green "=== Siguientes pasos ==="
Write-Output "1. Revisar el video: $OutputFile"
Write-Output "2. Post-producción: .\demo-postprocess.ps1"
Write-Output "3. Subir a plataforma de video"