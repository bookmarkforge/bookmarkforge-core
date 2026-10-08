# Política de Privacidad — Extensión BookmarkForge

**Aplica a:** BookmarkForge Chrome Extension y Firefox Add-on  
**Última actualización:** 2026-09-26  
**Versión:** 1.0.0

---

## Resumen

La extensión BookmarkForge es una herramienta que guarda páginas web en tu vault de BookmarkForge. **La extensión NO recolecta, almacena ni transmite ningún dato personal.** Los datos que maneja permanecen exclusivamente en tu dispositivo.

---

## Datos que la extensión accede

### Permisos solicitados y su propósito real

| Permiso | ¿Qué hace | ¿Qué datos recolecta? |
|---------|-----------|----------------------|
| `activeTab` | Lee la pestaña activa cuando guardas | **Nada** — solo la URL y título actual en el momento de guardar |
| `contextMenus` | Añade "Save to BookmarkForge" al menú contextual | **Nada** — solo activa la función de captura |
| `storage` | Guarda tu configuración (URL base de BookmarkForge) | Solo tu URL base configurada (ej: `https://bookmarkforgeapp.com`) |

### Lo que la extensión **NO** hace:

- ❌ No lee el contenido de la página (solo URL y título)
- ❌ No rastrea tu historial de navegación
- ❌ No envía datos a terceros
- ❌ No accede a cookies de otros sitios
- ❌ No recolecta tu IP o ubicación
- ❌ No instala software adicional
- ❌ No muestra publicidad
- ❌ No comparte datos con anunciantes

---

## Datos transmitidos a BookmarkForge

Cuando guardas una página, la extensión abre una nueva pestaña con una URL que contiene:

```
https://bookmarkforgeapp.com/capture#url=TAB_URL&title=TAB_TITLE
```

**Importante**: 
- La URL y título se pasan mediante **fragmento hash** (`#`)
- El fragmento hash **NUNCA** se envía al servidor
- **NUNCA** aparece en logs de servidor, logs de CDN, historial de referrers, ni historial de navegación
- Solo la app cliente de BookmarkForge lee el fragmento hash

---

## Almacenamiento

La extensión utiliza `chrome.storage.sync` para:
- Guardar la URL base de tu instancia de BookmarkForge (por defecto: `https://bookmarkforgeapp.com`)
- Almacenar la configuración de la URL personalizada

**Este almacenamiento está limitado a 100KB por extensión** y sincroniza con tu cuenta de Chrome/Firefox si tienes sync activado.

**No almacena:**
- Contraseñas
- Frases de recuperación
- Contenido de bookmarks
- Datos personales

---

## Servidor de BookmarkForge

La extensión se comunica con el servidor de BookmarkForge para:
- Verificar si la URL base es válida
- Redirigir a la app de captura

El servidor solo recibe la URL de la pestaña activa (por el fragmento hash, que no sale del navegador).

---

## Cookies y rastreo

**La extensión NO usa cookies, pixels, localStorage externo, ni ninguna tecnología de rastreo.**

---

## Terceros

| Tercero | Relación | Datos compartidos |
|---------|----------|-------------------|
| Whop.com | Pagos y licencias | Solo el proveedor de pagos maneja tus datos financieros |
| Chrome/Firefox Store | Distribución | La tienda puede recibir datos de instalación (anonimizados) |
| BookmarkForge server | Verificación de URL | Solo la URL base de tu configuración |

---

## Retención

- La configuración de la extensión persiste hasta que la desinstales
- No hay datos de la extensión en los servidores de BookmarkForge
- Si desinstalas, toda la configuración local se elimina

---

## Tus derechos

1. **Acceso**: Puedes ver la configuración de la extensión en `chrome://extensions` → Detalles
2. **Eliminación**: Desinstalar la extensión elimina todos sus datos locales
3. **Oposición**: No hay datos para oponerte — la extensión no recolecta datos personales

---

## Cambios

Cualquier cambio a los permisos o prácticas de la extensión será notificado:
- En la descripción de la tienda
- En el changelog de la extensión
- En la documentación de BookmarkForge

---

## Contacto

- Email: [TU EMAIL]
- GitHub: https://github.com/bookmarkforge/bookmarkforge/issues
- Documentación: https://bookmarkforgeapp.com/docs

---

> **Este documento es una plantilla.** Debes completar los campos marcados con `[TU...]` antes de publicar en las tiendas de extensiones.

> **Para Chrome Web Store:** El formulario de privacidad requiere que indiques cada permiso y justifiques su uso. Las respuestas de esta política sirven como base para ese formulario.

> **Para Firefox AMO:** Mozilla requiere una explicación detallada de cada permiso y cómo se usan los datos recolectados. Este documento cubre ese requisito.
