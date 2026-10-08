# Legal closing package — BookmarkForge (GDPR)

- **Purpose:** close point 5 of the [launch-checklist](launch-checklist.md): fill in the `⚠ PERSONAL DATA` fields of the [ROPA](ROPA.md) and sign/keep the DPA of each provider, in the correct order.
- **Audience:** the operator (you) or their legal advisor. This document is **operational, not a legal opinion**; final review by a professional remains step 3 of the checklist.
- **File convention:** create a private folder `legal/` (outside the public repo) with subfolders `ropa/`, `dpa/<provider>/`, `whop/`, `incidents/`. The public repo keeps templates; the file keeps signed copies with date. Never publish operator personal data in the repo.
- **Last updated:** 2026-09-15. Sources: ROPA §7/§8 (inventory), `server/src/license-server.ts` and `server/src/entitlement-endpoint.ts` (current license and entitlement surfaces), `netlify.toml`/`functions/` (static hosting), launch-checklist point 5.

---

## 1. Provider inventory — what actually needs to be signed

| # | Provider | Role per ROPA | What to do | Mechanism | Blocks |
|---|---|---|---|---|---|
| 1 | **Origin hosting** (Netlify for static already implicit in TOS; the **API/Node server origin** remains to be decided) | Processor (T3–T6) | Server host DPA. ⚠ Pending decision: if origin stays on Netlify Functions, Netlify DPA/CMR applies; if VPS (Hetzner, etc.), sign their DPA (Hetzner offers on demand) | Click-through / on request | Production deployment |
| 2 | **Google (Gemini API)** | **BYO-key from browser** (T1) — BookmarkForge does not transmit prompts: no AI proxy since 2026-09 | No operator credential to activate anymore. Accept **Cloud Data Processing Addendum** only if a server-key proxy is reintroduced in the future | Click-through in console | Does not block (BYO-key) |
| 3 | **Sentry (Functional Software, Inc.)** | Processor (T7) | Accept **Sentry DPA** (includes SCC 2021 module 3) — in console or by signing current version | Click-through on sentry.io | Configure operator DSN |
| 4 | **OpenAI** | Processor (T1 only if user brings their key; operator does not process, but landing names it) | Accept their **DPA** (portal: Settings → Legal → DPA; click-through with SCC) | Click-through | Does not block (BYO-key). Recommended before launch due to mention in policy |
| 5 | **Anthropic (Claude)** | Same | Accept **Commercial Terms + DPA** (auto-accepted when using commercial API; archivable version) | Acceptance by use | Does not block |
| 6 | **Groq** | Same | DPA referenced in their API terms; keep copy | Click-through | Does not block |
| 7 | **OpenRouter / Hugging Face** | Same | OpenRouter: terms with processor role; HF: DPA available + EU hub option | Click-through | Does not block |
| 8 | **Whop** | **Independent payment controller** — NO DPA (not a processor) | Sign/accept their **Merchant Agreement**; keep copy and their privacy page; verify role split (you = merchant, Whop = payment data controller) | Contract when creating account | **Real charges** (checklist point 7) |

**Golden rule:** each new provider is added to the ROPA §7 table **before** being activated in production (already required by ROPA §7, note 2). This table is the guide of *how*; the ROPA is the record.

---

## 2. What to fill exactly in the ROPA (fields `⚠ PERSONAL DATA`)

Complete list of pending fields, with location and how to fill them:

### §1 Controller (3 fields + 1 derived)

1. **Name / legal entity.** Two valid options:
   - Natural person: your first and last name + "BookmarkForge operator". Valid but exposes your identity to any user who requests it (Art. 13 requires giving controller identity). This is the price of operating without a company.
   - Company/self-employed: company name + CIF/NIF. Recommended if there are charges via Whop (merchant agreement asks for a billing entity).
   - Also fill the equivalent line in `public/privacy-and-terms.html` (§ controller identity) and `public/`policy of every locale — must match ROPA word for word.
2. **Address / seat.** That of the legal controller. If you are a natural person and do not want to publish your home address: a postal management address (professional mailbox) is an accepted practice if contact through that channel is real.
3. **Control authority.** That of the country of your seat. Examples: Spain → AEPD (www.aepd.es); Denmark → Datatilsynet; Germany → Land authority; Ireland → DPC. Write it with name + URL.
4. **§10 notification contacts** (derived): fill "control authority ⚠ PERSONAL DATA" with point 3.

### §3 Inventory (1 field)

5. **T6 deployment note:** "T6 requires confirming the log policy of the real deployment" → after first deployment, note: where logs run (VPS/Functions), actual rotation configured (≤ 30 days per logrotate or PaaS policy) and paste configuration fragment in `docs/operations.md`. Date and signature.

### §7 Processors (4 fields)

