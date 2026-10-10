# Manual de Usuario — BookmarkForge v1

**Versión:** 1.0.0 · **Última actualización:** Septiembre 2026 · **Licencia:** MIT

---

## 1. Introducción

BookmarkForge es una aplicación de conocimiento personal **local-first** que te permite guardar marcadores, tomar notas, organizar tu conocimiento con grafos interactivos, usar IA directamente en tu navegador, y sincronizar entre dispositivos sin depender de servidores centrales.

**Lo que hace único a BookmarkForge:**

- **Tus datos viven en tu navegador** (IndexedDB/RxDB). Nadie tiene acceso a tu información.
- **Cifrado extremo a extremo** con AES-GCM y Argon2id. Ni siquiera los desarrolladores pueden leer tu vault.
- **IA local** que funciona sin conexión y sin enviar tus datos a terceros.
- **Sincronización P2P** entre tus dispositivos sin servidores centrales.
- **Sin suscripción.** Pagas una vez y es tuyo para siempre.

---

## 2. Primeros pasos

### 2.1 Requisitos

- Navegador moderno: Chrome, Edge, Firefox, Safari (16+)
- 8 GB de RAM recomendados
- GPU básica para IA local (WebGPU)
- Conexión a internet (para la instalación inicial y la sincronización; opcional para uso offline)

### 2.2 Instalación

