# Checklist de Publicación — Chrome Web Store + Firefox AMO

> Completa TODOS los puntos antes de subir la extensión.
> Los puntos marcados con 🔴 son obligatorios para que la tienda apruebe.

---

## 🔴 PRE-REQUISITOS (antes de subir)

### Cuenta de desarrollador

- [ ] **Chrome Web Store Developer Account**: Paga la cuota única $50
  - URL: https://chrome.google.com/webstore/developer/dashboard
  - Requiere cuenta Google verificada
  - **Pago con tarjeta de crédito/débito**

- [ ] **Firefox Add-ons Developer Account**: Cuenta con Mozilla
  - URL: https://addons.mozilla.org/en-US/developers/register
  - Requiere cuenta Firefox
  - Opcional: cuenta premium para subir tu propio addon

### Documentación requerida

- [ ] **Política de privacidad** publicada en un sitio web accesible
  - URL de la política: https://bookmarkforgeapp.com/privacy o similar
  - Debe estar en inglés (para ambas tiendas)
  - Debe cubrir los permisos de la extensión
  - ✅ Usa `docs/PRIVACY-EXTENSION.md` como base

- [ ] **Política de privacidad en la tienda**
  - Chrome: URL de política de privacidad en el formulario
  - Firefox: URL de política de privacidad en el formulario

- [ ] **Términos de servicio** (recomendado)
  - Mínimo para Chrome Web Store
  - Cubre: uso, responsabilidad, limitación de garantía

---

## 🔴 ASPECTOS DE LA EXTENSIÓN

### Manifest y permisos

- [ ] **Manifest V3** para Chrome (ya está en `extension/manifest.json`)
- [ ] **Manifest V2** para Firefox (ya está en `extension/manifest-firefox.json`)
- [ ] **Permisos justificados** — cada permiso documentado
  - `activeTab`: Necesario para leer la pestaña activa al guardar
  - `contextMenus`: Necesario para el menú contextual "Save to BookmarkForge"
  - `storage`: Necesario para guardar la URL base de BookmarkForge
  - `script-src 'self'`: CSP correcto implementado

- [ ] **CSP correcto** en ambos manifiestos
  - `script-src 'self'` ✅
  - `object-src 'none'` ✅
  - `connect-src 'self'` ✅
  - `frame-src 'none'` ✅
  - `base-uri 'none'` ✅
  - `form-action 'none'` ✅

- [ ] **Iconos** de todos los tamaños
  - 16x16, 48x48, 128x128 PNG
  - Verificar calidad visual
  - ✅ `icon-16.png`, `icon-48.png`, `icon-128.png`

### Descripción de la tienda

- [ ] **Nombre de la extensión**
  - Chrome: "BookmarkForge — Save to Bookmarks"
  - Firefox: "BookmarkForge — Save to Bookmarks"

- [ ] **Descripción corta** (máx 132 caracteres para Chrome)
  > Save any page to your encrypted BookmarkForge vault. Local-first, private, AI-powered.

- [ ] **Descripción larga** (para la tienda)
  > Save any webpage to your BookmarkForge vault with one click. Your bookmarks stay encrypted on your device — we can't read them. Works offline, syncs peer-to-peer with Pro.
  >
  > Features:
  > - 🔒 Encrypted local-first storage
  > - 🌐 Works offline
  > - 📱 Installable PWA
  > - 🔄 Pro sync across devices
  > - 🤖 AI-powered search included free
  >
  > No tracking. No cloud. Your data, your rules.

- [ ] **Capturas de pantalla** (mínimo 3-4 para Chrome)
  - Captura 1: Menú contextual → "Save to BookmarkForge"
  - Captura 2: La extensión funcionando con el vault abierto
  - Captura 3: Panel de configuración de la extensión
  - Captura 4: App PWA instalada en dispositivo móvil

- [ ] **Video demo** (opcional pero recomendado)
  - Máximo 30 segundos
  - Muestra el flujo: click → guardar → vault

### Categoría y etiquetas

- [ ] **Categoría**: Productividad / Herramientas
- [ ] **Etiquetas**: bookmark, productivity, privacy, ai, notes

---

## 🔴 ASPECTOS LEGALES Y COMPLIANCE

### Políticas

- [ ] **Política de privacidad** — URL funcional y publicada
  - ✅ `docs/PRIVACY-EXTENSION.md` lista
  - ✅ Debe estar publicada en un sitio web real
  - ✅ Inglés para ambas tiendas

- [ ] **Términos de servicio**
  - Cobertura: uso de la app, responsabilidad, limitación de garantías