6. **Google (Gemini):** replace "⚠ PERSONAL DATA (contract clauses...)" with: "Google Cloud DPA accepted on DD/MM/YYYY (version DD/MM/YYYY), copy in `legal/dpa/google/`".
7. **OpenAI / Anthropic / Groq / OpenRouter / HF:** one line per provider with date + version + copy folder. Those you do NOT sign before launch: remove from row or mark "not offered by operator at launch; user can configure on their own account and risk (without operator DPA)" — consistent with T1 (consent given by user with their own key).
8. **Hosting:** after choosing origin: provider, datacenter seat (e.g. Hetzner — Nuremberg/Falkenstein, EU), mechanism (signed DPA / PaaS CMR), date.
9. **Sentry:** DPA acceptance date + version.

### §8 Transfers (1 maintenance)

10. **Certification validity:** in each quarterly review, verify that those listed (Google/OpenAI/Anthropic/Sentry in DPF; Groq/OpenRouter/HF in SCC) remain certified on dpf.dataprivacyframework.gov and note verification date.

### §12 Review (1 field)

11. **Responsible:** operator name/contact (same as §1).

**Closing criterion:** launch-checklist point 5 is marked `[x]` when the 11 points above are in the file and the ROPA copy in the file contains no remaining `⚠ PERSONAL DATA`.

---

## 3. What a valid DPA must have (checklist Art. 28(3))

Before accepting/signing any of the following, verify that the document covers the **five mandatory elements**:

1. **Subject and duration** of processing + nature and purpose + data categories and data subjects.
2. The processor processes only following **documented instructions** of the controller (incl. international transfers — see SCC/annexes).
3. **Confidentiality:** authorized personnel under confidentiality obligation.
4. **Security:** technical and organizational measures (Art. 32) — may reference an annex.
5. **Sub-processors:** general/specific authorization rules + current list + obligation to inform changes.
6. **Assistance** to the controller for data subject rights (Arts. 12–22) and for notifications (Arts. 32–36).
7. **On completion:** delete or return data.
8. **Audit:** allow contributing to audits/inspections.

Large DPAs (Google, Sentry, OpenAI) cover all this by construction — your job is **keep the version and date**, not negotiate. Template A (§6) exists for the rare case of a small provider without DPA (e.g. a self-hosted TURN from a friend, boutique hosting).

---

## 4. Signing order (with dependencies and timelines)

**Week 1 — in parallel (everything is click-through or request; ~1–2 h total work):**

| Day | Action | Why this order |
|---|---|---|
| 1 | **1. Hosting/origin** — decide where API server lives and sign its DPA | Everything else deploys there; it's the only technical blocker. If VPS like Hetzner: request DPA via panel (response 24–72 h) → **start on day 1** |
| 1 | **2. Google Cloud DPA** (click-through, 10 min) + create Gemini project/key | Requires having organization/personal account created; key is repo secret (secrets runbook) |
| 1 | **3. Sentry DPA** (click-through, 10 min) + create organization and copy DSN (not yet activated in production) | DSN ready for checklist point 8 without opening the tap |
| 2 | **4. OpenAI DPA** (click-through, 10 min) | Due to mention in published policy; the most visible of BYO-key |
| 2 | **5. Anthropic/Groq/OpenRouter/HF** (acceptance/archive, 20 min total) | Groupable; archive version+date of each |
| 3 | **6. Whop Merchant Agreement** + account and product configuration | Dependent on legal identity of §1 → fill §1 BEFORE this. Whop contract asks for billing entity and bank data |
| 3–5 | **7. Fill ROPA** (the 11 points of §2) with dates and copy paths | Needs signature dates of 1–6 |
| 5 | **8. Test purchase with refund** on Whop (checklist point 7) | Final piece: validates real charge circuit |

**Dependency rule:** legal identity (§1) → Whop; hosting → everything else on server; everything else → ROPA fill → checklist closure.

**External response timelines to watch:** hosting DPA by request (24–72 h), small provider support (days). That's why week 1 is parallel paperwork, not sequential.

---

## 5. Evidence to keep (per provider)

In `legal/dpa/<provider>/`:

1. Copy of accepted DPA (PDF or HTML saved with date) **and** of its SCC/annexes if they exist.
2. Screenshot or email confirming acceptance (click-throughs generate acceptance screen: capture it).
3. Line in signature register (template C, §6) with: provider, role, signature date, document version, version URL, mechanism, copy folder, next quarterly review date.
4. If provider notifies a sub-processor change (large ones do via email/public list): save notification and reevaluate in quarterly review.

---

## 6. Templates

### Template A — Generic DPA (Art. 28) for providers without their own document

