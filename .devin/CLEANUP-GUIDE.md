# BookmarkForge Cleanup Guide

Guía para limpiar repositorios BookmarkForge (bookmarkforge-2026 y bookmarkforge-core) respetando las reglas de Open Core.

## Contexto

BookmarkForge es un proyecto **Open Core**:
- **Core (MIT)**: Código público en bookmarkforge-core
- **Pro (Propietario)**: Código privado en bookmarkforge-2026
- El Core NO debe contener implementación directa de código Pro
- El Core SÍ puede contener configuración y texto legal relacionado con Pro

## Limpieza Estándar

### 1. Archivos temporales y cache (SIEMPRE eliminar)

```bash
# En ambos repositorios
rm -f tsconfig.tsbuildinfo
rm -f bundle-report.md
rm -f ci-chunk-report.json
rm -f nightly-consistency.svg
rm -f nightly-trends-summary.md
rm -f nightly-trends.svg
rm -rf test-results/
```

### 2. Scripts de infraestructura externa (eliminables)

Estos scripts son para configurar servicios externos (GitHub, Namecheap, Vercel, Whop) y NO son necesarios para desarrollo local:

```bash
# Scripts de configuración
rm -f scripts/github-branch-protection.*
rm -f scripts/namecheap-dns-config.*
rm -f scripts/namecheap-dns-manual-guide.*
rm -f scripts/vercel-domain-config.*
rm -f scripts/whop-config.*

# Scripts de auditoría asociados
rm -f scripts/audit-all-external.mjs
rm -f scripts/audit-whop-config.mjs
rm -f scripts/auto-audit-and-fix.*
rm -f scripts/comprehensive-audit-and-fix.mjs

# Archivos de configuración
rm -f .env.whop.example
```

### 3. Actualizar package.json

Eliminar scripts npm que referencian archivos borrados:

```json
// ELIMINAR:
"audit:whop": "node scripts/audit-whop-config.mjs",
"audit:external": "node scripts/audit-all-external.mjs",
"whop:validate": "tsx src/services/WhopService.ts",
"whop:test": "vitest run src/tests/services/WhopService.test.ts"
```

### 4. Actualizar baselines y documentación

- `scripts/env-direct-reads.baseline.json`: Eliminar referencias a WHOP_API_KEY
- `docs/RELEASE-STATUS.md`: Actualizar estado de lint
- `docs/sast-triage-log.md`: Agregar nota de cleanup

## Reglas Open Core (CRÍTICO)

### En bookmarkforge-2026 (Privado)
- ✅ Puede contener código Pro completo
- ✅ Puede contener implementación de APIs externas (Whop, etc.)
- ✅ Puede contener scripts de infraestructura
- ✅ Puede contener secrets de configuración (en .env.example, NO valores reales)

### En bookmarkforge-core (Público)
- ❌ NO debe contener implementación directa de código Pro
- ❌ NO debe contener servicios como WhopService.ts
- ❌ NO debe contener dependencias Pro (@whop/sdk)
- ✅ SÍ puede contener configuración (URLs de checkout, precios)
- ✅ SÍ puede contener texto legal (PRICING_CONFIG, LICENSE_CONFIG)
- ✅ SÍ puede contener claves PÚBLICAS (license-public-key.ts)

### Ejemplos de código a eliminar en Core

```typescript
// ❌ ELIMINAR: Implementación directa de API Whop
// src/services/WhopService.ts
import { WhopClient } from "@whop/sdk";
const whop = new WhopClient({ token: process.env.WHOP_API_KEY });
```

```typescript
// ✅ MANTENER: Solo configuración
// src/constants/license.ts
checkoutUrlPro: env.whopCheckoutUrl?.trim() ?? "",
```

```typescript
// ✅ MANTENER: Solo texto legal
// src/constants/pricing.ts
legalLine: "Lifetime license for BookmarkForge v1. 30-day refund via Whop.",
```

## Verificación de Sensitive Data

### Código que es CORRECTO mantener
- Claves PÚBLICAS (RSA, ED25519) - no son secretas
- `.env.example` con placeholders ("your-key-here")
- Código de seguridad que IMPLEMENTA protección (no expone datos)
- Scripts de auditoría que DETECTAN secrets

### Código que NUNCA debe estar
- API keys reales
- Tokens reales
- Claves PRIVADAS
- Contraseñas
- Secrets de producción

## Comandos de Verificación

Después de la limpieza, ejecutar:

```bash
# Verificar que no hay referencias a archivos eliminados
grep -r "WhopService\|whop-config\|namecheap-dns" --include="*.md" --include="*.mjs" scripts/ docs/

# Verificar que package.json no tiene scripts rotos
npm run check:script-reachability

# Verificar límites Open Core
npm run check:open-core
npm run check:pro-imports
```

## Checklist de Limpieza

- [ ] Eliminar archivos temporales (tsbuildinfo, bundle-report, etc.)
- [ ] Eliminar scripts de infraestructura externa
- [ ] Eliminar .env.whop.example
- [ ] Actualizar package.json (eliminar scripts rotos)
- [ ] Eliminar código Pro en bookmarkforge-core
- [ ] Eliminar dependencias Pro de package.json
- [ ] Actualizar baselines (env-direct-reads.baseline.json)
- [ ] Actualizar documentación (RELEASE-STATUS.md, sast-triage-log.md)
- [ ] Verificar que no hay referencias a archivos eliminados
- [ ] Ejecutar gates de verificación (check:open-core, check:pro-imports)

## Archivos de Referencia

- Reglas: `AGENTS.md`
- Open Core: `OPEN-CORE.md`
- Gates: `package.json` (scripts npm)
