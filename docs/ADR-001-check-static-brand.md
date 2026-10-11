# ADR-001: Register `check:static-brand` in the pipeline

- **Status:** accepted
- **Date:** 2026-08-29

## Context

The `npm run check` pipeline runs `check:static-brand`, which validates that
static brand tokens do not drift from inconsistent styles nor introduce
unreviewed visual drift.

## Decision

It is considered a project quality/meta gate and is explicitly registered in the
inspector freeze. It must keep running in CI and in the local pre-release
verifications.

## Consequences

Visual identity changes that break this gate must deliberately
update the tokens and their tests. The registration prevents the gate from
appearing as an ungoverned validation.
