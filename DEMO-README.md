# Guía de Grabación de Demostración - BookmarkForge

## 🎯 Objetivo
Crear un video demostrativo profesional de BookmarkForge que muestre sus características principales: vault cifrado local-first, integración IA, sincronización P2P, y características de seguridad.

## 🛠️ Herramientas Instaladas

✅ **OBS Studio** - Software de grabación de pantalla profesional  
✅ **FFmpeg** - Herramienta de procesamiento de video  
✅ **Scripts de automatización** - Para grabación y post-producción

## 📋 Preparación Pre-grabación

### 1. Configurar el Entorno

```bash
# Navegar al directorio del proyecto
cd D:\bookmark7

# Instalar dependencias (si no están instaladas)
npm install

# Build de producción
npm run build:ci
```

### 2. Iniciar el Servidor de Desarrollo

```bash
# En una terminal, iniciar el servidor
npm run preview
```

El servidor estará disponible en `http://localhost:4173`

### 3. Preparar Datos de Prueba

Antes de grabar, asegúrate de tener:
- [ ] Algunos bookmarks de ejemplo
- [ ] Configuración de proveedor IA (opcional)
- [ ] Frase de recuperación de 24 palabras
- [ ] Contraseña de 12+ caracteres

### 4. Configurar Audio

- [ ] Verificar que el micrófono funciona
- [ ] Probar grabación de audio
- [ ] Ajustar niveles de volumen

## 🎬 Proceso de Grabación

### Opción A: Grabación con FFmpeg (Automatizada)

```powershell
# Ejecutar el script de grabación PowerShell
.\demo-recording.ps1
```

**Características:**
- Captura de pantalla completa
- Grabación de audio del micrófono
- Salida en MP4 optimizado
- Control con Ctrl+C para detener

### Opción B: Grabación con OBS Studio (Manual)

1. **Abrir OBS Studio**
   ```bash
   # Desde inicio o terminal
   obs
   ```

2. **Configurar Escena**
   - Agregar "Display Capture" para capturar pantalla
   - Agregar "Audio Input Capture" para micrófono
   - Configurar resolución: 1920x1080
   - Configurar FPS: 30

3. **Configurar Salida**
   - Formato: MP4
   - Video Encoder: x264
   - Rate Control: CBR
   - Bitrate: 5000 kbps
   - Audio Encoder: AAC
   - Audio Bitrate: 128 kbps

4. **Iniciar Grabación**
   - Abrir BookmarkForge en navegador
   - Iniciar grabación en OBS
   - Seguir el guion (demo-script.md)
   - Detener grabación al finalizar

## 📝 Guion de Grabación

Sigue el guion detallado en `demo-script.md`:

1. **Introducción** (0:00 - 0:30)
   - Mostrar landing page
   - Explicar concepto local-first

2. **Creación de Vault** (0:30 - 1:00)
   - Demostrar proceso de creación
   - Mostrar validación de contraseña
   - Presentar frase de recuperación

3. **Interfaz Principal** (1:00 - 1:45)
   - Navegar por dashboard
   - Mostrar organización de contenido
   - Demostrar búsqueda

4. **Agregar Bookmarks** (1:45 - 2:15)
   - Agregar bookmark de ejemplo
   - Mostrar extracción automática
   - Demostrar etiquetado

5. **Integración IA** (2:15 - 2:45)
   - Mostrar configuración de proveedores
   - Demostrar resumen con IA
   - Mostrar IA local (WebLLM)

6. **Sincronización y Backup** (2:45 - 3:15)
   - Demostrar sincronización P2P
   - Crear backup cifrado
   - Mostrar restauración

7. **Seguridad** (3:15 - 3:45)
   - Mostrar configuración de seguridad
   - Demostrar bloqueo de vault
   - Explicar cifrado

8. **Conclusión** (3:45 - 4:00)
   - Resumen de características
   - Call to action

## 🎨 Post-producción

### Procesar el Video Grabado

```powershell
# Ejecutar script de post-producción
.\demo-postprocess.ps1
```

**Este script genera:**
- ✅ Video optimizado para web (720p)
- ✅ Versión para redes sociales (1080x1080)
- ✅ GIF animado de preview
- ✅ Thumbnail para compartir

### Archivos Generados