1. Abre [bookmarkforgeapp.com](https://bookmarkforgeapp.com)
2. Haz clic en **"Install App"** o **"Add to Home Screen"**
3. La app se instala como PWA (Progressive Web App)
4. También puedes usarla como extensión de navegador

### 2.3 Configuración inicial

1. **Contraseña maestra:** Mínimo 12 caracteres. Se recomienda una frase de contraseña.
   - Deriva tu clave AES-GCM con Argon2id (KDF obligatorio desde ADR-019)
   - **Tu contraseña es la ÚNICA clave.** Si la pierdes, no hay recuperación.
2. **Frase de recuperación:** Guarda las 24 palabras en un lugar seguro.
3. **Device ID:** Se genera automáticamente. Se usa para activar licencias Pro.

### 2.4 El bookmarklet

Arrastra el botón **"Guardar en Forge"** a la barra de marcadores de tu navegador. Cada vez que estés en una página web, haz clic en él para guardarla como marcador.

---

## 3. Funciones principales

### 3.1 Marcadores

- **Lista virtualizada** que maneja 100,000+ elementos sin retraso
- **Búsqueda Profunda:** busca en el texto completo de páginas guardadas
- **Colecciones Inteligentes:** se auto-organizan por etiqueta
- **Importar/Exportar:** desde Notion, Evernote, Chrome, o exportar como .bmf, Markdown, PDF
- **Límite Free:** 2,500 marcadores. **Pro:** Ilimitados

### 3.2 Editor de notas

Editor basado en bloques con:
- Comandos `/` para insertar bloques rápidamente
- Arrastrar y soltar
- LaTeX para matemáticas
- Diagramas Mermaid para gráficos
- Resaltado de código para 50+ lenguajes
- **AI Copilot** para ayuda en tiempo real

### 3.3 Grafo de conocimiento

Visualización interactiva 3D/2D de tus notas:
- Filtra por etiqueta, fecha, o "Fuerza de Conexión"
- Visualiza similitudes semánticas entre notas no relacionadas
- Explora cómo tus ideas se conectan a lo largo del tiempo

### 3.4 Flashcards

- Algoritmo modificado tipo Anki de **Repetición Espaciada (SRK)**
- Rastrea tu "curva de olvido" para mostrar tarjetas en el momento perfecto
- Soporta oclusión de imágenes y eliminación de texto
- **Solo disponible en Pro**

### 3.5 Comandos de voz

Motor de Voz a Acción:
- Dile "Oye BMF, encuentra mis notas de Biología"
- Dile "Guarda esta página"
- Funciona 100% sin conexión mediante la Web Speech API

### 3.6 Omnibar (Ctrl+K)

El cerebro de la aplicación:
- Matemáticas, conversión de unidades
- Búsqueda de marcadores y notas simultáneamente
- Escribe `>` para comandos del sistema

---

## 4. IA en BookmarkForge

### 4.1 IA con tu propia API key (Free)

- Usa Gemini, OpenAI, Anthropic, o cualquier proveedor compatible
- Pagas el coste de tokens directamente a tu proveedor
- La app enruta dinámicamente las solicitudes al modelo óptimo
- **Caché Semántico Local:** si haces preguntas similares, usa 0 tokens de API

### 4.2 IA Local — WebLLM/Ollama (Pro)

- Ejecuta modelos completos de IA (como Llama 3.2, Qwen 2.5) directamente en tu navegador
- Usa tu tarjeta gráfica (WebGPU)
- **Sin conexión a internet** necesaria para funcionar
- Cuantización de 4 bits (q4f16) para ejecutar en hardware modesto
- **Sin coste de tokens** ni envío de datos a terceros

### 4.3 RAG chat sobre tus datos (Pro)

- La IA "lee" tus notas locales antes de responder
- Te responde basándose en tu conocimiento específico
- Arquitectura híbrida con caché semántico local
- Si haces preguntas similares, la app usa 0 tokens y 0 llamadas API

### 4.4 Expert agents (Pro)

- Agentes especializados en diferentes dominios
- Automatizan tareas complejas de análisis

---

## 5. Sincronización P2P

### 5.1 Requisitos

- Ambos dispositivos en la misma red Wi-Fi
- Firewall debe permitir WebRTC
- IDs de sincronización coincidentes

### 5.2 Configuración

1. Ve a **Configuración > Sincronización**
2. Activa "Habilitar sincronización P2P"
3. Asegúrate de que ambos dispositivos estén en la misma red
4. Confirma los IDs de sincronización coinciden

### 5.3 Solución de problemas

| Problema | Solución |
|---|---|
| Sync fallando | Verifica que ambos dispositivos estén en la misma red Wi-Fi |
| Firewall bloqueando WebRTC | Configura el Firewall para permitir WebRTC |
| IDs de sincronización no coinciden | Reinicia la Sala de Sincronización |
| Conexión lenta | Verifica la latencia de la red |

---

## 6. Seguridad y privacidad

### 6.1 Cifrado

- **AES-GCM** con claves derivadas por **Argon2id** (versión 4)
- Las claves nunca se almacenan en texto plano
- Se derivan sobre la marcha y solo existen en memoria (RAM)
- Usa la API SubtleCrypto nativa del navegador

### 6.2 Contraseña maestra

- Mínimo 12 caracteres
- No existe "Olvidé mi contraseña"
- Tu contraseña es la ÚNICA clave
- Si la pierdes, **no podemos ayudarte**
- Siempre guarda una copia de seguridad .bmf en un lugar seguro

### 6.3 Recuperación

- Exporta tu vault como archivo `.bmf` en cualquier momento
- Formato: JSON cifrado con tu clave maestra
- Guárdalo en un lugar seguro (USB, disco externo, nube cifrada)

### 6.4 Política de privacidad

- **Zero-knowledge:** los desarrolladores tienen conocimiento cero de tus claves o datos
- Sin Google Analytics, sin telemetría, sin píxeles de rastreo
- Sin servidores centrales guardando tus datos
- RGPD por diseño
- El servidor de licencias valida tu licencia sin acceder a tu vault

### 6.5 Validación de licencias

- La licencia Pro se valida localmente después de un handshake inicial
- Sin rastreo constante
- Prueba de licencia firmada con RSA-PSS (SHA-256, salt 32)
- Re-validación cada 48 horas cuando hay conexión
- Pruebas antiguas (>30 días) son rechazadas por el servidor de entitlement

---

## 7. Versiones Free vs Pro

### 7.1 Tabla comparativa

| Feature | Free | Pro |
|---|---|---|
| Precio | $0 | $79 (lifetime) |
| Marcadores | 2,500 | Ilimitados |
| Dispositivos | Ilimitados | 5 + P2P sync |
| IA con API propia | ✅ | ✅ |
| IA Local (WebLLM/Ollama) | ❌ | ✅ |
| RAG chat sobre tus datos | ❌ | ✅ |
| Flashcards + PDF/OCR | ❌ | ✅ |
| Exportación avanzada (10+ formatos) | ❌ | ✅ |
| Cofre de seguridad (AES-GCM) | ✅ | ✅ |
| Soporte | Comunidad | Email 48h |
| Descubrimiento v2/v3 | ❌ | 60% off |



### 7.2 Cómo actualizar a Pro

1. Ve a **Configuración > Suscripción**
2. Haz clic en **"Get Pro Lifetime"**
3. Serás redirigido a Whop para el pago
4. Después de la compra, la app se activa automáticamente
5. La licencia se valida con el servidor y se firma localmente

**Early Bird:** los primeros 200 compradores pagan $59 (agotado o hasta 2026-12-31). Después el precio regular es $79.



### 7.4 Actualizaciones futuras (v2, v3)

- Los dueños de v1 pagan un **60% de descuento** en versiones mayores futuras
- v2 para nuevos: $89. v2 para v1 owners: $35
- v3 para nuevos: $99. v3 para v1 owners: $39
- Los dueños de v1 **mantienen v1 funcional para siempre**

---

## 8. Importar y exportar

### 8.1 Importar

Ve a **Configuración > Importar**:
- **HTML/JSON desde Notion o Evernote**
- **Exportación de marcadores de Chrome**
- **Copia de seguridad .bmf**

### 8.2 Exportar

- **.bmf:** Backup completo cifrado
- **Markdown:** Notas en formato legible
- **PDF:** Exporta notas como documentos PDF
- **JSON:** Datos estructurados

### 8.3 Backup y restauración

- Exporta regularmente tu vault como .bmf
- Guárdalo en un lugar seguro
- Para restaurar: ve a **Configuración > Restaurar** y selecciona tu archivo .bmf
- La restauración requiere tu contraseña maestra

---

## 9. Solución de problemas

### 9.1 App no carga

1. Limpia la caché del navegador
2. Actualiza Chrome/Edge a la última versión
3. Verifica si tu disco está lleno
4. Desactiva extensiones conflictivas (los bloqueadores de anuncios a veces bloquean IndexedDB)

### 9.2 Sincronización fallando

1. Asegúrate de que ambos dispositivos estén en la misma red Wi-Fi
2. Verifica que el Firewall no esté bloqueando WebRTC
3. Confirma que los IDs de sincronización coincidan
4. Reinicia la Sala de Sincronización si es necesario

### 9.3 IA alucina o responde incorrectamente

1. La IA puede equivocarse — usa los enlaces de "Fuentes" en el Chat para verificar
2. Ajusta la "Temperatura" en Configuración de IA
3. Si usas IA local, verifica que el modelo esté cargado correctamente

### 9.4 Extensiones no guardan

1. Actualiza la página que intentas guardar
2. Asegúrate de haber iniciado sesión en BookmarkForge en otra pestaña
3. Reinstala el bookmarklet

### 9.5 Rendimiento lento

1. Ve a Configuración > Avanzado y ejecuta "Optimización de Base de Datos"
2. Revisa Diagnóstico del Sistema para uso de CPU
3. La virtualización maneja listas grandes, pero notas pesadas pueden afectar la RAM

### 9.6 Base de datos corrupta

1. Usa "Diagnóstico del Sistema" para verificar la integridad
2. Si está corrupta, restaura desde tu última copia de seguridad .bmf

### 9.7 Licencia Pro no funciona

1. Verifica que tu conexión a internet funcione (se requiere validación periódica)
2. Intenta re-validar en **Configuración > Licencia > Re-validar**
3. Si el problema persiste, contacta a **bookmarkforge@proton.me**
4. Una licencia reembolsable en 30 días vía Whop

### 9.8 Error de licencia: SIGNING_KEY_INVALID

Este error indica que el servidor no está configurado correctamente. No es un problema del usuario. Contacta al soporte.

---

## 10. Configuración avanzada

### 10.1 Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `VITE_WHOP_CHECKOUT_URL` | URL de checkout de Whop para Pro | `https://whop.com/checkout/<your-product-id>` |
| `VITE_APP_VERSION` | Versión de la app | `1.0.0` |
| `VITE_DB_NAME` | Nombre de la base de datos IndexedDB | `bookmarkforge_v5` |
| `VITE_SENTRY_DSN` | DSN de Sentry para error reporting | *(opcional)* |

### 10.2 Self-hosting

BookmarkForge se puede auto-hospedar:
- **Servidor de señalización:** Node.js + WebSocket (puerto 8787)
- **IA cloud BYOK:** llamadas navegador → proveedor con la clave del usuario
- **Servidor de licencias:** Node.js con Whop adapter
- **Docker Compose:** disponible para producción
- Ver `docker-compose.prod.yml` para la topología completa

### 10.3 API del servidor

Endpoints principales:
- `GET /health` — Liveness probe
- `POST /api/license/activate` — Activa licencia con Whop
- `POST /api/license/validate` — Revalida licencia existente
- `POST /api/license/deactivate` — Libera slot de activación
- `POST /api/license/entitlement` — Verifica si usuario es Pro/Free
- Las funciones de IA cloud llaman directamente al proveedor desde el navegador
  con la clave del usuario.
- `POST /api/analytics/events` — Analytics opt-in
- `GET /api/analytics/kpis` — KPIs de analytics (admin token)

---

## 11. FAQ

**¿Es gratis?**
La aplicación principal es local-first y gratuita. Las funciones avanzadas de IA y sincronización P2P requieren una Licencia Pro.

**¿Puedo usarlo en el móvil?**
Sí. Instálalo como PWA mediante Chrome (Android) o Safari (iOS). Soporta acceso sin conexión y notificaciones push.

**¿Dónde están mis archivos?**
Dentro del almacenamiento interno del navegador (IndexedDB). Puedes exportarlos como .bmf, Markdown o PDF en cualquier momento.

**¿Funciona sin internet?**
100%. Todas las funciones (Editor, Marcadores, Grafo, IA Local, Búsqueda) funcionan sin conexión a internet.

**¿Consume muchos tokens de API?**
No. La app usa un algoritmo de Caché Semántico Local. Si haces variaciones de la misma pregunta, usa 0 tokens de API.

**¿Consumo de batería?**
IA local usa WebGPU. En laptops, puede consumir batería más rápido. Desactiva IA local en configuración para conservar batería.

---

## 12. Soporte

| Tier | Canal | Tiempo de respuesta |
|---|---|---|
| **Free** | Comunidad — Docs + /help + GitHub Discussions | Best effort |
| **Pro** | Email — bookmarkforge@proton.me | 48h (días laborables) |

**Nota de seguridad:** Vault está cifrado. No podemos ver tus datos. Contraseña perdida = datos perdidos. Soporte nunca te pedirá tu contraseña o frase de recuperación.

---

## 13. Legal

- **Licencia del código:** MIT
- **Marca:** BookmarkForge y sus marcas están protegidas (ver `TRADEMARKS.md`)
- **Precios:** Congelados en `docs/pricing-decision.md`. Todos los precios son lifetime versión 1.
- **Reembolsos:** 30 días vía Whop. Política de devolución completa.
- **Privacidad:** Ver `docs/ROPA.md` para el registro de tratamiento de datos personales bajo GDPR.

---

*Última actualización de este manual: Septiembre 2026 · Versión 1.0.0*