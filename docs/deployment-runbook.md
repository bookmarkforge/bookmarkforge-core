# Production deployment runbook — A11-2 closure

This runbook is the operational list to replace the legacy deployment of
`bookmarkforgeapp.com` with the current checkout. It does not execute DNS, `git push`,
Docker or remote changes by itself.

## 0. Exit criterion

Deployment is only considered closed when all these probes return the indicated
result from the public domain:

| URL | Expected result |
|---|---|
| `/` | `200`, EN landing, canonical `https://bookmarkforgeapp.com/` |
| `/ar/`, `/bg/`, `/zh/` | `200`, localized landing, own canonical |
| `/ar.html`, `/es.html` | Must not be canonical URL; may serve internal artifact |
| `/privacy-and-terms.html`, `/ar/privacy-and-terms.html` | `200`, legal with canonical/hreflang |
| `/sitemap.xml` | `200`, exactly 61 URLs |
| `/robots.txt` | `200`, includes sitemap and `Disallow` of private surfaces |
| `/app` | `200` or application fallback, but `noindex` |
| `/health` | `200` from API, no secrets in response |

While any probe returns legacy converter or `404`, A11-2 remains open and sitemap
is not sent to Search Console.

## 1. Local preflight (mandatory)

From the checkout to be deployed:

```bash
npm ci
npm run typecheck
npm run check
npm run check:launch-checklist:strict
npm run check:sitemap-coverage
npm run check:nginx-render
```

Preserve logs and exact SHA. Deployment command must be executed with a clean
tree and from the same SHA that is tagged:

```bash
git status --short
git rev-parse HEAD
```

## 2. Variables and secrets

Configure in production environment, never in repository:

- `NODE_ENV=production`.
- `AI_SESSION_ORIGINS=https://bookmarkforgeapp.com` — historical name of the
  allow-list of `/api/license/entitlement`.
- `ENFORCE_SIGNAL_HMAC=1`.
- `LICENSE_SIGNING_PRIVATE_KEY_FILE` via secret manager or read-only volume.
- `LICENSE_PUBLIC_KEY_SPKI` consistent with committed public key.
- `TRUST_PROXY` only if proxy in front is controlled by operator.
- `WHOP_LICENSE_API_URL` and `WHOP_API_KEY`, if licenses are enabled.
- `CLIENT_EVENTS_IP_HASH_SALT` and any real operational webhook.
