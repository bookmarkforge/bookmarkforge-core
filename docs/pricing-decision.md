# PRICING DECISION — BookmarkForge v1

**Status: APPROVED AND FROZEN** · Date: 2026-09-14 · Authority: the product owner

---

## 1. The decision

BookmarkForge is sold as a **versioned lifetime license, no subscriptions**.
These are the final, official launch prices:

| Tier | Price | Note |
|---|---|---|
| **Free** | **$0** | Forever. 2,500 bookmarks, no device limit (each device has its own vault). 7-day trial of Pro features. No expiry. |
| **Pro Early Bird** | **$59** | Only the first **200** buyers. `priceValidUntil: 2026-12-31`. |
| **Pro Regular v1** | **$79** | The official v1 price after Early Bird sells out (6-12 months). |
| **v2.0 (future, 12-18 months)** | **$89 new / $35 v1 owners** | 60% off recorded in the legal terms. That is how recurring revenue arises without a subscription. |
| **v3.0 (future)** | **$99 new / $39 owners** | Same pattern. |

## 2. Why these numbers (the reasoning frozen with them)

- **$59 early bird:** low enough to drive launch momentum, high enough not to
  devalue encryption + local AI. Real FOMO with 200 units.
- **$79 regular:** anchors just below the psychological $100. It equals 2 years
  of Raindrop or 1.3 years of Instapaper — "pay once vs $96-120/year" is the
  message. It is the price defended against competitors verified in 2026.

- **v2 at 60% off:** recurring revenue without a subscription. 1,000 v1 buyers
  at $79 → $79k in year 1; if the current 30% upgrades to v2 at $35 → +$10.5k
  without acquiring a single new customer.
- **Rejected:** $49 (devalues the product), a monthly subscription (betrays the
  local-first audience, competes against Raindrop at $3/month and loses),
  Starter/Team tiers (choice paralysis with 0 segmentation data).

## 3. Price phases and their triggers

| Phase | Pro |  | When it activates |
|---|---|---|---|
| **Early** (active) | $59 | $99 | Launch → sell out 200 units or 2026-12-31 |
| **Regular** (next) | $79 | $99 | When Early Bird sells out. Change `earlyBird.phase: "regular"` in `src/constants/pricing.ts` |
| **Full** (optional) | $99 | $129 | Only after 500+ positive reviews and data; a manual, not automatic, decision |

**Phase change procedure** (10 min): edit `earlyBird.phase` in
`src/constants/pricing.ts` → regenerate the pricing OG image
(`og-image-pricing`) → update the landings if the copy changes → commit +
deploy. The flag is designed to be a one-line change.

## 4. What this is NOT (so the debate is not reopened)

- **It is not a subscription.** Nothing expires. The anchoring legal sentence
  lives on the landing, in `privacy-and-terms` and in the JSON-LD.
- **It is not "the user's lifetime".** It is **major-version lifetime** —
  legal text: *"Lifetime license for BookmarkForge v1. Includes all v1.x updates
  and 12 months of feature updates. Security updates forever. Future major
  versions (v2, v3) 60% off for existing owners. 30-day refund via Whop."*
- **No tiers are added** until 300-500 sales with real data (Family, AI Plus,
  etc. — all of that is post-traction).

## 5. Price change log

| Date | Change | Reason |
|---|---|---|
| 2026-09-14 | Initial decision frozen: Free $0 / Pro $59→$79 /  $99 / v2 $89/$35 | v1 launch |
| 2026-09-16 | The public Core becomes MIT; Pro components stay proprietary | Open Core decision (see §6) |

## 6. Public repo license decision — CLOSED

**Status: APPROVED AND FROZEN** · Date: 2026-09-14 · Revisable only together
with a full pricing review (the 50-sales rule, §4).

**Decision:** the public Open Core repository is published under **MIT**. The
private checkout may contain proprietary Pro components, but the exporter
strips them and writes a manifest with `license: "MIT"`. The brand (name, logo
and domains) stays outside the MIT grant via `NOTICE` + `TRADEMARKS.md` in the
public export.

**Why MIT for the Core and a proprietary license for Pro:**

- **Core adoption:** MIT lowers friction for users, forks and contributions to
  the core.
- **Explicit commercial separation:** Pro features ship outside the public
  export under `PRO-LICENSE.md`.
- **Trademark protection:** the name and logo are reserved via `TRADEMARKS.md`;
  a software license does not substitute for trademark registration.
- **Operational control:** the exporter and `check:open-core` fail if a Pro
  file reappears in the public tree.

**Artifacts of this decision (via `scripts/export-public-repo.mjs`):**

- `LICENSE` — the Core's MIT text.
- `NOTICE` — copyright, Core scope and an express reservation of the brand.
- `TRADEMARKS.md` — trademark policy: nominative use allowed, forks with their
  own name and logo allowed.
- `manifest.json` — the license and the list of excluded Pro components.

**Owner pending (outside the repo):** trademark registration at OEPM (~€150,
Spain) and EUIPO once there are European sales — it is the only absolute
blocker against competing forks using the name/logo.

---

*Any future change to these prices requires: (1) updating `src/constants/pricing.ts`, (2) regenerating the landings + OG if applicable, (3) updating this change log table, (4) updating the legal terms if it affects the lifetime contract.*