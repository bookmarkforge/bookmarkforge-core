# Staging post-deploy smoke and rollback

## Smoke tests

The workflow `.github/workflows/staging-smoke.yml` runs manually or via `workflow_call` after a deployment. It validates URL, CSP/HSTS headers, health, absence of secrets in responses, functional smoke and Playwright.

## Approved manual rollback

Rollback is executed exclusively via `.github/workflows/staging-rollback.yml`:

1. Open **Actions → Manual staging rollback → Run workflow**.
2. Enter `target_tag` with the previous validated annotated tag, for example:
   `prod-20260829-0001-a1b2c3d`.
3. Enter the staging HTTPS URL.
4. Wait for approval of the protected environment `staging-rollback-approval`.
5. The approved job executes exclusively `scripts/staging-rollback.mjs` inside the `staging` environment.
6. Staging HTTP checks run again.

### Selection guards

The workflow rejects:

- `latest` or arbitrary tags;
- SHA without `prod-` prefix;
- names that do not match `prod-YYYYMMDD-HHMM-<sha>`;
- non-existent tags;
- lightweight/non-annotated tags;
- tags that do not resolve to a commit;
- HTTP URLs or production domains.

Selection is explicit to avoid a manual rollback accidentally choosing the current deployment. No automatic rollback is executed nor production is touched.

## Required GitHub configuration

Environment `staging`:

- `STAGING_URL` as variable.
- `DEPLOY_COMPOSE_FILE` is fixed by the workflow to `docker-compose.staging.yml`.
- `IMAGE_TAG` and `TARGET_TAG` are passed as validated environment variables to versioned scripts; no arbitrary commands are executed from secrets.

Environment `staging-rollback-approval`:

- Required reviewers configured in **Settings → Environments**.
- Only the operations team can approve.

The rollback uses directly the versioned entrypoint `scripts/staging-rollback.mjs`, which forces `docker-compose.staging.yml` and validates `TARGET_TAG` before invoking Docker.

Versioned scripts must remain restricted to the staging environment and must not use `:latest`.

## Optional local AI provider (Ollama)

Ollama is a **client** provider: the app calls it from the browser with the URL the user configures in Settings. It is not part of the staging stack. The `ai-local` profile that lived in `docker-compose.staging.yml` existed to feed the api upstream, and that upstream was retired together with the AI proxy; there is no longer any consumer in the stack.

To exercise it, run Ollama where the browser can reach it (usually the host) and point the app's Ollama provider to that URL. Watch out for mixed content: if you serve the app by HTTPS, an `http://` Ollama URL is blocked — use `http://localhost` (exempt) or serve Ollama by HTTPS.

### Tested contract

`npm run test:ollama-contract` validates against any Ollama server (local or container):

- `/api/tags` responds 200 and lists the expected model (or at least one installed);
- `/api/generate` responds 200 with non-empty `response` string and `done=true`;
- timeout bounded by `--timeout` (default 120s).

It does not require literalness of generated text (LLMs do not guarantee it) — only structure, availability and time.
