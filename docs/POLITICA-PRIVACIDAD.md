# Política de Privacidad — BookmarkForge

**Última actualización:** 2026-09-26  
**Version:** 1.0.0  
**Controlador de datos:** [TU NOMBRE / TU EMPRESA]  
**Contacto:** [TU EMAIL]

---

## Resumen

BookmarkForge es una aplicación de conocimiento personal local-first. **Tus datos se almacenan en tu dispositivo, encriptados, y nunca salen de él.** Esta política explica exactamente qué datos recolectamos (muy pocos), cómo los usamos, y tus derechos.

---

## 1. Información que NO recolectamos

BookmarkForge **NO recolecta**:

- ❌ Contenido de tu vault (bookmarks, notas, PDFs)
- ❌ Contraseña maestra o frase de recuperación
- ❌ Datos de navegación o historial de bookmarks
- ❌ Ubicación física
- ❌ Identidad personal (nombre, email, teléfono)
- ❌ Datos bancarios o de pago (los maneja Whop)
- ❌ Dirección IP
- ❌ Ningún dato del vault sin tu consentimiento explícito

---

## 2. Información que recolectamos

### 2.1 Datos locales (tu dispositivo)

Estos datos **permanecen exclusivamente en tu dispositivo**:

| Dato | Propósito | Almacenamiento |
|------|-----------|----------------|
| Bookmarks y notas | Funcionalidad principal | IndexedDB encriptado |
| Claves de cifrado | Seguridad del vault | Web Workers / localStorage (encriptado) |
| Configuración de la app | Preferencias de usuario | IndexedDB |
| Historial de sesiones | UX (deshacer, redo) | IndexedDB |

### 2.2 Datos transmitidos al servidor (voluntarios)

Cuando te conectas al servidor de BookmarkForge:

| Dato | Propósito | Transmisión |
|------|-----------|-------------|
| Device ID (hash) | Verificación de licencia | HTTPS, cifrado TLS |
| Estado de licencia (pro/free) | Activación de funciones | HTTPS |
| IP (hasheada) | Rate limiting, seguridad | Hasheada con SHA-256 |

**Ningún contenido del vault se transmite al servidor.**

### 2.3 Telemetría (OPT-IN, no por defecto)

Si eliges activar la telemetría:

| Dato | Propósito | Retención |
|------|-----------|-----------|
| Tipo de evento (sin contenido) | Análisis de uso agregado | 30 días |
| Conteo DAU/WAU/MAU | Métricas de negocio | Anonimizado |
| Versión de la app | Detección de bugs | Agregado |
| País (basado en IP) | Distribución geográfica | Anonimizado |

**Puedes desactivar la telemetría en cualquier momento en Settings → Privacy → Telemetry.**

---

## 3. Cookies y tecnologías similares

El servidor de BookmarkForge usa cookies estrictamente necesarias:

- **Sesión de autenticación**: para mantener tu sesión activa
- **Rate limiting**: para prevenir abuso
- **CSP report**: para seguridad (sin datos personales)

No usamos cookies de marketing, publicidad, o rastreo de terceros.

---

## 4. Compartir datos con terceros

### 4.1 Whop.com (pagos)

Cuando compras una licencia:
- Whop maneja tu nombre, email, y método de pago
- BookmarkForge recibe solo: tu Order ID y estado de licencia (pro/free)
- Whop es responsable de su propia política de privacidad

### 4.2 Sentry (reporte de errores)

Si el reporte de errores está activado (opt-in):
- Solo se envían errores técnicos, **sin contenido del vault**
- URLs sin query parameters
- Secretos redactados
- IP hasheada
- Requiere tu consentimiento activo

### 4.3 Proveedores de hosting

Si usas el servidor self-hosted:
- El proveedor de hosting (VPS, Docker, etc.) puede tener logs temporales de conexión
- Estos logs **no** contienen contenido del vault
- Los IPs son hasheados en el servidor

### 4.4 Proveedores de IA (BYO key)

- Las llamadas a proveedores de IA se hacen **directamente desde tu navegador**
- Tu API key nunca pasa por nuestros servidores
- El contenido que envías a los proveedores es tu responsabilidad
- BookmarkForge **no** ve ni almacena el contenido de tus prompts

---

## 5. Tus derechos (GDPR/CCPA)

### 5.1 Derecho de acceso

Puedes solicitar qué datos personales tenemos sobre ti:
- Contacto: [TU EMAIL]
- Tiempo de respuesta: <30 días

### 5.2 Derecho de eliminación

- **Datos locales**: Settings → Privacy → Delete All Data (inmediato)
- **Datos de Whop**: Contacta a Whop directamente
- **Logs del servidor**: Los logs de conexión son temporales (7 días)

### 5.3 Derecho de portabilidad

- **Exporta tu vault**: Settings → Export (formato JSON, Markdown, CSV, etc.)
- Tus datos están en formato abierto

### 5.4 Derecho de oposición a la telemetría

- Desactiva en Settings → Privacy → Telemetry (inmediato)
- No hay consecuencias por desactivarla

### 5.5 Retirada del consentimiento

- Puedes retirar cualquier consentimiento dado en cualquier momento
- La retirada no afecta la funcionalidad de la app (solo telemetría y analytics opcionales)

---

## 6. Retención de datos

| Tipo de dato | Retención | Motivo |
|--------------|-----------|--------|
| Vault local | Hasta que lo elimines | Funcionalidad |
| Logs del servidor | 7 días | Seguridad, debugging |
| Telemetría | 30 días | Análisis agregado |
| Backup .bmf | Indefinido (tu responsabilidad) | Recuperación |
| Estado de licencia | Mientras tu licencia sea activa | Verificación |
| IP hasheada | 30 días | Rate limiting |

---

## 7. Seguridad

- **Encriptación**: AES-256-GCM para el vault
- **KDF**: Argon2id (memory-hard, resistente a GPU)
- **TLS**: Todo el tráfico usa HTTPS/WSS
- **CSP**: Estricto, con reportes de violaciones
- **Zero-knowledge**: El servidor no puede ver tu contraseña ni contenido
- **Audit**: Código revisado y probado (460+ tests)

---

## 8. Contacto

**Para cualquier pregunta sobre esta política:**
- Email: [TU EMAIL]
- GitHub Issues: https://github.com/bookmarkforge/bookmarkforge/issues
- Documentación: https://bookmarkforgeapp.com/docs

**Para solicitudes GDPR:**
- Email: [TU EMAIL]
- Respuesta garantizada en <30 días

---

## 9. Cambios a esta política

- Notificaremos cambios significativos por email o in-app
- Puedes revisar la versión actual en cualquier momento
- El historial de cambios está en el repositorio

---

## 10. Responsable del tratamiento

**[TU NOMBRE / TU EMPRESA]**  
**NIF/IVA:** [TU NIF]  
**Dirección:** [TU DIRECCIÓN]  
**Email:** [TU EMAIL]  

Este sitio y aplicación están operados de forma autónoma como proyecto de código abierto.

---

> **Nota**: Este documento es una plantilla. Debes completar los campos marcados con `[TU...]` antes de publicar. Si operas desde la UE, considera consultar con un abogado para completar la ROPA y el registro de actividades de tratamiento.
