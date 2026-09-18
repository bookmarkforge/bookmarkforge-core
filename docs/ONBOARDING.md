# 🚀 Guía de Onboarding para Contribuyentes de BookmarkForge

> Documento complementario a `CONTRIBUTING.md`, `AGENTS.md` y `docs/audit.md`.
> Este documento es tu punto de entrada si estás comenzando con el proyecto.

## 📋 Requisitos Previos

- **Node.js >= 20.19.0** (verificar con `node -v`)
- **npm** (o pnpm/yarn si prefieres)
- **Docker Compose** (solo si vas a probar la topología de producción)
- **Git** configurado con tu nombre y email
- Un editor de código con soporte para TypeScript (VS Code recomendado)

## 🏃 Primera vez: Setup Rápido

```bash
# 1. Clona el repositorio
git clone <repo-url>
cd bookmark6

# 2. Instala dependencias
npm ci

# 3. Configura el entorno local
cp .env.example .env
# Edita .env con tus valores locales

# 4. Verifica que todo funciona (30-60 segundos)
npm run verify:fast

# 5. Inicia el servidor de desarrollo
npm run dev

# 6. (Opcional) Inicia el servidor companion
npm run server
```

El frontend estará disponible en `http://localhost:5173`.
El servidor companion en `ws://localhost:8787`.

## 🎯 ¿Qué hacer después del setup?

### Si quieres hacer tu primer PR:

1. **Lee la sección 6 de `CONTRIBUTING.md`** — Los gates obligatorios
2. **Ejecuta `npm run check:quick`** antes de cada commit (~2.5s)
3. **Lee `AGENTS.md`** — Contiene las reglas de ingeniería del proyecto
4. **Busca un issue** etiquetado como `good first issue`
5. **Sigue el flujo de branching**: `feat/<short-slug>`

### Si quieres entender la arquitectura:

1. **Lee `docs/architecture.md`** — El diagrama y la descripción general
2. **Explora `src/`** — Los directorios principales:
   - `src/components/` — Componentes React (80+)
   - `src/services/` — Servicios de dominio (58+)
   - `src/db/` — Esquemas RxDB
   - `src/workers/` — Web Workers para criptografía
   - `src/tests/` — Tests organizados por área
3. **Lee `docs/ADR-001-check-static-brand.md`** — Ejemplo de ADR

### Si quieres contribuir a seguridad:

1. **Lee `docs/security.md`** y `docs/audit.md`
2. **Estudia `AGENTS.md` sección 2** — Contrato de buffers de contraseñas
3. **Revisa `src/tests/security/`** — Tests de regresión de seguridad
4. **No toques código crypto sin entender `AGENTS.md`**

## 📁 Estructura del Proyecto (Resumen)

```
bookmark6/
├── src/                    # Código fuente del frontend
│   ├── components/         # 80+ componentes React
│   ├── services/           # 58+ servicios de dominio
│   ├── db/                 # Esquemas RxDB/IndexedDB
│   ├── workers/            # Web Workers (crypto, sync)
│   ├── tests/              # Tests por área (42 directorios)
│   └── ...
├── server/                 # Servidor companion (Node.js + WS)
│   └── src/               # ~13 archivos HTTP + WS
├── extension/              # Extensión de navegador (Chrome/Firefox)
├── scripts/               # 168+ scripts de build/check
├── docs/                  # 131+ archivos de documentación
├── tests/e2e/             # Playwright specs
└── scripts/               # Herramientas de CI/CD
```

## 🧪 Testing para Principiantes

### Test rápido (recomendado para empezar):
```bash
npm run test:fast        # ~30s, tests críticos
```

### Test específico:
```bash
npx vitest run src/tests/db/        # Solo tests de db
npx vitest run src/tests/security/  # Solo tests de seguridad
```

### E2E (requiere build):
```bash
npm run build:ci              # Primero construir
npm run e2e:smoke             # Smoke test rápido
```

### Ver logs de tests (cuando fallan sin salida):
```bash
BMF_TEST_LOGS=full npm run test:fast
```

## 🔧 Comandos Diarios Útiles

