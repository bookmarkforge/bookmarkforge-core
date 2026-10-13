# ADR-065: Single Source of Truth for Host Route Configs

**Status:** Proposed  
**Date:** 2026-10-12

## Context

BookmarkForge is deployed on 4 platforms (Vercel, Netlify, Cloudflare Pages, Nginx/Docker), each with its own route configuration file:
- `vercel.json` (Vercel)
- `netlify.toml` (Netlify)
- `public/_redirects` (Cloudflare Pages)
- `public/nginx.conf` (Nginx self-hosted)

Every time a new application route is added, the 4 files must be updated manually. The gate `check:spa-routes` verifies that they are synchronized, but manual maintenance is error-prone.

## Decision

**Keep the gate `check:spa-routes` as the current solution** (Option A), with a plan to implement automatic generation in the future (Option C).

### Current Solution

- Keep `check:spa-routes` in `npm run check:security-internal`
- The gate verifies that the 4 files are synchronized with `scripts/app-routes.mjs`
- It is acceptable for the current route volume (~20 app routes)

### Future Improvement

Implement `scripts/generate-host-configs.mjs` which:
1. Reads the routes from `scripts/app-routes.mjs` (single source)
2. Automatically generates `public/_redirects`
3. Automatically generates the route sections of `vercel.json`
4. Automatically generates the route sections of `netlify.toml`
5. Automatically generates the location blocks of `public/nginx.conf`
6. Runs as part of `npm run build:ci`

## Consequences

- **No new implementation required:** the decision needs no new code right now.
- **Drift protection:** the gate keeps the four files aligned without ongoing manual effort.
- **Documented future path:** the future improvement (Option C) has its shape, entry points and decision criteria recorded here.

## Negatives

- **Manual maintenance:** four files to touch every time an application route is added or changed.
- **Operational load:** the difference is small at low route counts, but it is a class of error that repetition tends to introduce.
- **Proposed but not adopted:** the ADR stays in Proposed until the future improvement is executed or removed from the registry, so a reader may treat it as a commitment that is not yet a rule.

## Alternatives Considered

1. **Remove the gate (Option B):** less overhead, but higher risk of drift in production.
2. **Immediate automatic generation (original Option C):** better technical solution, but requires complex implementation of TOML/Nginx parsers.

## When

Run the future improvement when:

- The application route volume grows significantly (proposed threshold: more than 50 routes).
- A new hosting platform is added and its routing artifact needs a similar section.
- The manual cost of maintaining the four files becomes visible in maintenance data.

Keep this ADR in Proposed until Option C is adopted or removed from the registry, at which point its Status is changed and the future-action document is cleared.
### Positives
- **No new implementation required:** the decision needs no new code right now.
- **Drift protection:** the gate keeps the four files aligned without ongoing manual effort.
- **Documented future path:** the future improvement (Option C) has its shape, entry points and decision criteria recorded here.

### Consequences

Positives:

- The decision needs no new code right now.
- The gate keeps the four files aligned without ongoing manual effort.
- The future improvement (Option C) has its shape, entry points and decision criteria recorded here.

Negatives:

- Four files to touch every time an application route is added or changed.
- The difference is small at low route counts, but it is a class of error that repetition tends to introduce.
- The ADR stays in Proposed until the future improvement is executed or removed from the registry, so a reader may treat it as a commitment that is not yet a rule.

## Alternatives Considered

1. **Remove the gate (Option B):** less overhead, but higher risk of drift in production.
2. **Immediate automatic generation (original Option C):** better technical solution, but requires complex implementation of TOML/Nginx parsers.

## When

Run the future improvement when:

- The application route volume grows significantly (proposed threshold: more than 50 routes).
- A new hosting platform is added and its routing artifact needs a similar section.
- The manual cost of maintaining the four files becomes visible in maintenance data.

Keep this ADR in Proposed until Option C is adopted or removed from the registry, at which point its Status is changed and the future-action document is cleared.
1. **Remove the gate (Option B):** less overhead, but higher risk of drift in production
2. **Immediate automatic generation (original Option C):** better technical solution, but requires complex implementation of TOML/Nginx parsers

## When

Run the future improvement when:

- The application route volume grows significantly (proposed threshold: more than 50 routes)
- A new hosting platform is added and its routing artifact needs a similar section
- The manual cost of maintaining the four files becomes visible in maintenance data

Keep this ADR in Proposed until Option C is adopted or removed from the registry, at which point its Status is changed and the future-action document is cleared.
1. **Remove the gate (Option B):** less overhead, but higher risk of drift in production.
2. **Immediate automatic generation (original Option C):** better technical solution, but requires complex implementation of TOML/Nginx parsers.

## When

Run the future improvement when:

- The application route volume grows significantly (proposed threshold: more than 50 routes)
- A new hosting platform is added and its routing artifact needs a similar section
- The manual cost of maintaining the four files becomes visible in maintenance data

Keep this ADR in Proposed until Option C is adopted or removed from the registry, at which point its Status is changed and the future-action document is cleared.