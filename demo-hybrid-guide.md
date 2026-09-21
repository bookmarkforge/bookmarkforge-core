# Guía de Demo Híbrida - Playwright + OBS Manual

## 🎯 Estrategia Robusta

Dado los problemas técnicos con FFmpeg en Windows, la solución más confiable es:

1. **Playwright** ejecuta la automatización humana (behaviors realistas)
2. **OBS Studio** graba la pantalla manualmente (más confiable)
3. **Sincronización**: Comenzar OBS → Ejecutar Playwright → Detener ambos

## 📋 PASO A PASO

### PREPARACIÓN

#### 1. Configurar OBS Studio
```bash
# Abrir OBS Studio
obs
```

**Configuración:**
- **Fuente**: Display Capture (pantalla completa)
- **Resolución**: 1920x1080 @ 30fps
- **Salida**: MP4, bitrate 5000kbps
- **Audio**: Micrófono (opcional)

#### 2. Verificar Servidor
```bash
cd D:\bookmark7
npm run preview
```

El servidor estará en http://localhost:4173

### EJECUCIÓN DE LA DEMO

#### Paso 1: Iniciar OBS
1. Abrir OBS Studio
2. Configurar Display Capture
3. Iniciar grabación (🔴 botón)
4. Esperar 2-3 segundos para estabilización

#### Paso 2: Ejecutar Automatización
```bash
cd D:\bookmark7
npx playwright test tests/e2e/demo-automation.spec.ts --config=playwright.config.ts --headed
```

#### Paso 3: Observar la Demo
El script de Playwright ejecutará automáticamente:
- ✅ Navegación por la aplicación
- ✅ Scrolls suaves y naturales
- ✅ Interacciones con elementos
- ✅ Delays realistas entre acciones
- ✅ 8 escenas completas en ~40 segundos

#### Paso 4: Detener Grabación
1. Cuando Playwright termine (≈40s)
2. Detener grabación en OBS (⏹️ botón)
3. El video se guardará en OBS

### POST-PRODUCCIÓN

#### Usar Video de OBS
1. Localizar el video grabado en OBS
2. Moverlo a `demo-recordings/`
3. Ejecutar post-producción:

```powershell
cd D:\bookmark7
.\demo-postprocess.ps1
```

## 🎭 COMPORTAMIENTO HUMANO DEL SCRIPT

El script `tests/e2e/demo-automation.spec.ts` simula:

### Delays Naturales
- **Mouse move**: 100-300ms entre movimientos
- **Typing**: 50-150ms por carácter
- **Scroll**: 500-1000ms para scroll suave
- **Page load**: 2-4 segundos para cargar
- **Scene transitions**: 1-2 segundos

### Acciones Realistas
- ✅ Scrolls graduales (no instantáneos)
- ✅ Typing caracter por caracter
- ✅ Navegación fluida entre secciones
- ✅ Interacción con elementos visibles
- ✅ Manejo de errores (elementos no encontrados)

### Escenas Automatizadas
1. **Introducción** - Landing page con scroll
2. **Navegación** - Búsqueda de secciones principales
3. **Demo visual** - Scroll y contenido
4. **Interacción** - Búsqueda y botones
5. **Conclusión** - Vuelta a home + scroll final

## 🎨 BENEFICIOS DE ESTE ENFOQUE

### ✅ Ventajas
- **Calidad garantizada**: OBS es más confiable que FFmpeg
- **Control total**: Puedes detener/pausar manualmente
- **Audio fácil**: Configurar micrófono en OBS
- **Correcciones en tiempo**: Si algo sale mal, puedes ajustar
- **Sin corrupción de archivos**: OBS maneja esto mejor

### 🔄 Comparación con FFmpeg Automatizado
| Aspecto | FFmpeg Automatizado | OBS + Playwright |
|---------|-------------------|------------------|
| Confiabilidad | ⚠️ Problemas de corrupción | ✅ Alta |
| Calidad | ✅ Buena | ✅ Excelente |
| Audio | ❌ Complejo | ✅ Fácil |
| Control | ❌ Automático | ✅ Manual |
| Tiempo de setup | ✅ Un comando | ⚠️ Manual |

## 🚀 EJECUCIÓN RÁPIDA

### Comando Único (Playwright)
```bash
cd D:\bookmark7
npx playwright test tests/e2e/demo-automation.spec.ts --config=playwright.config.ts --headed
```

### Manual (OBS)
1. Abrir OBS
2. Configurar Display Capture
3. Iniciar grabación
4. Ejecutar comando Playwright
5. Detener grabación

## 📁 ARCHIVOS GENERADOS

### Automatización
- `tests/e2e/demo-automation.spec.ts` - Script de Playwright
- `test-results/` - Screenshots y videos de Playwright

### Grabación
- OBS: Carpeta configurada en OBS Settings
- Video crudo: Alta calidad, sin procesar
- Post-producido: Optimizado para web

## 💡 TIPS PROFESIONALES

### Durante la Grabación
1. **Minimizar distracciones**: Cerrar otras apps
2. **Fondo limpio**: Escritorio organizado
3. **Resolución correcta**: 1920x1080
4. **Audio claro**: Si usas micrófono, prueba primero

### Si Playwright Falla
1. **Revisar logs**: `test-results/` carpeta
2. **Verificar servidor**: http://localhost:4173
3. **Reintentar**: A veces elementos tardan en cargar
4. **Manual fallback**: Ejecuta acciones manualmente mientras OBS graba

### Post-producción
1. **Cortar silencios**: Inicio y final
2. **Añadir música**: Fondo sutil opcional
3. **Subtítulos**: Para accesibilidad
4. **Thumbnail**: Frame clave del video

## ✅ CHECKLIST FINAL

Antes de publicar:
- [ ] Video revisado completamente
- [ ] Duración apropiada (1-3 minutos ideal)
- [ ] Calidad HD visible
- [ ] Audio claro (si aplica)
- [ ] Sin errores técnicos visibles
- [ ] Descripción completa
- [ ] Thumbnail profesional
- [ ] Plataformas seleccionadas

---

**Esta combinación de Playwright (automatización humana) + OBS (grabación confiable) es la solución más robusta y profesional para crear demos de BookmarkForge.**