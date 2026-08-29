# Protección de `main`

La protección de la rama debe configurarse en GitHub en **Settings → Branches → Branch protection rules** o mediante una regla de ruleset equivalente.

## Configuración obligatoria

- Patrón: `main`.
- Require a pull request before merging: activado.
- Required approvals: mínimo **1**; usar **2** para cambios bajo `/src/utils/crypto-core.ts`, `/server/`, `Dockerfile`, `docker-compose*.yml`, `.github/` y `public/nginx.conf`.
- Dismiss stale pull request approvals when new commits are pushed: activado.
- Require review from Code Owners: activado.
- Require status checks to pass before merging: activado.
- Require branches to be up to date before merging: activado.
- Checks obligatorios: `Typecheck, lint, tests and security gates`, `Playwright E2E`, `Production build and repository checks` y `Dependency review` cuando GitHub lo ofrezca para el Pull Request.
- Require conversation resolution before merging: activado.
- Require signed commits: recomendado si la política de la organización lo permite.
- Restrict who can push to matching branches: activado.
- Allow force pushes: desactivado.
- Allow deletions: desactivado.

## Importante

`CODEOWNERS` sólo exige revisores si la opción **Require review from Code Owners** está activada. Los nombres `@bookmarkforge/...` son placeholders: deben sustituirse por equipos reales existentes en la organización antes de activar la regla.

La protección de ramas es una configuración del repositorio remoto y no puede aplicarse desde este checkout local sin acceso administrativo a GitHub. Después de crear la regla, abrir un PR de prueba para comprobar que un cambio en criptografía o infraestructura solicita los owners correctos.
