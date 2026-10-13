# Session sheet — P2P iPhone ↔ desktop drill (captures and order)

> **What it is:** the execution sheet to have at hand during the drill.
> The complete script with criteria and explanations is in
> [p2p-sync-manual-test-script.md](p2p-sync-manual-test-script.md); here only
> the **execution order** and **what to capture at each moment** so the
> session produces usable evidence (support, privacy marketing and
> post-mortem diagnostic if something fails).
>
> - **Duration:** ~40 min. **Print or open this sheet on a third device.**
> - Before starting: read the complete script once. During the session, DO NOT
>   improvise: if something deviates, capture and note — do not fix and continue.

---

## 0. Pre-session (before touching the app)

| # | Verification | Done |
|---|---|---|
| 0.1 | iPhone and desktop on the **same Wi-Fi** (not guest network) | |
| 0.2 | Both with the app in **HTTPS** and vault unlocked | |
| 0.3 | Desktop with **webcam** operational (test it on another site) | |
| 0.4 | iPhone with Safari with camera permission pending acceptance | |
| 0.5 | Paper and pen for the test title list | |
| 0.6 | Evidence folder created with naming convention: `p2p-<NN>-<what>-<device>.png` (e.g.: `p2p-05-sync-success-phone.png`) | |
| 0.7 | Note on paper: **iOS version**, iPhone model, desktop browser/version, network SSID |

**Test data (create and note exact titles):**
- Desktop: 2 bookmarks + 1 document with **DESK**
- iPhone: 2 bookmarks + 1 document with **PHONE**
- (Created on the fly in later sections: **SWAP**, **INC1**,
  **INC2**, **WINS-DESK**, **WINS-PHONE**, **DUPTEST**)

---

## 1. LAN warning (new) — BEFORE pairing (2 min)

> The app now warns of the same LAN requirement in the role selector.
> Verify on both devices: it is the user's first line of defense against
> the most common connectivity failure.

| # | Action | Expected capture |
|---|---|---|
| 1.1 | Desktop: Dashboard → "Secure P2P Sync" | Warning card visible: *"Both devices must be on the same Wi-Fi network"* + body + advice | `p2p-01-lan-warning-desk.png` **(already pre-captured** by `node scripts/capture-p2p-desk-drill.mjs`**)** |
| 1.2 | iPhone: same modal | The card in the **iPhone's language** (all 30 languages are translated — if it comes out in English with another system language, it is a finding) | `p2p-02-lan-warning-phone.png` |

---

## 2. Pairing #1 — desktop host (10 min)

| # | Moment | Capture |
|---|---|---|
| 2.1 | Offer QR on desktop | `p2p-03-offer-qr-desk.png` **(already pre-captured** by the script**; generates a new QR each session** — the one in the folder is from another session and expired) |
| 2.2 | iPhone after scanning: **its** answer QR | `p2p-04-answer-qr-phone.png` |
| 2.3 | "Syncing vaults..." bar halfway (either of the two) | `p2p-05-syncing.png` |
| 2.4 | "Sync Successful!" on **both** | `p2p-06-success-desk.png` + `p2p-07-success-phone.png` |
| 2.5 | iPhone showing **DESK** titles (bookmarks and documents) | `p2p-08-desk-items-on-phone.png` |
| 2.6 | Desktop showing **PHONE** titles | `p2p-09-phone-items-on-desk.png` |

**Note:** total pairing time (from QR to "Successful").

---

## 3. Roles inverted — iPhone host (5 min)

| # | Moment | Capture |
|---|---|---|
| 3.1 | iPhone as host showing its QR | `p2p-10-offer-qr-phone.png` |
| 3.2 | "Sync Successful!" on both | `p2p-11-success-swap.png` |
| 3.3 | **SWAP** bookmarks present on the opposite side | `p2p-12-swap-converged.png` |

---

## 4. Incremental sync (5 min)

| # | Moment | Capture |
|---|---|---|
| 4.1 | **INC1** (created on iPhone) visible on desktop | `p2p-13-inc1-on-desk.png` |
| 4.2 | **INC2** (created on desktop) visible on iPhone | `p2p-14-inc2-on-phone.png` |
| 4.3 | Edit of a **DESK** description propagated to iPhone | `p2p-15-edit-propagated.png` |

**Note:** any duplicate (same title twice = FAIL of section).

---

## 5. LWW conflicts and deduplication (8 min)

> Remember: 2-3 minutes between the two WINS edits for unambiguous
> timestamps. Note the EDIT ORDER BEFORE pairing.

| # | Moment | Capture |
|---|---|---|
| 5.1 | Your note on paper: "edited WINS-DESK first, WINS-PHONE after" | (paper) |
| 5.2 | After sync: BOTH devices showing the winner | `p2p-16-lww-winner-desk.png` + `p2p-17-lww-winner-phone.png` |
| 5.3 | The conflicting bookmark appears ONCE per vault | (visible in 16/17) |
| 5.4 | **DUPTEST** created on both: single entry after sync | `p2p-18-dedup.png` |
| 5.5 | DESK/PHONE/INC intact (no collateral damage) | (visible in 16/17) |

---

## 6. Real offline and cuts (7 min)

| # | Moment | Capture |
|---|---|---|
| 6.1 | Router without internet: full sync same as section 2 | `p2p-19-offline-success.png` |
| 6.2 | Cut halfway through bar (close modal on desktop) → visible error if any | `p2p-20-midcut.png` |
| 6.3 | Re-pairing after cut: complete without duplicates | `p2p-21-recovery-success.png` |
| 6.4 | Safari 10 s in background halfway through pairing → visible error (never false "completed") | `p2p-22-bg-interrupt.png` |
| 6.5 | Both vaults unlockable with data intact after all above | `p2p-23-vaults-intact.png` |

---

## 7. Network limits — what MUST NOT connect (5 min)

| # | Moment | Capture |
|---|---|---|
| 7.1 | iPhone on **mobile data**: pairing attempt → visible error/timeout | `p2p-24-mobiledata-error.png` |
| 7.2 | Back to LAN → sync works (no broken state) | `p2p-25-back-on-lan.png` |

**The value of 7.1:** together with `p2p-02`, demonstrates that the user is warned
BEFORE (LAN card) and that failure outside LAN is visible, not a hang.

---

## 8. iOS findings (capture ALWAYS if they occur)

- [ ] "WebRTC is not supported" banner on iPhone → **BLOCKING**, capture
      `p2p-30-webrtc-unsupported.png` and note iOS version.
- [ ] Camera fails in installed PWA but works in Safari → capture
      `p2p-31-pwa-camera.png`; document "pair from Safari".
- [ ] QR that desktop webcam cannot read (optics): note it, not code.
- [ ] Any error with empty text, in English on a system in another language,
      or a hang without message → capture + description of exact step.

---

## After finishing the session (15 min)

1. Fill the results table of the
   [P2P script](p2p-sync-manual-test-script.md) (6 rows).
2. Upload captures to the project's evidence folder (do not delete them:
   they are your support and privacy marketing material).
3. Each finding from section 8 → issue or entry in the launch
   registry with the capture linked.
4. If the 6 rows are OK: mark item 16 (P2P part) of
   [launch-checklist](launch-checklist.md) as verified.

**Blocking criteria (script summary):**
- Section 1-2 (basic pairing) fails → **blocking of sync announcement**;
  the rest of the launch can continue.
- Section 6 (offline) fails → **reputation blocking**: do not announce
  "air-gapped" until reviewed.
- Data loss/duplication in 5 or 7 → **absolute blocking**.
