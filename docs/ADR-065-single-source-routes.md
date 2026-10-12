# ADR-065: Single Source of Truth for Host Route Configs

**Estado:** Propuesto  
**Fecha:** 2026-10-12

## Contexto

BookmarkForge se despliega en 4 plataformas (Vercel, Netlify, Cloudflare Pages, Nginx/Docker), cada una con su propio archivo de configuración de rutas:
- `vercel.json` (Vercel)
- `netlify.toml` (Netlify)
- `public/_redirects` (Cloudflare Pages)
- `public/nginx.conf` (Nginx self-hosted)

Cada vez que se añade una nueva ruta a la aplicación, hay que actualizar manualmente los 4 archivos. El gate `check:spa-routes` verifica que estén sincronizados, pero el mantenimiento manual es propenso a errores.

## Decisión

**Mantener el gate `check:spa-routes` como solución actual** (Opción A), con plan para implementar generación automática en el futuro (Opción C).

### Solución Actual

- Mantener `check:spa-routes` en `npm run check:security-internal`
- El gate verifica que los 4 archivos estén sincronizados con `scripts/app-routes.mjs`
- Es aceptable para el volumen actual de rutas (~20 rutas de app)

### Mejora Futura

Implementar `scripts/generate-host-configs.mjs` que:
1. Lee las rutas de `scripts/app-routes.mjs` (fuente única)
2. Genera automáticamente `public/_redirects`
3. Genera automáticamente las secciones de rutas de `vercel.json`
4. Genera automáticamente las secciones de rutas de `netlify.toml`
5. Genera automáticamente los location blocks de `public/nginx.conf`
6. Se ejecuta como parte de `npm run build:ci`

## Consecuencias

### Positivas
- **Immediate:** No requiere trabajo de implementación complejo
- **Future-proof:** El gate evita drift en producción
- **Path clear:** La mejora futura está documentada

### Negativas
- **Maintenance overhead:** Actualizar 4 archivos manualmente cuando se añaden rutas
- **Technical debt:** Gate necesario por duplicación manual

## Alternativas Consideradas

1. **Eliminar gate (Opción B):** Menos overhead, pero mayor riesgo de drift en producción
2. **Generación automática inmediata (Opción C original):** Mejor solución técnica, pero requiere implementación compleja de parsers TOML/NGINX

##何时

Implementar la generación automática cuando:
- El volumen de rutas crezca significativamente (>50 rutas)
- Se añada un nuevo host platform
- El tiempo de mantenimiento manual se vuelva problemático
