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

## Proveedor AI local opcional (Ollama, profile `ai-local`)

El compose de staging incluye dos servicios opt-in para CI determinista con un LLM real
en lugar del mock de Gemini:

- `ollama` — API de Ollama dentro de la red staging (sin puerto al host), con healthcheck.
- `ollama-pull` — one-shot: espera al healthcheck y descarga el modelo (default `llama3.2`,
  el mismo default de la app; sobreescribir con `OLLAMA_MODEL=<name>`).

### Activación

```bash
# levantar el stack con el proveedor local
docker compose --profile ai-local -f docker-compose.staging.yml up -d

# comprobar el modelo dentro de la red
docker compose --profile ai-local -f docker-compose.staging.yml run --rm ollama-pull

# prueba de contrato desde el host (reusa scripts/test-ollama-contract.mjs)
npm run test:ollama-contract -- --url http://127.0.0.1:11434 --model llama3.2
```

Sin el flag `--profile ai-local` los servicios no se crean y el stack sigue usando el
`ai-mock` de Gemini — el comportamiento por defecto no cambia.

### Cómo apuntar el smoke al proveedor local

El smoke del api (`runApiSurfaceChecks`) prueba el upstream configurado en el servicio
`api` (env `GEMINI_API_BASE`). Para ejercitar Ollama en un run determinista:

1. Levantar el stack con `--profile ai-local`.
2. Sobreescribir el upstream del api en el run:
   `GEMINI_API_BASE=http://ollama:11434/v1beta/models` (compatible a nivel HTTP con el
   mock; los checks de 401/200/SSE se comportan igual).
3. Ejecutar el smoke de staging normalmente; el api resuelve `ollama` por DNS de compose.

Nota: Ollama no requiere `x-goog-api-key`; si el smoke valida 401-sin-auth contra el
upstream, mantener ese check contra el `ai-mock` (que sí lo exige) y usar Ollama solo
para los checks de generación.

### Contrato probado

`npm run test:ollama-contract` valida contra cualquier servidor Ollama (local o contenedor):

- `/api/tags` responde 200 y lista el modelo esperado (o al menos uno instalado);
- `/api/generate` responde 200 con `response` string no vacío y `done=true`;
- timeout acotado por `--timeout` (default 120s).

No exige literalidad del texto generado (los LLM no la garantizan) — sólo estructura,
disponibilidad y tiempo.
