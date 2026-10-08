# GitHub Secrets & Variables — Configuración para CI/CD y Producción

> **Importante**: Este documento lista TODOS los secrets y variables necesarias para el pipeline completo.
> Configurar estos valores ANTES de subir el repo a público o de desplegar.

---

## 🔴 SECRETS OBLIGATORIOS (GitHub → Settings → Secrets and variables → Actions)

Estos secrets se usan en los workflows de CI/CD y despliegue.

### Producción

| Secret | Propósito | Ejemplo |
|--------|-----------|---------|
| `WHOP_API_KEY` | Clave API de Whop para validación de licencias | `whop_x_xxxxxxxxx` |
| `WHOP_LICENSE_API_URL` | URL de la API de licencias de Whop | `https://api.whop.com` |
| `LICENSE_SIGNING_PRIVATE_KEY_PKCS8` | Clave privada para firmar licencias (Ed25519/RSA-PSS) | `-----BEGIN PRIVATE KEY-----...` |
| `LICENSE_SIGNING_KEY_FILE` | Ruta al archivo de clave privada en el servidor | `/run/secrets/license_signing_key` |
| `DOCKER_REGISTRY` | Registro de Docker para push de imágenes | `registry.example.com:5000` |
| `STAGING_URL` | URL del entorno de staging | `https://staging.bookmarkforgeapp.com` |
| `STAGING_ANALYTICS_ADMIN_TOKEN` | Token admin para analytics en staging | `staging_analytics_xxx` |
| `STAGING_SMOKE_TOKEN` | Token para smoke tests en staging | `staging_smoke_xxx` |
| `STAGING_SMOKE_ADMIN_TOKEN` | Token admin para smoke tests | `staging_smoke_admin_xxx` |

### Seguridad (CI)

| Secret | Propósito |
|--------|-----------|
| `STAGING_DAST_CONTEXT_B64` | Contexto de autenticación para DAST authenticated |
| `STAGING_DAST_CONTEXT_PASSWORD` | Password para el contexto DAST |
| `SLACK_WEBHOOK_URL` | Webhook para alertas (HTTPS only) |
| `CSP_REPORT_ADMIN_TOKEN` | Token para acceder a CSP reports |
| `SIGNALING_ADMIN_TOKEN` | Token admin del servidor de señalización |
| `SIGNALING_IP_HASH_SALT` | Salt para hasheado de IPs de señalización |

### Analíticos

| Secret | Propósito |
|--------|-----------|
| `ANALYTICS_ADMIN_TOKEN` | Token para el dashboard de analytics |
| `ANALYTICS_ALERT_WEBHOOK_URL` | Webhook para alertas de KPI caídos |
| `KPI_MIN_DAU` | Umbral mínimo de DAU |
| `KPI_MIN_WAU` | Umbral mínimo de WAU |
| `KPI_MIN_MAU` | Umbral mínimo de MAU |
| `KPI_MIN_D7_PCT` | Umbral mínimo de retención D7 |
| `KPI_MIN_D30_PCT` | Umbral mínimo de retención D30 |

### Opcionales (buenas prácticas)

| Secret | Propósito |
|--------|-----------|
| `VITE_SENTRY_DSN` | DSN de Sentry para error reporting |
| `DOCKER_REGISTRY_PASSWORD` | Password para el registro Docker |
| `GITHUB_TOKEN_PAT` | Personal access token para operaciones de git |

---

## 🟢 VARIABLES DE ENTORNO (GitHub → Settings → Secrets and variables → Variables)

Estas variables son no-confidenciales pero necesarias para los workflows.

### Producción

| Variable | Valor |
|----------|-------|
| `NODE_ENV` | `production` |
| `VITE_APP_VERSION` | `1.0.0` |
| `VITE_DB_NAME` | `bookmarkforge_prod` |
| `VITE_P2P_SIGNALING_URL` | `wss://signal.bookmarkforgeapp.com` |
| `VITE_WHOP_CHECKOUT_URL` | `https://bookmarkforgeapp.com/checkout` |
| `AI_SESSION_ORIGINS` | `https://bookmarkforgeapp.com` |
| `ENFORCE_SIGNAL_HMAC` | `1` |
| `TRUST_PROXY` | `1` |
| `HOST` | `0.0.0.0` |
| `PORT` | `8787` |
| `HTTP_PORT` | `8080` |
| `CSP_REPORT_ADMIN_TOKEN` | *(token generado)* |
| `ANALYTICS_ADMIN_TOKEN` | *(token generado)* |
| `PRODUCTION_URL` | `https://bookmarkforgeapp.com` |

### Staging

| Variable | Valor |
|----------|-------|
| `STAGING_URL` | `https://staging.bookmarkforgeapp.com` |
| `NODE_ENV` | `staging` |
| `VITE_APP_VERSION` | `1.0.0-staging` |
| `VITE_P2P_SIGNALING_URL` | `wss://staging.signal.bookmarkforgeapp.com` |
| `AI_SESSION_ORIGINS` | `https://staging.bookmarkforgeapp.com` |

