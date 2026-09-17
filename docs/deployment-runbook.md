# Production deployment runbook — cierre de A11-2

Este runbook es la lista operativa para sustituir el despliegue legacy de
`bookmarkforge.com` por el checkout actual. No ejecuta DNS, `git push`, Docker
ni cambios remotos por sí mismo.

## 0. Criterio de salida

El despliegue solo se considera cerrado cuando todas estas probes devuelven el
resultado indicado desde el dominio público:

| URL | Resultado esperado |
|---|---|
| `/` | `200`, landing EN, canonical `https://bookmarkforge.com/` |
| `/ar/`, `/bg/`, `/zh/` | `200`, landing localizada, canonical propio |
| `/ar.html`, `/es.html` | No deben ser la URL canónica; pueden servir el artefacto interno |
| `/privacy-and-terms.html`, `/ar/privacy-and-terms.html` | `200`, legal con canonical/hreflang |
| `/sitemap.xml` | `200`, exactamente 61 URLs |
| `/robots.txt` | `200`, incluye el sitemap y `Disallow` de superficies privadas |
| `/app` | `200` o fallback de aplicación, pero `noindex` |
| `/health` | `200` desde la API, sin secretos en la respuesta |

Mientras cualquiera de las probes devuelve el conversor legacy o `404`, A11-2
permanece abierto y no se envía el sitemap a Search Console.

## 1. Preflight local (obligatorio)

Desde el checkout que se va a desplegar:

```bash
npm ci
npm run typecheck
npm run check
npm run check:launch-checklist:strict
npm run check:sitemap-coverage
npm run check:nginx-render
```

Conservar los logs y el SHA exacto. El comando de despliegue debe ejecutarse
con un árbol limpio y desde el mismo SHA que se etiqueta:

```bash
git status --short
git rev-parse HEAD
```

## 2. Variables y secretos

Configurar en el entorno de producción, nunca en el repositorio:

- `NODE_ENV=production`.
- `AI_SESSION_ORIGINS=https://bookmarkforge.com` — nombre histórico de la
  allow-list de `/api/license/entitlement`.
- `ENFORCE_SIGNAL_HMAC=1`.
- `LICENSE_SIGNING_PRIVATE_KEY_FILE` mediante secret manager o volumen de solo
  lectura.
- `LICENSE_PUBLIC_KEY_SPKI` coherente con la clave pública comprometida.
- `TRUST_PROXY` solo si el proxy situado delante es controlado por el operador.
- `WHOP_LICENSE_API_URL` y `WHOP_API_KEY`, si se habilitan licencias.
- `CLIENT_EVENTS_IP_HASH_SALT` y cualquier webhook operativo real.

Verificar que no se publiquen puertos internos, claves, `.env`, backups ni el
estado de analytics en las respuestas HTTP.

## 3. Despliegue

El pipeline canónico es:

```bash
node scripts/deploy-prod.mjs --deploy --verify
```

Para publicar imágenes en un registro, configurar explícitamente
`DOCKER_REGISTRY` y ejecutar el paso de push autorizado por el operador. El
script debe producir un tag `prod-YYYYMMDD-HHMM-<sha>` y mostrar el comando de
rollback correspondiente. No reutilizar `latest` como referencia de rollback.

Si el hosting es Cloudflare/Netlify, publicar el contenido de `public/` y
comprobar que `_redirects` se aplica. Si es self-hosted, desplegar la imagen
que contiene `public/nginx.conf` y comprobar que el nginx efectivo no usa una
configuración legacy anterior.

## 4. Smoke público posterior

Ejecutar desde una red externa al host:

```bash
PROD_BASE_URL=https://bookmarkforge.com node scripts/production-smoke.mjs
node scripts/check-hreflang-graph.mjs https://bookmarkforge.com
```

Además, comprobar manualmente el cuerpo de `/`, `/ar/` y `/sitemap.xml`; un
HTTP 200 del servidor legacy no es evidencia de que se haya desplegado este
checkout. Registrar status, `Location`, `Content-Type`, canonical, `lang`,
`x-robots-tag` y el conteo de `<loc>`.

## 5. Search Console y cierre

Solo después de las probes verdes:

1. Confirmar que `/sitemap.xml` contiene 61 URLs del checkout.
2. Confirmar que `/robots.txt` apunta al sitemap público.
3. Enviar el sitemap en Search Console.
4. Registrar fecha, SHA, tag, proveedor de hosting y resultados de las probes en
   `docs/audit.md`.
5. Cerrar A11-2 únicamente con evidencia del dominio público; los gates locales
   no sustituyen la verificación del despliegue.

## 6. Rollback

Ante una regresión:

```bash
node scripts/rollback.mjs --target prod-YYYYMMDD-HHMM-<sha>
```

Después del rollback repetir el smoke público y verificar byte a byte que el
procedimiento no haya alterado manualmente `public/_headers` ni
`public/sitemap.xml`. El test de integración de `scripts/rollback.mjs` cubre
esta propiedad en un fixture temporal; la confirmación pública sigue siendo
responsabilidad del operador.