### Respuestas al formulario de privacidad

**Para Chrome Web Store**, debes responder preguntas específicas sobre cada permiso:

1. **`activeTab`**: "Lee la pestaña activa para capturar su URL y título cuando el usuario selecciona 'Save to BookmarkForge'. Solo accede a la pestaña actual, solo cuando el usuario hace clic explícito."

2. **`contextMenus`**: "Añade una opción al menú contextual del navegador para que el usuario pueda guardar páginas web en su vault de BookmarkForge."

3. **`storage`**: "Almacena la URL de tu instancia de BookmarkForge (por defecto bookmarkforgeapp.com) para que la extensión sepa a dónde enviar los bookmarks. No almacena datos personales."

4. **`script-src 'self'`**: "Política de seguridad que limita la ejecución de scripts a los archivos locales de la extensión, previniendo inyección de código malicioso."

---

## 🔴 ASPECTOS TÉCNICOS

### Build y empaquetado

- [ ] **Build de la extensión completado**
  ```bash
  npm run build:extension:custom
  ```

- [ ] **Archivo .zip listo** para upload
  - Chrome: `dist-extension/bookmarkforge-chrome.zip`
  - Firefox: `dist-extension/bookmarkforge-firefox.zip`

- [ ] **Extensión actualizada** a la versión en tienda
  - El número de versión en `manifest.json` debe coincidir con el release

- [ ] **`check:extension-csp`** pasa
  ```bash
  npm run check:extension-csp
  ```

### Pruebas

- [ ] **Extensión carga** sin errores en Chrome
- [ ] **Extensión carga** sin errores en Firefox
- [ ] **Menú contextual** aparece y funciona
- [ ] **Capture URL** funciona (la URL se guarda en el vault)
- [ ] **Configuración** se guarda correctamente
- [ ] **Sin errores en la consola** del navegador

---

## 🟢 ASPECTOS DE MARKETING (opcional pero recomendado)

### Optimización de tienda (ASO)

- [ ] **Nombre buscable**: "BookmarkForge" + "bookmark"
- [ ] **Icono atractivo**: Profesional, moderno
- [ ] **Descripción con keywords**: bookmark, vault, encryption, privacy
- [ ] **Capturas de alta calidad**: Muestra el producto funcionando
- [ ] **Categoría correcta**: Herramientas/Productividad
- [ ] **Videos**: Demo de 30 segundos

### Lanzamiento

- [ ] **Plan de comunicación**: Twitter/X, Reddit, newsletters de productividad
- [ ] **Release notes**: Documentar qué hay de nuevo
- [ ] **Documentación**: `docs/EXTENSION-LOCAL-SETUP.md` actualizada
- [ ] **FAQ lista**: `docs/FAQ-SOPORTE.md` para el equipo de soporte

---

## ✅ POST-PUBLICACIÓN

### Monitoreo inicial

- [ ] **Primeras 24h**: Monitorear reviews y respuestas
- [ ] **Primeras 72h**: Resolver todos los bugs reportados
- [ ] **Primera semana**: Responder a todas las reseñas
- [ ] **Primer mes**: Analizar métricas de uso y errores

### Métricas clave

| Métrica | Meta | Herramienta |
|---------|------|-------------|
| Instalaciones | 100 en primer mes | Chrome/Firefox dashboard |
| Rating inicial | >4.0 estrellas | Tienda |
| Reseñas negativas | <5% del total | Tienda |
| Tiempo de respuesta a reseñas | <24h | Tienda |
| Bugs reportados | <10 en primer mes | GitHub Issues |

---

## ⚠️ ERRORES COMUNES QUE CAUSAN RECHAZO

1. ❌ Política de privacidad faltante o URL rota
2. ❌ Permisos sin justificación
3. ❌ Descripción engañosa o excesiva
4. ❌ Capturas de baja calidad o que no coinciden con el producto real
5. ❌ Versión desactualizada del manifest
6. ❌ Iconos faltantes o de mala calidad
7. ❌ No responde a políticas de privacidad del formulario

---

## 📋 CHECKLIST RÁPIDO (antes de subir)

```
□ Dominio comprado (bookmarkforgeapp.com)
□ Hosting desplegado y funcional
□ Políticas publicadas y accesibles
□ Capturas de pantalla tomadas
□ Build de extensión completado
□ Descripción escrita y revisada
□ Formulario de privacidad completado
□ Cuenta de desarrollador activa
□ Método de pago configurado
□ FAQ interna lista para el equipo
```
