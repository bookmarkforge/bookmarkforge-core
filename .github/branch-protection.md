# Protección de `main`

La protección de la rama debe configurarse en GitHub en **Settings → Branches → Branch protection rules** o mediante una regla de ruleset equivalente.

## Configuración obligatoria

- Patrón: `main`.
- Require a pull request before merging: activado.
- Required approvals: **0**; el repositorio tiene un único mantenedor y no depende de revisores externos.
- Dismiss stale pull request approvals when new commits are pushed: activado.
- Require status checks to pass before merging: activado.
- Require branches to be up to date before merging: activado.
- Checks obligatorios: `Enforce mandatory security gates`, `Typecheck, lint, tests and security gates`, `Playwright E2E`, `Production build and repository checks`, `Dependency review` (cuando GitHub lo ofrezca para el Pull Request), `CodeQL analysis` y `Semgrep analysis`.
- Require conversation resolution before merging: activado.
- Require signed commits: recomendado si la política de la organización lo permite.
- Restrict who can push to matching branches: activado.
- Allow force pushes: desactivado.
- Allow deletions: desactivado.

## Importante

Los checks obligatorios son la barrera principal para aceptar cambios; el repositorio tiene un único mantenedor.

La protección de ramas es una configuración del repositorio remoto y no puede aplicarse desde este checkout local sin acceso administrativo a GitHub. El ruleset exportable está en `.github/rulesets/main-protection.json`.

## Importación del ruleset

En GitHub: **Settings → Rules → Rulesets → New branch ruleset → Import a ruleset**. Selecciona `.github/rulesets/main-protection.json` y activa el ruleset.

Alternativamente, mediante GitHub CLI/API con permisos de administración del repositorio:

```bash
gh api --method POST \
  -H 'Accept: application/vnd.github+json' \
  /repos/ORG/REPO/rulesets \
  --input .github/rulesets/main-protection.json
```

Sustituye `ORG/REPO` por el repositorio real. Los `integration_id` de los checks estándar de GitHub Actions son `15368`; si el repositorio usa una aplicación CI distinta, actualízalos según la documentación de GitHub.

> **Formato del archivo:** `.github/rulesets/main-protection.json` es el **payload directo del body de creación** de la API (`POST /repos/{owner}/{repo}/rulesets`), no una exportación. No debe contener campos de export como `id`, `source`, `source_type`, `node_id`, `_links`, `created_at` o `updated_at` — el body de creación documentado es `name`, `target`, `enforcement`, `bypass_actors`, `conditions` y `rules`. El gate `npm run check:launch-checklist` falla si aparece alguno de esos campos de export.

Después de importar la regla, abre un PR de prueba para comprobar que un cambio en criptografía o infraestructura queda bloqueado cuando fallan los checks definidos en `.github/workflows/ci.yml` y `.github/workflows/sast.yml`.
