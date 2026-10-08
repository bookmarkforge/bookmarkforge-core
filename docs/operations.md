# Operations and continuity

## SLOs

- Companion server target availability: **99.9% monthly**.
- Healthcheck `/health`: p95 under 500 ms under normal load.
- WebSocket signaling: p95 relay under 1 s under normal load.

## RPO and RTO

- **RPO:** 24 hours for configured operational backups; local vault depends on user export.
- **RTO:** 2 hours to restore companion server and its configuration from backed-up images and secrets.
- Vault primary data remains locally on user device; server does not store vault content.

## Backups and restoration

Backup/restore drills run with `npm run drill:backup-restore`. Each execution must preserve evidence of duration, result and any RTO deviation. License keys and deployment secrets are restored from secret manager, never from repository.

## Incidents

1. Confirm incident via `/health`, authenticated admin logs and metrics.
2. Contain: limit traffic, isolate affected service or activate rollback.
3. Preserve logs and artifacts without including vault content or credentials.
4. Restore from last verified image and run smoke checks.
5. Register root cause, impact, observed RPO/RTO and preventive actions.

## Releases and rollback

Every release must pass typecheck, lint, tests, build, security audits and configuration checks. Rollback uses Docker images tagged by commit and must not modify user data.

## Push and branch tracking

`main` is the integration branch and its upstream is `origin/main`. Tracking is set once and without network dependency, because configuration lives in local repository:

```bash
git config --local branch.main.remote origin
git config --local branch.main.merge refs/heads/main
```

While the clone does not have the remote ref, `git status -sb` shows `## main...origin/main [gone]`: tracking is configured, but the ahead/behind counter only becomes operational when a fetch or authenticated push materializes `origin/main`. Publication flow:

```bash
git remote -v                  # confirm destination before anything
npm run check:ci               # typecheck:prod + lint + test:fast + build:ci + check
git ls-remote origin           # test credentials without publishing anything
git push -u origin main
gh run list --limit 10         # runs triggered by push
```

Operational rules:
