# Checklist de Pre-Lanzamiento — BookmarkForge V1.0

> Última actualización: 2026-09-26  
> **Antes de lanzar, verificar TODOS los puntos marcados con 🔴.**
> Este checklist cubre desde la infraestructura hasta la tienda de extensiones.

---

## 🔴 FASE 1: Infraestructura Base (Días 1-3)

> Sin esto, NO puedes lanzar. El producto no llega a nadie.

### Dominio y Hosting

- [ ] **Dominio comprado**: `bookmarkforgeapp.com`
  - Registrador: Namecheap, Cloudflare, Porkbun (~$10-15/año)
  - ✅ Propiedad confirmada

- [ ] **Hosting configurado**
  - Opción A: VPS con Docker (Hetzner, DigitalOcean, Linode)
    - Servidor con Docker Compose instalado
    - Nginx como reverse proxy
    - SSL con Let's Encrypt (certbot)
  - Opción B: Vercel para el frontend (solo la SPA) + VPS para el servidor
  - ✅ Hosting accesible en producción

- [ ] **Dominio apuntando al hosting**
  - DNS A record → IP del servidor
  - DNS CNAME → `www.bookmarkforgeapp.com` → `bookmarkforgeapp.com`
  - ✅ `https://bookmarkforgeapp.com` carga correctamente

### SSL y Seguridad

- [ ] **Certificado SSL activo**
  - Let's Encrypt (gratis, 90 días, auto-renovable)
  - Verificar: `curl https://bookmarkforgeapp.com/health` → 200 OK
  - ✅ HTTPS funcionando

- [ ] **CSP configurado**
  - Headers de seguridad en el reverse proxy
  - Verificar con: `curl -I https://bookmarkforgeapp.com` → headers CSP presentes

---

## 🔴 FASE 2: Whop (Días 1-3)

> Sin Whop configurado, nadie puede comprar. Esto es tu fuente de ingresos.

### Cuenta Whop

- [ ] **Cuenta merchant creada** con identidad legal real
  - Whop requiere verificación de identidad
  - ✅ Cuenta verificada

- [ ] **Producto Pro creado** en Whop Dashboard
  - Nombre: BookmarkForge Pro
  - Precio: $59 (Early Bird) / $79 (regular)
  - Tipo: Licencia de por vida (no suscripción)
  - ✅ Producto con ID `prod_xxxxx`

- [ ] **API Key generada**
  - Tipo: Account API Key
  - Permisos: Read Memberships, Write Memberships
  - ✅ API Key (`whop_xxxxx`) en GitHub Secrets como `WHOP_API_KEY`

- [ ] **WHOP_LICENSE_API_URL** configurado
  - Valor: `https://api.whop.com`
  - ✅ En `.env.production.example`

### Entorno de Producción

- [ ] **`WHOP_API_KEY` en servidor**
  - Como variable de entorno del servidor, NO en el bundle
  - ✅ Configurado y probado

- [ ] **`WHOP_LICENSE_API_URL` en servidor**
  - ✅ Configurado

- [ ] **`LICENSE_SIGNING_PRIVATE_KEY_FILE` en servidor**
  - Archivo montado como Docker secret: `/run/secrets/license_signing_key`
  - ✅ Clave generada con `scripts/generate-license-keys.mjs`
  - ✅ Clave pública en el servidor para verificación

- [ ] **`LICENSE_SIGNING_KEY_FILE`** configurado
  - ✅ Apunta al mismo archivo que arriba

### Prueba de Compra

> ⚠️ **ESTO ES CRÍTICO**: Haz la prueba ANTES de anunciar.

- [ ] **Compra de prueba con tarjeta real**
  1. Ve a https://whop.com
  2. Compra BookmarkForge Pro ($59)
  3. ✅ El pedido se crea

- [ ] **Verificar que la licencia se activa**
  1. Instala BookmarkForge en un navegador limpio
  2. Ve a Settings → Pro
  3. Activa la licencia con el key de tu compra de prueba
  4. ✅ El plan muestra "Pro" y las funciones se desbloquean

- [ ] **Verificar reembolso y reversión a Free**
  1. Solicita reembolso en Whop
  2. Espera a que Whop procese
  3. Verifica que la licencia revierte a Free
  4. ✅ El usuario vuelve a Free, datos intactos

---

## 🔴 FASE 3: Servidor de Producción (Días 3-5)

### Configuración del Servidor

- [ ] **`docker-compose.prod.yml`** configurado
  - `VITE_APP_VERSION=1.0.0`
  - `VITE_DB_NAME=bookmarkforge_prod`
  - `AI_SESSION_ORIGINS=https://bookmarkforgeapp.com`
  - `WHOP_LICENSE_API_URL=https://api.whop.com`
  - `WHOP_API_KEY` ← desde secret del servidor
  - `LICENSE_SIGNING_PRIVATE_KEY_FILE=/run/secrets/license_signing_key`
  - `ENFORCE_SIGNAL_HMAC=1`
  - `TRUST_PROXY=1` (si hay reverse proxy)
  - `HOST=0.0.0.0`
  - `PORT=8787`
  - ✅ Cada variable con valor real

