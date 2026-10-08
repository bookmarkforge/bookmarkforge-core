# Edge-case hardening for the vault and operational audit

Status: expert draft, pending human validation.
Scope: reduce the surface of ambiguous behavior in
`src/services/SecurityVault.ts`, `src/services/security/AttestationChain.ts`
and the associated audit log.

## 1. What is good and should not be touched without reason

- Password verification with separate HMAC integrity layer.
- Constant-time comparisons at critical points.
- Rate-limit with explicit lockout in unlock, verifyRateLimited and decryptShare.
- Device key materialization/dematerialization with decision based on wrapped blob, not just a boolean.
- Re-signing of attestation chain after password rotation.
- Fail-closed behavior at points where the key is not available.

This is mature on the surface. It is not "rewrite from scratch"; it is reducing fuzzy edges.

## 2. Behaviors an expert would mark as operationally ambiguous

### 2.1 Fire-and-forget audit
There are audit entries that are logged without guaranteeing that the log has resolved. This is fine as a low-impact proposal, but it turns the audit into a mechanism whose absence is not necessarily observable or correlatable in prod.

Recommended action: make clear which events are "operation audit" and which are "security audit". Critical security events should have an explicit observable detection path (not rely only on "they will be written someday").

### 2.2 Best-effort persistence of attestation chain
Both re-signing and chain persistence have silent/limited degradations when IndexedDB fails. This makes sense to not block user operation, but it also means the chain can be out of sync between memory and disk under error conditions.

Recommended action: document acceptable degradation states and what "chain is valid for session but not persisted" means. Leave an explicit diagnostic trace, not just a warn.

### 2.3 Legacy password trim behavior
`unlock()` uses `password.trim()` and there are notes about legacy compatibility. `rotateMasterPassword()` rejects passwords with spaces. This creates a real practical effect: a user can continue unlocking with something that technically should not be rotatable without adjustment.

Recommended action: explicitly document the relationship between unlock input form and the canonical rotated password form. If future cleanup is desired, it should be a conscious decision, not an implicit difference between paths.

### 2.4 Recovery and rotation
The vault has deliberate behavior regarding the device key blob, verification token and recovery. This is fine, but it also means rotation, deletion and recovery touch several different stores and a partial failure can leave orphan artifacts without an ordered rollback.

Recommended action: ensure there is a diagnostic mode that allows seeing which records are present after a failed rotation or recovery attempt, without exposing secrets.

### 2.5 Observability in prod without secrets
The expert's correct stance is that logs and audit should not expose sensitive material. This must be explicit, not accidental. Must verify that messages, contexts and external reports are designed not to leak derived state, salt, nonce, session tokens or ciphertext fragments.

## 3. Concrete plan I propose

1. Leave a list of "critical" audit events and another of "operational" ones.
2. Ensure critical ones have an explicit detection form for log loss.
3. Unify the fallback policy in the attestation chain and document what each degradation level means.
4. Document the legacy trim/space semantics and the effect on rotation.
5. Add an internal log review rule: all logging related to cryptography or vault must pass through a human reviewer or automatic rule that rejects risky structured outputs.
6. Put a validation gate before any change in rotation, wrap/unrap and recovery, with test cases simulating persistence failures, not just happy paths.

## 4. What I would not do without more context

- I would not delete or alter the current attestation chain without seeing test cases and rollback flows.
- I would not touch the rate-limit policy or vault behavior without an analysis of which users and flows depend on each path.
- I would not move vault logic to the server without clearly defining the existing trust boundary relationship.

## 5. How to validate it

The reasonable approach is:
- human review of the points above;
- static verification and fast test runs before touching the vault;
- and, if anything in persistence or rotation is modified, a drill with simulated failure, not just success.

EOF
