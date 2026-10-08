# ADR-040 — Unified Markdown documentation gate

## Status

Accepted

## Date

2026-09-19

## Context

The repository maintains operational, legal, historical and localized
documentation. The separate checks for heading hierarchy, list style, metadata
and the ADR template could diverge and allowed part of the corpus to end up
without coverage after a documentation retirement.

## Decision

`check:docs-markdown` is the only Markdown-format gate. It scans only the documents present
in `docs/`, compares against a reviewed baseline and detects silent
coverage reduction. The ADR template is validated with the same ESLint rule used by
general lint. The documentation index records each document's presence and
state.

## Consequences

Deleting documents is no longer treated as an accidental baseline change: it must be
accompanied by a documented decision and an index review. Critical operations,
security and compliance documents must be kept or replaced by equivalents. The
gate can be extended when there is an explicit review of its baseline.