Los archivos se guardan en `demo-final/`:
- `bookmarkforge_demo_final_[timestamp].mp4` - Video principal
- `bookmarkforge_demo_social_[timestamp].mp4` - Versión social
- `bookmarkforge_demo_preview_[timestamp].gif` - GIF preview
- `bookmarkforge_demo_thumbnail_[timestamp].jpg` - Thumbnail

## 🚀 Distribución

### Plataformas Recomendadas

1. **YouTube**
   - Subir video principal (720p)
   - Usar thumbnail generado
   - Añadir descripción con características

2. **Twitter/X**
   - Usar versión social (1080x1080)
   - Añadir GIF preview en thread
   - Hashtags: #PrivacyFirst #LocalFirst #AI

3. **LinkedIn**
   - Usar video principal
   - Enfocar en aspectos profesionales
   - Destacar seguridad y compliance

4. **GitHub**
   - Añadir GIF al README
   - Enlazar video completo
   - Mostrar capturas de pantalla

### Descripción Sugerida

```
BookmarkForge: Tu vault de conocimiento privado con IA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BookmarkForge es un vault de conocimiento 100% local-first que mantiene 
tus datos seguros en tu dispositivo mientras te da el poder de la IA.

🔒 Características de Seguridad:
• Cifrado AES-256-GCM + Argon2id
• Zero-knowledge architecture
• Tus datos nunca salen de tu dispositivo

🤖 Integración IA:
• Múltiples proveedores (OpenAI, Anthropic, etc.)
• IA local con WebLLM (sin conexión a internet)
• Resúmenes y análisis automáticos

🌐 Sincronización P2P:
• WebRTC peer-to-peer
• Sin servidor central para datos
• Control total de tu información

📦 Open Source:
• Core MIT-licensed
• Auditoría de seguridad continua
• Transparencia total

Prueba BookmarkForge: https://bookmarkforgeapp.com
Código fuente: https://github.com/bookmarkforge/bookmarkforge
```

## 💡 Tips Profesionales

### Durante la Grabación
1. **Movimientos suaves**: Usa el cursor de forma deliberada
2. **Pausas estratégicas**: Pausa 1-2 segundos después de acciones importantes
3. **Voz clara**: Habla a ritmo moderado y articula bien
4. **Evitar distracciones**: Cierra notificaciones y apps innecesarias
5. **Practica primero**: Haz una grabación de prueba antes de la final

### Configuración de Entorno
1. **Fondo limpio**: Usa escritorio organizado
2. **Iluminación**: Buena luz si apareces en cámara
3. **Resolución**: 1920x1080 para calidad HD
4. **Audio**: Micrófono de calidad o headset

### Post-producción
1. **Cortar silencios**: Eliminar pausas innecesarias
2. **Añadir subtítulos**: Para accesibilidad
3. **Música sutil**: Fondo musical no intrusivo
4. **Transiciones**: Cortes limpios entre escenas

## 🔧 Solución de Problemas

### FFmpeg no detecta audio
```powershell
# Listar dispositivos de audio
ffmpeg -list_devices true -f dshow -i dummy

# Ajustar el nombre del dispositivo en demo-recording.ps1
```

### OBS Studio no captura audio
1. Verificar que "Audio Input Capture" está agregado
2. Configurar dispositivo de audio correcto
3. Verificar niveles de audio en mixer

### Calidad de video baja
1. Aumentar bitrate en configuración
2. Usar preset "medium" o "slow" en FFmpeg
3. Verificar que no hay otros procesos consumiendo CPU

### Archivo de video muy grande
1. Ajustar CRF a 28-30 en FFmpeg
2. Reducir resolución a 1280x720
3. Usar compresión más agresiva

## 📚 Recursos Adicionales

- **Guion completo**: `demo-script.md`
- **Scripts de grabación**: `demo-recording.ps1`, `demo-recording.sh`
- **Script de post-producción**: `demo-postprocess.ps1`
- **Documentación del proyecto**: `docs/`
- **Repositorio GitHub**: https://github.com/bookmarkforge/bookmarkforge

## ✅ Checklist Final

Antes de publicar:
- [ ] Video revisado completamente
- [ ] Audio claro y audible
- [ ] Sin errores técnicos visibles
- [ ] Descripción completa y atractiva
- [ ] Thumbnail profesional
- [ ] Enlaces funcionales
- [ ] Hashtags relevantes
- [ ] Prueba en diferentes plataformas

---

**¡Buena suerte con tu demostración de BookmarkForge!** 🎬