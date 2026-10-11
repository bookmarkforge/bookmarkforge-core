# ADR-060: GDPR consolidation gate (`check:legal-consolidation`)

- **Status:** Accepted (2026-09-19)
- **Date:** 2026-09-19
- **Related:** [ADR-028 — Gate drift detection](ADR-028-gate-drift-detection.md), [ADR-059 — Controlled documentation retirement](ADR-059-documentation-retirement.md)

## Context

The operational personal-data-breach procedure lived only in the private templates of `legal/plantillas/` (Art. 33 notification to the authority, Art. 34 communication to data subjects and breach checklist), while `docs/security.md` —the operational reference the team reads— reduced incidents to two generic sentences. The 2026-09 mass documentation retirement showed the risk: ADR-059 forbids compliance material from disappearing without an equivalent replacement, and restoring the corpus left the consolidation without a verification mechanism.

The concrete failure this gate prevents is the one ADR-028 defines as *gate drift* in its documentary variant: the consolidated section of `docs/security.md` loses —through editing, refactoring or future retirement— the 72-hour clock, the reference to the Art. 33/34 templates or the rule about not requesting secrets from users, and the real incident procedure ends up without documentary coverage with nothing failing. That is exactly the class of loss that made ADR-059's "equivalent replacement" clause necessary, today protected only by manual review.

The same review found the same pattern one step earlier: `legal/plantillas/README.md` advertised four templates that were never written (processing agreement, international transfers, Whop confirmation and per-processor privacy sheet), while the vendor rows of `legal/REGISTRO.md` assumed those tools existed. Promised and missing material, with nothing detecting it, is again the loss ADR-059 forbids.

## Decision

The gate `npm run check:legal-consolidation` (`scripts/check-legal-consolidation.mjs`), integrated into the `check` chain in the security block (after `check:server-log-ip-privacy`), is implemented to verify:

1. **Consolidated section:** `docs/security.md` keeps the `### Procedimiento de violación de datos personales (RGPD)` heading with the 72-hour clock, the three template paths and the recovery-phrase rule.
2. **Templates intact:** the seven templates in the legal workspace exist, exceed a minimum size (a template emptied by an accidental deletion cannot pass) and keep their legal anchors. The anchor comparison is case-insensitive: legal prose capitalizes them freely in headings and sentence openings, so what must survive is their presence, not their spelling.
3. **Incident register:** `legal/REGISTRO.md` remains present as the reference repository.
4. **Fail-closed on secrets:** no draft template contains apparent credentials (JWTs, provider keys, long opaque blobs); the templates are drafts and must stay free of real data.
5. **Contract-workspace templates:** besides the three breach ones, it requires the four the vendor rows need (`DPA-proveedor.md`, `SCC-transferencia-internacional.md`, `confirmacion-Whop.md` and `revision-privacidad-proveedor.md`), each with its own anchors: `Art. 28 RGPD`, `subprocesadores` and `medidas de seguridad` in the processing agreement; `Cláusulas Contractuales Tipo`, `EEE` and `evaluación de transferencia` in the transfer review; `merchant of record`, `IVA` and `payouts` in the merchant confirmation; and `minimización`, `retención` and `subprocesadores` in the per-processor sheet. <!-- i18n-allow -->

The logic is a pure function (`runLegalConsolidationChecks`) over in-memory fixtures, with the CLI wrapper doing the I/O — the same pattern as `check:csp-sync.mjs` — so that `scripts/__tests__/check-legal-consolidation.test.mjs` drives the gate with complete corpora, mutilated sections, gutted templates and injected secrets.

## Consequences

- Consolidation of the GDPR procedure into operational documentation becomes verifiable in CI; losing any piece of the replacement equals breaking the gate.
- The gate also covers the contract workspace: a template advertised and never written, or emptied afterwards, breaks CI just like losing the Art. 33 notification. The register can keep citing tools that really exist.
- The gate does not validate the legal accuracy of the templates (that still requires a professional review, as `legal/plantillas/README.md` already demands); it verifies presence, structural integrity and absence of secrets.
- Legitimate edits to the procedure update the freeze test together with the content, with the diff reviewed in the PR.
- It meets ADR-028's two criteria: the failure is a verifiable divergence (consolidated compliance material vs actual documentation) and the truth has single versioned sources (`docs/security.md` and `legal/plantillas/`).
