# Guion de Demostración - BookmarkForge

## Objetivo
Demostrar las capacidades principales de BookmarkForge como vault de conocimiento local-first con cifrado robusto y características de IA.

## Duración estimada: 3-5 minutos

---

## ESCENA 1: Introducción (0:00 - 0:30)

**Visual:** Pantalla de inicio de BookmarkForge con logotipo
**Audio:** "Hola, soy [Tu Nombre] y hoy voy a mostrarte BookmarkForge, un vault de conocimiento privado con IA que mantiene tus datos seguros en tu dispositivo."

**Acciones:**
- Mostrar la landing page o aplicación abierta
- Resaltar la frase "100% Local-First" y "Privacy-Preserving"

---

## ESCENA 2: Creación de Vault (0:30 - 1:00)

**Visual:** Pantalla de creación de vault
**Audio:** "Empecemos creando un vault cifrado. BookmarkForge usa Argon2id y AES-256-GCM para proteger tus datos con una contraseña maestra."

**Acciones:**
- Mostrar la pantalla de "Create Vault"
- Ingresar una contraseña de 12+ caracteres
- Mostrar la validación de contraseña
- Completar la creación del vault
- Mostrar la frase de recuperación de 24 palabras

**Puntos clave:**
- Requisito de contraseña de 12 caracteres mínimo
- Frase de recuperación de 24 palabras para backup
- Cifrado AES-256-GCM + Argon2id

---

## ESCENA 3: Interfaz Principal y Features (1:00 - 1:45)

**Visual:** Dashboard principal de BookmarkForge
**Audio:** "Una vez desbloqueado, tienes acceso a tu vault personal. Puedes guardar bookmarks, notas, y usar IA para procesar tu conocimiento."

**Acciones:**
- Mostrar el dashboard con navegación lateral
- Navegar por las secciones: Bookmarks, Notes, AI
- Mostrar la búsqueda integrada
- Resaltar la organización por etiquetas y colecciones

**Puntos clave:**
- Interfaz intuitiva tipo dashboard
- Búsqueda potente
- Organización flexible
- Todo cifrado localmente

---

## ESCENA 4: Agregar Bookmarks (1:45 - 2:15)

**Visual:** Pantalla de agregar bookmark
**Audio:** "Agreguemos un bookmark. Puedes guardarlo directamente desde tu navegador y el sistema extraerá automáticamente el contenido."

**Acciones:**
- Click en "Add Bookmark"
- Ingresar URL de ejemplo
- Mostrar extracción automática de título y contenido
- Agregar etiquetas
- Guardar y mostrar en la lista

**Puntos clave:**
- Extracción automática de contenido
- Etiquetas y categorización
- Búsqueda全文 en el contenido

---

## ESCENA 5: Integración IA (2:15 - 2:45)

**Visual:** Pantalla de configuración IA y resumen
**Audio:** "BookmarkForge se integra con múltiples proveedores de IA para resumir, analizar y conectar tus conocimientos. Las claves de API se almacenan cifradas en tu vault."

**Acciones:**
- Mostrar configuración de proveedores IA (OpenAI, Anthropic, etc.)
- Mostrar opción de IA local (WebLLM)
- Demostrar resumen de un bookmark
- Mostrar generación de notas con IA

**Puntos clave:**
- Múltiples proveedores de IA
- Opción de IA local (sin envío de datos)
- Claves cifradas en el vault
- Resúmenes y análisis automáticos

---

## ESCENA 6: Sincronización y Backup (2:45 - 3:15)

**Visual:** Pantalla de sincronización y backup
**Audio:** "Para la sincronización entre dispositivos, BookmarkForge usa WebRTC peer-to-peer. Tus datos nunca pasan por un servidor central. También puedes crear backups cifrados."

**Acciones:**
- Mostrar opciones de sincronización P2P
- Demostrar generación de backup .bmf
- Mostrar restauración desde backup
- Resaltar que el backup está cifrado

**Puntos clave:**
- Sincronización P2P con WebRTC
- Backups cifrados .bmf
- Sin servidor central para datos
- Control total de tus datos

---

## ESCENA 7: Seguridad y Privacidad (3:15 - 3:45)

**Visual:** Pantalla de configuración de seguridad
**Audio:** "La seguridad es fundamental. Cifrado end-to-end, zero-knowledge, y todas las operaciones de IA se ejecutan localmente o con tus propias claves."

**Acciones:**
- Mostrar configuración de seguridad
- Demostrar bloqueo de vault
- Mostrar política de privacidad
- Resaltar características de seguridad

**Puntos clave:**
- Cifrado AES-256-GCM + Argon2id
- Zero-knowledge
- Auditoría de seguridad continua
- Código abierto (Core MIT)

---

## ESCENA 8: Conclusión (3:45 - 4:00)

**Visual:** Pantalla final con logo y CTA
**Audio:** "BookmarkForge: tu conocimiento privado, potenciado por IA, 100% bajo tu control. ¡Pruébalo hoy!"

**Acciones:**
- Mostrar pantalla final
- Mostrar enlaces de descarga
- Mostrar repositorio GitHub
- Call to action final

---

## Notas de Producción

### Configuración Técnica
- **Resolución:** 1920x1080 (1080p)
- **FPS:** 30
- **Formato:** MP4 (H.264)
- **Audio:** AAC, 128kbps, 44.1kHz

### Tips de Grabación
1. Usar cursor visible y movimientos fluidos
2. Pausar brevemente después de cada acción importante
3. Hablar claro y a ritmo moderado
4. Evitar multitarea durante la grabación
5. Usar fondo limpio y organizado

### Post-producción
- Añadir subtítulos para accesibilidad
- Incluir música de fondo sutil
- Añadir transiciones suaves entre escenas
- Optimizar para web (compresión moderada)

### Archivos Relacionados
- `demo-script.md` - Este guion
- `demo-recording.sh` - Script de grabación FFmpeg
- `demo-postprocess.sh` - Script de post-producción
- `D:\bookmark7\dist\` - Build de producción para demo

---

## Checklist Pre-grabación
- [ ] Build de producción listo (`npm run build:ci`)
- [ ] Servidor local corriendo (`npm run preview`)
- [ ] Datos de prueba preparados
- [ ] Credenciales IA configuradas (opcional)
- [ ] Dispositivo de audio preparado
- [ ] Espacio en disco suficiente (500MB+)
- [ ] Ambiente de grabación silencioso