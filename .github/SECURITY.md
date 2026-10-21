# Security Policy

## Supported versions

We ship security fixes to the latest published version only. Update to the
current release before reporting.

## Reporting a vulnerability

**Please report privately.** Do not open a public issue for security problems.

- Email: **security@bookmarkforgeapp.com**
- Include: affected component, reproduction steps, impact, and (if possible) a
  proof of concept. Encrypt sensitive reports with our PGP key (published at
  `https://bookmarkforgeapp.com/.well-known/security.txt`).

We aim to acknowledge reports within **72 hours** and publish a fix or a
mitigation for accepted reports within **90 days**.

## Scope

In scope:

- The browser app (vault, crypto, sync client, importers, extension)
- The signaling server (`server/src`)
- The signaling, licensing and telemetry companion server

Out of scope:

- Social engineering of support or staff
- Denial-of-service by volume (rate limits handle it)
- Missing security headers on third-party hosts we don't control
- Automated scanner output without a demonstrated, reproducible impact

## Safe harbor

We consider good-faith research valuable and will not pursue legal action for
responsible disclosure that respects this policy.

## What zero-knowledge means for incidents

Vault content is encrypted client-side with a key derived from the user's
password (Argon2id). We never receive passwords, recovery phrases or vault
content — on purpose. That means **we cannot recover user data** after a lost
password + recovery phrase, and equally, a server-side breach exposes no vault
content. See `docs/security.md` for the control inventory.