- [ ] **`.env.production`** creado
  - Copia de `.env.production.example` con valores reales
  - ✅ Sin comentarios que revelen secretos
  - ✅ Guardado en ubicación segura (NO en git)

- [ ] **Imagen Docker construida**
  ```bash
  npm run build:ci
  docker compose -f docker-compose.prod.yml build web api
  ```
  - ✅ Build exitoso

- [ ] **Servidor desplegado y corriendo**
  ```bash
  docker compose -f docker-compose.prod.yml up -d web api
  ```
  - ✅ Contenedores corriendo
  - ✅ `curl http://localhost:8787/health` → 200 OK

- [ ] **Reverse proxy configurado**
  - Nginx con SSL, CSP, HSTS
  - Proxy a `bookmarkforge_api:8787`
  - ✅ `https://bookmarkforgeapp.com` → funcional

### Verificación del Endpoints

- [ ] **`GET /api/license/health`** → 200 OK
  ```bash
  curl https://bookmarkforgeapp.com/api/license/health
  ```

- [ ] **`POST /api/license/entitlement`** → funcional
  - Con licencia válida → `{ plan: "pro" }`
  - Sin licencia → `{ plan: "free" }`

- [ ] **`POST /api/license/activate`** → funcional
  - Con clave Whop válida → `{ payload, signature }`

---

## 🔴 FASE 4: Extensión para Tiendas (Días 5-7)

### Preparación

- [ ] **Build de la extensión**
  ```bash
  npm run build:extension:custom
  ```
  - ✅ `dist-extension/` con archivos listos

- [ ] **Verificar CSP de la extensión**
  ```bash
  npm run check:extension-csp
  ```
  - ✅ Pasa

- [ ] **Capturas de pantalla** (mínimo 4 para Chrome)
  - Menú contextual
  - App funcionando
  - Configuración
  - PWA móvil
  - ✅ PNG de alta resolución

- [ ] **Descripción de la tienda**
  - Nombre: "BookmarkForge — Save to Bookmarks"
  - Descripción corta: máx 132 caracteres
  - Descripción larga: completa
  - ✅ Texto preparado

### Políticas

- [ ] **Política de privacidad publicada**
  - URL: `https://bookmarkforgeapp.com/privacy`
  - ✅ En inglés
  - ✅ Cubre permisos de la extensión
  - ✅ `docs/PRIVACY-EXTENSION.md` adaptada

- [ ] **Términos de servicio**
  - ✅ Disponible en `https://bookmarkforgeapp.com/terms`

### Cuenta de Desarrollador

- [ ] **Chrome Web Store Developer Account**: $50
  - ✅ Pago realizado
  - ✅ Cuenta verificada
  - ✅ Método de pago configurado

- [ ] **Firefox AMO Developer Account**
  - ✅ Registrado
  - ✅ Listo para subir

### Subida a Tiendas

- [ ] **Chrome Web Store**
  - Upload del .zip
  - Rellenar todos los formularios
  - Política de privacidad: URL
  - Descripción y capturas
  - ✅ Enviar para revisión

- [ ] **Firefox AMO**
  - Upload del .zip
  - Rellenar todos los formularios
  - Política de privacidad: URL
  - ✅ Enviar para revisión

---

## 🔴 FASE 5: GitHub y CI/CD (Días 7-10)

### Repositorio Público

- [ ] **Ejecutar `npm run export-public-repo`**
  - Genera el checkout público limpio
  - ✅ Pro export completado
  - ✅ Pro code excluido
  - ✅ Secrets excluidos

- [ ] **Cambiar GitHub de privado a público**
  - Settings → General → Change visibility
  - ✅ Repo público

- [ ] **GitHub Secrets configurados**
  - ✅ `WHOP_API_KEY`
  - ✅ `LICENSE_SIGNING_PRIVATE_KEY_PKCS8`
  - ✅ `DOCKER_REGISTRY` (si aplica)
  - ✅ `STAGING_URL`
  - ✅ `STAGING_ANALYTICS_ADMIN_TOKEN`
  - ✅ `SLACK_WEBHOOK_URL`
  - ✅ `CSP_REPORT_ADMIN_TOKEN`
  - ✅ `SIGNALING_ADMIN_TOKEN`
  - ✅ Todos los demás secrets

- [ ] **GitHub Variables configuradas**
  - ✅ `AI_SESSION_ORIGINS`
  - ✅ `VITE_APP_VERSION`
  - ✅ `PRODUCTION_URL`
  - ✅ Todas las demás variables

### CI/CD Verificación

- [ ] **CI ejecutándose exitosamente**
  ```bash
  npm run verify:fast
  ```
  - ✅ Typecheck pasa
  - ✅ Lint pasa
  - ✅ Tests rápidos pasan
  - ✅ Build pasa

- [ ] **`check:launch-checklist:strict` pasando**
  ```bash
  npm run check:launch-checklist:strict
  ```
  - ✅ CERO bloqueantes
  - ✅ Todos los checks pasan o son manuales documentados