---

## 🔐 CÓMO GENERAR LOS SECRETS

### License Signing Keys

```bash
# Generar par de claves Ed25519
node scripts/generate-license-keys.mjs

# Esto genera:
# - license_signing_key.pem (PRIVADA — nunca en git)
# - license_signing_key.pub (PÚBLICA — en el servidor)

# Obtener la clave privada en formato PKCS8:
node -e "const fs=require('fs'); console.log(fs.readFileSync('license_signing_key.pem','utf8'))"
```

**NUNCA** commitees la clave privada. El `LICENSE_SIGNING_PRIVATE_KEY_PKCS8` debe estar solo en GitHub Secrets.

### WHOP API Key

1. Ve a https://whop.com/dashboard/developer/api-keys
2. Crea una nueva API key
3. Selecciona "Account API Key"
4. Copia el valor que empieza con `whop_`
5. Agrega a GitHub Secrets como `WHOP_API_KEY`

### Docker Registry Token

Si usas Docker Hub:
```bash
# Crear token de acceso en https://hub.docker.com/settings/security
# Tipo: Read/Write
```

### Slack Webhook

1. Ve a https://api.slack.com/messaging/webhooks
2. Crea un nuevo webhook
3. Selecciona un canal (ej: `#alerts`)
4. Copia la URL que empieza con `https://hooks.slack.com/services/`
5. Agrega a GitHub Secrets como `SLACK_WEBHOOK_URL`

### Tokens aleatorios

```bash
# Para generar tokens aleatorios seguros:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copia la salida como valor del token
```

---

## ⚠️ ADVERTENCIAS DE SEGURIDAD

### Lo que NUNCA debe estar en Secrets

| ❌ NUNCA en secrets | ✅ Donde debería estar |
|---------------------|----------------------|
| Contraseña maestra del vault | Solo en el vault del usuario |
| API keys de proveedores AI | Encriptadas en el vault del usuario |
| `LICENSE_SIGNING_PRIVATE_KEY_PKCS8` | Solo en GitHub Secrets + servidor |
| `.env` real con valores | En GitHub Secrets o servidor |

### Reglas de seguridad

1. **La clave privada de licencias** está en GitHub Secrets Y en el servidor como file mount
2. **VITE_* variables** se inyectan en el bundle — nunca pongas secretos en VITE_*
3. **El servidor no tiene** keys de API de IA — las llaves de los usuarios están encriptadas en su vault
4. **Los passwords del vault** se zeroizan de la memoria después de uso
5. **Cualquier cambio en secrets** debe ser documentado y auditado

---

## 📋 CONFIGURACIÓN RÁPIDA

### Paso 1: Acceder a GitHub Secrets

```
https://github.com/bookmarkforge/bookmarkforge → Settings → Secrets and variables → Actions
```

### Paso 2: Agregar secrets

Clic en "New repository secret" para cada uno de los secrets de la tabla superior.

### Paso 3: Agregar variables de entorno

Clic en "New repository variable" para las variables no-confidenciales.

### Paso 4: Verificar

```bash
# Después de configurar, el pipeline CI debería funcionar:
npm run verify:fast
```

### Paso 5: Test de despliegue

```bash
# En staging:
node scripts/staging-deploy.mjs --dry-run

# En producción (cuando estés listo):
node scripts/deploy-prod.mjs --deploy --verify
```

---

## 🔄 ROTACIÓN DE SECRETS

### Cuándo rotar

- Cuando alguien con acceso abandona el proyecto
- Cada 90 días como buena práctica
- Después de cualquier sospecha de exposición

### Cómo rotar

1. Genera nueva clave
2. Actualiza GitHub Secrets (el viejo caduca inmediatamente)
3. Reinicia el servidor con el nuevo valor
4. Actualiza `LICENSE_SIGNING_KEY_FILE` en la configuración
5. Verifica que los usuarios existentes con licencia siguen funcionando
6. Documenta la rotación

### Verificación post-rotación

```bash
# Verificar que la nueva clave funciona:
node scripts/check:license-keys.mjs --check

# Verificar que el servidor responde:
curl https://bookmarkforgeapp.com/api/license/health

# Verificar que los usuarios pueden activar:
npm run production-smoke
```

---

## 🗂️ ARCHIVOS RELACIONADOS

| Archivo | Propósito |
|---------|-----------|
| `.env.example` | Variables locales de desarrollo |
| `.env.production.example` | Template de variables de producción |
| `.env.whop.example` | Template específico de Whop |
| `docker-compose.prod.yml` | Configuración de producción con secrets |
| `scripts/generate-license-keys.mjs` | Generación de claves |
| `server/src/license-server.ts` | Servidor de licencias |
| `server/src/entitlement-endpoint.ts` | Verificación de entitlements |
