# Script de post-producción para demo de BookmarkForge
# Optimización y preparación del video para web

$ErrorActionPreference = "Stop"

# Ruta de FFmpeg (instalado via winget)
$ffmpegPath = "C:\Users\CASA\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe"

$InputDir = "demo-recordings"
$OutputDir = "demo-final"

function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-ColorOutput Green "=== Post-producción de Demo BookmarkForge ==="

# Crear directorio de salida
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Buscar el archivo más reciente en el directorio de grabación
if (-not (Test-Path $InputDir)) {
    Write-ColorOutput Red "Error: Directorio de grabación no encontrado: $InputDir"
    exit 1
}

$latestFile = Get-ChildItem -Path $InputDir -Filter "*.mp4" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $latestFile) {
    Write-ColorOutput Red "Error: No se encontraron archivos MP4 en $InputDir"
    exit 1
}

$inputFile = $latestFile.FullName
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outputFile = "$OutputDir\bookmarkforge_demo_final_$timestamp.mp4"

Write-Output "Archivo de entrada: $inputFile"
Write-Output "Archivo de salida: $outputFile"
Write-Output ""

# Paso 1: Optimización para web
Write-ColorOutput Yellow "Paso 1: Optimizando para web..."
$optimizeArgs = @(
    "-i", $inputFile
    "-c:v", "libx264"
    "-preset", "medium"
    "-crf", "28"
    "-maxrate", "1500k"
    "-bufsize", "3000k"
    "-pix_fmt", "yuv420p"
    "-movflags", "+faststart"
    "-c:a", "aac"
    "-b:a", "128k"
    "-vf", "scale=1280:720"
    $outputFile
)

& $ffmpegPath @optimizeArgs

if (-not (Test-Path $outputFile)) {
    Write-ColorOutput Red "Error: La optimización falló"
    exit 1
}

Write-ColorOutput Green "Optimización completada"

# Paso 2: Crear versión para redes sociales (cuadrado)
Write-ColorOutput Yellow "Paso 2: Creando versión para redes sociales..."
$socialFile = "$OutputDir\bookmarkforge_demo_social_$timestamp.mp4"
$socialArgs = @(
    "-i", $inputFile
    "-c:v", "libx264"
    "-preset", "medium"
    "-crf", "28"
    "-vf", "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2"
    "-c:a", "aac"
    "-b:a", "128k"
    "-movflags", "+faststart"
    $socialFile
)

& $ffmpegPath @socialArgs

Write-ColorOutput Green "Versión social creada"

# Paso 3: Crear GIF animado (para web)
Write-ColorOutput Yellow "Paso 3: Creando GIF animado..."
$gifFile = "$OutputDir\bookmarkforge_demo_preview_$timestamp.gif"
$gifArgs = @(
    "-i", $inputFile
    "-vf", "fps=10,scale=480:-1"
    "-t", "10"
    $gifFile
)

& $ffmpegPath @gifArgs

Write-ColorOutput Green "GIF animado creado"

# Paso 4: Generar thumbnail
Write-ColorOutput Yellow "Paso 4: Generando thumbnail..."
$thumbnailFile = "$OutputDir\bookmarkforge_demo_thumbnail_$timestamp.jpg"
$thumbnailArgs = @(
    "-i", $inputFile
    "-ss", "00:00:05"
    "-vframes", "1"
    "-vf", "scale=320:-1"
    $thumbnailFile
)

& $ffmpegPath @thumbnailArgs

Write-ColorOutput Green "Thumbnail generado"

# Mostrar resultados
Write-ColorOutput Green "=== Post-producción completada ==="
Write-Output ""

$outputFiles = @(
    @{Path = $outputFile; Description = "Versión optimizada web (720p)"},
    @{Path = $socialFile; Description = "Versión redes sociales (1080x1080)"},
    @{Path = $gifFile; Description = "GIF animado preview"},
    @{Path = $thumbnailFile; Description = "Thumbnail"}
)

foreach ($file in $outputFiles) {
    if (Test-Path $file.Path) {
        $fileInfo = Get-Item $file.Path
        $size = [math]::Round($fileInfo.Length / 1MB, 2)
        Write-Output "$($file.Description): $size MB"
    }
}

Write-Output ""
Write-ColorOutput Green "=== Archivos listos para distribución ==="
Write-Output "1. Video principal: $outputFile"
Write-Output "2. Versión social: $socialFile"
Write-Output "3. GIF preview: $gifFile"
Write-Output "4. Thumbnail: $thumbnailFile"