---

## 🟡 FASE 6: Legal y Cumplimiento (Días 3-7)

> Importante pero no bloqueante para el lanzamiento técnico.

### GDPR

- [ ] **ROPA completa**
  - §1: Controlador de datos (nombre, dirección, autoridad)
  - §7/§8: DPAs con proveedores (hosting, Sentry, Whop)
  - ✅ `docs/ROPA.md` actualizado

- [ ] **Política de privacidad publicada**
  - ✅ `docs/POLITICA-PRIVACIDAD.md` con datos reales
  - ✅ URL accesible: `https://bookmarkforgeapp.com/privacy`

- [ ] **Política de reembolsos**
  - ✅ `docs/POLITICA-REEMBOLSOS.md` lista

- [ ] **Políticas de privacidad de extensión**
  - ✅ `docs/PRIVACY-EXTENSION.md` lista

### Documentación Legal

- [ ] **Términos de servicio**
  - Cobertura: uso, responsabilidad, limitación de garantías
  - ✅ Disponible en el sitio

- [ ] **Registro de marca** (opcional)
  - Considerar registrar "BookmarkForge" como marca

---

## 🟢 FASE 7: Preparación de Soporte (Días 5-10)

### FAQ y Templates

- [ ] **FAQ de soporte** preparada
  - ✅ `docs/FAQ-SOPORTE.md` lista
  - ✅ Templates de respuesta por tipo de ticket

- [ ] **Runbook de licencias** listo
  - ✅ `docs/support-license-runbook.md` actualizado

- [ ] **Políticas publicadas**
  - Privacidad ✅
  - Reembolsos ✅
  - Extensión ✅

### Monitorización

- [ ] **Sentry configurado** (opcional pero recomendado)
  - `VITE_SENTRY_DSN` en el servidor
  - Consentimiento opt-in implementado
  - ✅ Error tracking funcional

- [ ] **Analytics configurado** (opcional)
  - `ANALYTICS_ADMIN_TOKEN` configurado
  - KPI thresholds definidos
  - ✅ Dashboard de métricas funcional

---

## 📊 MÉTRICAS DE LANZAMIENTO

| Métrica | Meta | Herramienta |
|---------|------|-------------|
| Dominio | ✅ Propiedad | Whois |
| SSL | ✅ HTTPS | SSL Labs |
| Whop configurado | ✅ Producto + API | Whop Dashboard |
| Servidor corriendo | ✅ Health OK | `curl /health` |
| Extensión en tiendas | ✅ Chrome + Firefox | Tienda |
| CI pasando | ✅ Todos los checks | GitHub Actions |
| Launch checklist | ✅ Cero bloqueantes | `check:launch-checklist:strict` |
| FAQ lista | ✅ Documentada | `docs/FAQ-SOPORTE.md` |
| Políticas publicadas | ✅ Accesibles | Sitio web |
| Soporte operativo | ✅ <24h respuesta | Email |

---

## ⚠️ LISTA DE NO-LANZAMIENTO

**NO LANZAR si:**

1. ❌ El dominio no está comprado
2. ❌ El servidor no está desplegado y funcionando
3. ❌ Whop no tiene el producto configurado y la API key funciona
4. ❌ La compra de prueba NO funciona (licencia no se activa)
5. ❌ El reembolso NO revierte a Free
6. ❌ La extensión no está en ninguna tienda
7. ❌ La política de privacidad no está publicada (URL rota)
8. ❌ `check:launch-checklist:strict` tiene bloqueantes
9. ❌ El servidor responde 503 en `/api/license/health`
10. ❌ No tienes FAQ lista para el equipo de soporte (tú = 1 persona)

---

## 📋 CRONOGRAMA DE LANZAMIENTO (ejemplo)

```
Día 1-2:  Dominio + Hosting + SSL
Día 1-3:  Cuenta Whop + Producto + API Key
Día 3-5:  Servidor + Docker + Verificación completa
Día 3-5:  GDPR + ROPA + Políticas
Día 5-7:  Build extensión + Capturas + Tiendas
Día 5-7:  FAQ + Runbooks + Documentación
Día 7-10: GitHub público + Secrets + CI
Día 10:   LANZAMIENTO 🚀
```

---

## 🎯 VERIFICACIÓN FINAL ANTES DE LANZAR

Ejecuta TODOS estos comandos antes de anunciar:

```bash
# 1. Gate completo
npm run check:launch-checklist:strict

# 2. Build de producción
npm run build:ci

# 3. Verificar extensión
npm run check:extension-dist
npm run check:extension-csp

# 4. Verificar servidor
curl https://bookmarkforgeapp.com/api/license/health

# 5. Verificar dominio
curl -I https://bookmarkforgeapp.com | grep -i "strict-transport"

# 6. Verificar SSL
npx serve-security-check https://bookmarkforgeapp.com
```

---

> **Última actualización**: 2026-09-26  
> **Propósito**: Guía completa para lanzar BookmarkForge V1.0 con mínimo riesgo de malas reseñas, tickets y reembolsos.
