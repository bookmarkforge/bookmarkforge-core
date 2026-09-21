#!/bin/bash
# Script de grabación de demostración de BookmarkForge con FFmpeg
# Adaptado para Windows (Git Bash)

set -e

# Configuración de grabación
OUTPUT_DIR="demo-recordings"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="${OUTPUT_DIR}/bookmarkforge_demo_${TIMESTAMP}.mp4"
AUDIO_DEVICE="麦克风 (Realtek High Definition Audio)"  # Ajustar según tu dispositivo
SCREEN_RESOLUTION="1920x1080"
FPS=30
BITRATE="5M"

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Grabación de Demo BookmarkForge ===${NC}"
echo "Directorio de salida: ${OUTPUT_DIR}"
echo "Archivo: ${OUTPUT_FILE}"

# Crear directorio de salida
mkdir -p "${OUTPUT_DIR}"

# Verificar que ffmpeg está instalado
if ! command -v ffmpeg &> /dev/null; then
    echo -e "${RED}Error: FFmpeg no está instalado${NC}"
    echo "Instalar con: winget install Gyan.FFmpeg"
    exit 1
fi

# Listar dispositivos de audio disponibles (Windows)
echo -e "${YELLOW}Dispositivos de audio disponibles:${NC}"
ffmpeg -list_devices true -f dshow -i dummy 2>&1 | grep -A 20 "DirectShow audio devices" || echo "No se pudieron listar dispositivos de audio"

# Verificar que el servidor de desarrollo está corriendo
echo -e "${YELLOW}Verificando servidor de desarrollo...${NC}"
if ! curl -s http://localhost:5173 > /dev/null; then
    echo -e "${YELLOW}Advertencia: El servidor de desarrollo no parece estar corriendo en http://localhost:5173${NC}"
    echo "Iniciarlo con: cd D:\\bookmark7 && npm run dev"
    read -p "¿Continuar de todos modos? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo -e "${GREEN}=== Iniciando grabación ===${NC}"
echo "Presiona Ctrl+C para detener la grabación"
echo ""

# Comando de grabación para Windows con GDIGrab
# Nota: En Windows, usamos gdigrab para captura de pantalla
ffmpeg -y \
    -f gdigrab \
    -framerate ${FPS} \
    -i desktop \
    -f dshow \
    -i audio="${AUDIO_DEVICE}" \
    -c:v libx264 \
    -preset ultrafast \
    -crf 23 \
    -pix_fmt yuv420p \
    -c:a aac \
    -b:a 128k \
    -r ${FPS} \
    -b:v ${BITRATE} \
    "${OUTPUT_FILE}"

echo -e "${GREEN}=== Grabación completada ===${NC}"
echo "Archivo guardado: ${OUTPUT_FILE}"
echo ""

# Mostrar información del archivo
echo -e "${YELLOW}Información del archivo:${NC}"
ffprobe -v quiet -print_format json -show_format -show_streams "${OUTPUT_FILE}" | python -m json.tool 2>/dev/null || echo "No se pudo mostrar información detallada"

echo -e "${GREEN}=== Siguientes pasos ===${NC}"
echo "1. Revisar el video: ${OUTPUT_FILE}"
echo "2. Post-producción: ./demo-postprocess.sh"
echo "3. Subir a plataforma de video"