> Data processing agreement (Art. 28 GDPR) between **[CONTROLLER — legal name of §1]** ("the Controller") and **[PROCESSOR — provider]** ("the Processor").
>
> 1. **Subject and duration:** the Processor will process, on behalf of the Controller, the personal data necessary for [contracted service: hosting of signaling server and application /-relay X], during the validity of the service contract.
> 2. **Nature, purpose, categories:** [e.g. storage and transmission of technical connection logs (IP address, user-agent, timestamps) and ephemeral WebRTC signaling metadata], for the purpose of providing and securing the service. Data subjects: BookmarkForge users.
> 3. **Instructions:** the Processor will process data only according to documented instructions of the Controller, including international transfers, which will require adequate safeguards (standard contractual clauses of Decision 2021/914).
> 4. **Confidentiality:** authorized personnel is subject to confidentiality obligation.
> 5. **Security:** measures of Art. 32 GDPR adequate to risk: [minimum: TLS encryption in transit, access control, access logging, backups].
> 6. **Sub-processors:** no sub-processor is authorized without prior written authorization from the Controller; the Processor will inform of any change 30 days in advance to allow reasoned objection.
> 7. **Assistance:** the Processor will assist the Controller in responding to data subject rights (Arts. 12–22) and in obligations of Arts. 32–36, to the extent possible.
> 8. **End of contract:** upon termination, the Processor will delete personal data and destroy media, except legal retention obligation, and certify deletion.
> 9. **Audits:** the Processor will allow and contribute to audits and inspections of the Controller or designated auditor, subject to prior agreement on reasonable scope and frequency.
>
> Signed: [Controller, date] / [Processor, date]

### Template B — DPA request email (for hosting/providers without form)

```
Subject: Data Processing Agreement (DPA) request — client [account number]

Hello,

We are customers of [provider] for [service] and, to comply with article 28
of GDPR, we need a valid data processing agreement between
[CONTROLLER — identity of §1] and [provider].

Could you send us your standard DPA (ideally with SCC 2021 as annex,
if transfer outside EEE is foreseen) for signature, or indicate the
procedure to accept it?

Thanks,
[Name, position, contact]
```

### Template C — File signature register (`legal/dpa/REGISTRO.md`)

| Provider | Role (ROPA) | Signed document | Doc version/date | Mechanism | Signed on | Copy in | Next review |
|---|---|---|---|---|---|---|---|
| [hosting] | Processor (T3–T6) | DPA + SCC | v…, DD/MM/YYYY | electronic signature | DD/MM/YYYY | `legal/dpa/hosting/` | [quarter] |
| Google | Processor (T1) | Cloud DPA | v…, DD/MM/YYYY | click-through | | `legal/dpa/google/` | |
| Sentry | Processor (T7) | DPA + SCC M3 | | click-through | | `legal/dpa/sentry/` | |
| OpenAI | Processor (T1, BYO-key) | DPA | | click-through | | `legal/dpa/openai/` | |
| Anthropic | Processor (T1, BYO-key) | DPA (Commercial Terms) | | acceptance by use | | `legal/dpa/anthropic/` | |
| Groq | Processor (T1, BYO-key) | DPA | | click-through | | `legal/dpa/groq/` | |
| OpenRouter | Processor (T1, BYO-key) | API terms (processor role) | | acceptance | | `legal/dpa/openrouter/` | |
| Hugging Face | Processor (T1, BYO-key) | DPA | | click-through | | `legal/dpa/hf/` | |
| Whop | **Independent controller** (T2) | Merchant Agreement | | account contract | | `legal/whop/` | |

### Template D — Example ROPA §7 row (NOT operational evidence)

| Processor | Role | Data | DPA contract | Seat / transfer |
|---|---|---|---|---|
| EXAMPLE — Hetzner Online GmbH | API origin hosting (T3–T6) | Connection logs, ephemeral signaling | Replace with real DPA and its date; this row does not confirm a signature | Example: Nuremberg datacenter (DE); confirm real seat and transfer |

---

## 7. Maintenance

- The signature register (template C) lives in the file; its **summary** (provider, date, validity) is reflected in ROPA §7/§8 in each quarterly review (§12 of ROPA).
- Extraordinary triggers (already defined in ROPA §12): new provider → new row here + in §7 before activation; seat change; incident; regulatory change.
- When retiring a provider: mark row as retired with date, keep DPA copy while processed data exist + prescription period.

## 8. Final reminders

1. The **public** repo never contains: legal identity, address, signed DPAs, keys. Only templates and procedures.
2. The published policy (`public/privacy-and-terms.html`), the ROPA and policy locales must cite the **same legal identity and same email** — a drift between them is exactly the type of drift the rest of the repo automates; here it's monitored manually in quarterly review.
3. If at launch only hosting + Google + Sentry + Whop are signed, it's a valid closure: remaining BYO-keys are documented as "configured by user under their own agreement with provider", which is the technical reality of the product.
