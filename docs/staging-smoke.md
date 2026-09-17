# Smoke post-deploy de staging y rollback

## Smoke tests

El workflow `.github/workflows/staging-smoke.yml` se ejecuta manualmente o mediante `workflow_call` tras un despliegue. Valida URL, headers CSP/HSTS, health, ausencia de secretos en respuestas, smoke funcional y Playwright.

## Rollback manual aprobado

El rollback se ejecuta exclusivamente mediante `.github/workflows/staging-rollback.yml`:

1. Abrir **Actions → Manual staging rollback → Run workflow**.
2. Introducir `target_tag` con el tag anotado anterior validado, por ejemplo:
   `prod-20260829-0001-a1b2c3d`.
3. Introducir la URL HTTPS de staging.
4. Esperar la aprobación del environment protegido `staging-rollback-approval`.
5. El job aprobado ejecuta exclusivamente `scripts/staging-rollback.mjs` dentro del environment `staging`.
6. Se ejecutan de nuevo los checks HTTP de staging.

### Guardas de selección

El workflow rechaza:

- `latest` o tags arbitrarios;
- SHA sin prefijo `prod-`;
- nombres que no coincidan con `prod-YYYYMMDD-HHMM-<sha>`;
- tags inexistentes;
- tags ligeros/no anotados;
- tags que no resuelvan a un commit;
- URLs HTTP o dominios de producción.

La selección es explícita para evitar que un rollback manual elija accidentalmente el despliegue actual. No se ejecuta rollback automático ni se toca producción.

## Configuración requerida en GitHub

Environment `staging`:

- `STAGING_URL` como variable.
- `DEPLOY_COMPOSE_FILE` queda fijado por el workflow a `docker-compose.staging.yml`.
- `IMAGE_TAG` y `TARGET_TAG` se pasan como variables de entorno validadas a scripts versionados; no se ejecutan comandos arbitrarios desde secretos.

Environment `staging-rollback-approval`:

- Revisores requeridos configurados en **Settings → Environments**.
- Sólo el equipo de operaciones puede aprobar.

El rollback usa directamente el entrypoint versionado `scripts/staging-rollback.mjs`, que fuerza `docker-compose.staging.yml` y valida `TARGET_TAG` antes de invocar Docker.

Los scripts versionados deben permanecer restringidos al entorno de staging y no deben usar `:latest`.

## Proveedor AI local opcional (Ollama)

Ollama es un proveedor **de cliente**: la app lo llama desde el navegador con la URL que
el usuario configura en Ajustes. No forma parte del stack de staging. El perfil
`ai-local` que vivía en `docker-compose.staging.yml` existía para alimentar el upstream
del api, y ese upstream se retiró junto con el proxy de IA; ya no queda ningún consumidor
en el stack.

Para ejercitarlo, ejecuta Ollama donde el navegador pueda alcanzarlo (lo habitual es el
host) y apunta el proveedor Ollama de la app a esa URL. Ojo con el contenido mixto: si
sirves la app por HTTPS, una URL `http://` de Ollama se bloquea — usa `http://localhost`
(exento) o sirve Ollama por HTTPS.

### Contrato probado

`npm run test:ollama-contract` valida contra cualquier servidor Ollama (local o contenedor):

- `/api/tags` responde 200 y lista el modelo esperado (o al menos uno instalado);
- `/api/generate` responde 200 con `response` string no vacío y `done=true`;
- timeout acotado por `--timeout` (default 120s).

No exige literalidad del texto generado (los LLM no la garantizan) — sólo estructura,
disponibilidad y tiempo.