| Comando | Tiempo | Uso |
|---------|--------|-----|
| `npm run dev` | — | Servidor de desarrollo |
| `npm run verify:fast` | ~5s | Pre-commit rápido |
| `npm run check:quick` | ~2.5s | Gates sub-segundo |
| `npm run typecheck:prod` | ~10s | TypeScript estricto |
| `npm run lint` | ~21s | ESLint por dominio |
| `npm run test:fast` | ~30s | Tests críticos |
| `npm run test:slow` | ~5min | Todos los tests |
| `npm run check` | ~62s | Todos los gates CI |
| `npm run ci:local` | ~2min | Simula CI completo |
| `npm run check:ci-groups core-integrity` | ~3s | Solo core integrity |
| `npm run check:ci-groups security-environment` | ~4s | Solo seguridad |

## 🚦 Entendiendo los Gates de CI

El pipeline tiene **~40 checks**. Para no abrumarte, usa los grupos:

```bash
# Solo integridad del Core + seguridad (~7s en vez de ~62s)
npm run ci:fast

# Estándar (sin e2e ni build completo)
npm run ci:standard

# Completo (incluye visual, brand, performance)
npm run ci:full
```

Los 8 grupos están definidos en `scripts/ci-groups.json`:
1. **core-integrity** (~3s) — Open Core boundary
2. **security-environment** (~4s) — Secrets y config
3. **workflow-pipeline** (~5s) — CI/CD workflows
4. **quality-code** (~25s) — Typecheck + lint + boundaries
5. **content-integrity** (~12s) — i18n y claims
6. **brand-visual** (~5s) — Marca y SEO
7. **security-depth** (~8s) — CVEs y auditoría
8. **build-verification** (~60s) — Build completo

## 🐛 Debugging Común

### TypeScript errors:
```bash
npm run typecheck:prod    # Usa tsconfig.prod.json
```

### ESLint no detecta errores:
```bash
npm run lint:all          # ESLint completo (puede ser lento)
```

### Tests fallan sin mensajes claros:
```bash
BMF_TEST_LOGS=full npx vitest run src/tests/<area>/
```

### E2E no encuentra elementos:
```bash
npm run e2e:smoke:ui      # Modo visual de Playwright
```

### Build falla:
```bash
npm run build:ci          # Incluye secret-scan, SRI, chunk gates
```

## 📚 Recursos de Aprendizaje

1. **`docs/architecture.md`** — Arquitectura general
2. **`docs/ADR-001-check-static-brand.md`** — Primer ADR (ejemplo)
3. **`docs/audit.md`** — Registro de auditorías
4. **`docs/ROPA.md`** — GDPR / RGPD (template operativo)
5. **`docs/security.md`** — Seguridad y criptografía
6. **`AGENTS.md`** — Convenciones de ingeniería (la biblia)
7. **`CONTRIBUTING.md`** — Flujo de contribución
8. **`docs/launch-checklist.md`** — Checklist de lanzamiento

## 🤝 Código de Conducta

- Lee `CONTRIBUTING.md` sección 2 antes de abrir issues
- Seguridad sensible → disclosure privada, no issues públicos
- Todo string visible → `t()` (falla si no pasa por i18n)
- Nunca commits `.env`, secretos, o credenciales
- No modifiques `scripts/context-boundaries.allowlist.json`

## 🆘 ¿Necesitas Ayuda?

1. **Pregunta en el issue** con contexto de lo que leíste
2. **Lee la sección 13 de `CONTRIBUTING.md`** ("Cuando estás seguro")
3. **No adivines** — si `AGENTS.md` es ambiguo, dilo en el issue
4. **Para temas legales/GDPR** → `docs/ROPA.md` (no es asesoría legal)

## 🎯 Checklist para tu Primer PR

- [ ] `npm run verify:fast` pasa
- [ ] `npm run check:quick` pasa
- [ ] `npm run typecheck:prod` pasa
- [ ] `npm run lint` pasa
- [ ] `npm run test:fast` pasa
- [ ] No hay `console.*` en el código nuevo
- [ ] No hay secretos hardcodeados
- [ ] Todo string visible tiene `t()`
- [ ] ADR/anchor presente si tocas seguridad
- [ ] No tocaste la allowlist de boundaries
- [ ] README/CONTRIBUTING actualizados si es necesario

---

> **Nota**: Este repositorio es operado por un solo mantenedor.
> La revisión es **automated-first**: los checks CI son el enforcement.
> Los tiempos de respuesta dependen del mantenedor.
> Lee `docs/audit.md` para el estado actual de la operación.
