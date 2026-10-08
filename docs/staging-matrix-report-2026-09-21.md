# Staging matrix report — 2026-09-21

## Scope

The isolated local staging matrix was executed without touching production:

- `/health` of the companion server.
- HTTP/API surface and client events.
- WebSocket signaling handshake.
- License activation and cycle.
- Encrypted and clear backup/restore.
- Production build and critical-path smoke with Chromium.
- WebRTC certification according to the available Playwright report.

## Results

| Area | Result | Evidence |
|---|---:|---|
| Production build | PASS | `npm run launch:smoke:prod` |
| Critical paths | PASS | 7/7 Playwright: vault, recovery, license and backup |
| Local `/health` | PASS | `npm run local-smoke`: HTTP 200, `{ status: "ok" }` |
| Served frontend CSP/COOP | PASS | production smoke: CSP present and COOP `same-origin` |
| Client events | PASS | `/api/client-events` accepts `csp-violation-spike` with HTTP 204 |
| WebSocket signaling | PASS | handshake `join` → `joined` against `ws://127.0.0.1:8787` |
| Mock license cycle | PASS (historical) | 21/21 checks with `license-smoke` harness, which does not exist in this tree: evidence not reproducible today |
| Real critical path license | PASS | valid and invalid activation in `launch-smoke:prod` |
| Encrypted backup `.bmf` | PASS | restore and data verification; RTO 4.242 s |
| JSON backup | PASS | restore and data verification; RTO 4.110 s |
| WebRTC certified | PASS | Chromium, Firefox and WebKit: 3/3 contracts passed |
| Local load test | PASS | 5/5 budgets; join p95 20 ms, relay p95 1 ms, saturation 1013 |
| Typecheck/lint | PASS | `npm run typecheck:prod` and `npm run lint` |
| Policy tests | PASS | 3/3 staging tests |

## Corrections made during drill

- `scripts/drill-backup-restore.mjs`: replacement of the `npx.cmd` shim, which failed with `EINVAL` on Windows, by direct invocation of the local Playwright CLI.
- `scripts/local-smoke.mjs`: ordered shutdown of child processes and wait for WebSocket close; avoids the libuv assertion that caused exit 127 after successful checks on Windows.

## Evidence limitations

- `check:staging-http` requires `STAGING_URL` HTTPS and was not executed against a remote domain because no staging endpoint was provided. Therefore, there is still no external evidence of HSTS or reverse proxy headers.
- The `local-smoke` did not activate license against a local private key because the gitignored signature file was not configured; the mock cycle passed and the production critical-path did exercise the real signature service of the smoke environment.
- The WebRTC certification validates the available nightly Playwright report; it does not replace a new multi-browser execution against a public endpoint with TURN.

## Go/No-Go decision

**GO for isolated local staging.**

**NO-GO to declare production verified yet**, until executing with a real HTTPS endpoint:

```bash
STAGING_URL=https://staging.example.com npm run check:staging-http
PROD_BASE_URL=https://staging.example.com npm run production-smoke
# Real sandbox/Whop license: no harness in this tree (`license-smoke` does not exist).
# Local reproducible cycle of mock adapter: npm run launch:smoke
```

The WebRTC drill must also be repeated from at least two external networks and the report kept as a release artifact.

## Additional internal validation

The non-external block also passed:

```text
npm run check:launch-checklist:strict  ✅ 12/12 verifiable; 5 manual
npm run check:security-internal       ✅
npm run test:fast                     ✅ 156 files, 3,099 tests executed, 1 documented skip
npm run check                         ✅
npm run test:load                     ✅ 5/5 budgets
```

The five manual checklist checks are operational responsibilities or external validations, not defects detectable from the repository.
