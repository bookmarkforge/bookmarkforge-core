# Day 0 — Safari/iOS eviction drill: start-today sheet

> **What it is:** the executable sheet for **today**. It starts the 8-day test of
> the [iPhone script](ios-manual-test-script.md) (section 5) and leaves sections
> 0–4 done or ready. The real test (day 8) is automatic: time passes; today only
> the correct state must be **seeded**.

---

## Session data

| Field | Value |
|---|---|
| **Day 0 date** | `____________` (today) |
| **Expected day 7** | `____________` (+7 days) |
| **Day 8 check** | `____________` (+8 days) |
| **iPhone iOS version** | `____________` |
| **Wi-Fi SSID** | `____________` |
| **Capture folder** | `evidence/ios-day0/` (`ios-NN-what.png`) |

---

## 0. Session server — production + HTTPS (already running on your PC)

The app needs a **secure context** (WebCrypto, camera, PWA) and the drill uses
the **real production build**: in dev the service worker is a passthrough and
section 4 (PWA + airplane mode) would give false negatives. Current state:

```powershell
# In PowerShell, from the repository root (if it needs restarting):
$env:VITE_DEV_HTTPS = "1"
node node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port 4174 --strictPort
```

- Build checked today: `node scripts/build-ci.mjs` (budgets OK) —
  **rebuild if any code changes after this**.
- PC already verified: `https://<desktop-LAN-IP>:4174/app`, `/sw.js` and
  `/manifest.webmanifest` answer **200** (that is YOUR current Wi-Fi IP; if it
  changes, use the one the server prints).
- iPhone and PC must be on the **same network** (the SSID noted above).
- If Safari cannot connect: allow Node.js in the **Windows Firewall** for
  private networks (or mark your home Wi-Fi as *Private*) and retry.
- The certificate is **self-signed**: the iPhone will ask to accept it ONCE
  (step 1.2 below). In production this will not be necessary.

---

## 1. iPhone preparation (per the script's Preparation section)

| # | Step | OK |
|---|---|---|
| 1.1 | Safari → `https://<desktop-LAN-IP>:4174/app` (or your prod URL) | |
| 1.2 | Safari warns about an untrusted certificate → **Visit Website** → **Visit Anyway** (drill only; in production this will not be necessary) | |
| 1.3 | Captures ready (side button + volume up) | |
| 1.4 | Test password on paper: `prueba-iphone-2026` (18 chars) | |

---

## 2. Script sections 1–4 (~35 min)

Run them in order from the script; this is only the capture map:

| Section | Minimum captures (`evidence/ios-day0/`) |
|---|---|
| **1. Vault + 12 chars** | `ios-01-reject-11.png`, `ios-02-creation.png`, `ios-03-unlock.png` |
| **2. 24-word phrase** | `ios-04-phrase.png` (without the words), the 24 words on paper |
| **3. .bmf backup** | `ios-05-export.png`, `ios-06-bmf-icloud.png`, `ios-07-restored.png` |
| **4. PWA** | `ios-08-installed.png`, `ios-09-standalone.png`, `ios-10-airplane.png` |

Section success criteria: the script's (11 rejected / exact 24 words / .bmf
off-device / standalone without the Safari bar).

---

## 3. Day 0 — seed the eviction (2 min, the important part today)

1. [ ] Open the app in **normal Safari** (NOT from the PWA icon) and verify
   your test bookmark is still there.
2. [ ] **Close the tab and DO NOT reopen that URL in Safari** until day 8.
   Not even a peek: one open resets the inactivity counter.
3. [ ] Optional: capture the Safari eviction warning if the app shows it
   (`ios-11-eviction-warning.png`).
4. [ ] The **installed PWA** can be used normally during the week (in fact it
   is interesting: the installed app usually gets better storage treatment —
   on day 8 we compare both worlds).
5. [ ] Fill the "Day 0" row of the registry below.

---

## 4. Day 3 — intermediate check (2 min)

1. [ ] Do NOT open the app in Safari. Only verify your `.bmf` is still in
   iCloud Drive / email (`ios-12-bmf-still-there.png` optional).
2. [ ] Confirm the day 8 date in the calendar with a reminder.

---

## 5. Day 8 — the real test (5 min, per the script's section 5)

1. [ ] Open the app in **Safari** for the first time since day 0.
2. [ ] **Result A (expected):** it starts "empty" — first-time / restore flow,
   NEVER a corruption error. → `ios-13-day8-evicted.png`
3. [ ] Restore from the iCloud `.bmf` → everything returns →
   `ios-14-restored.png`
4. [ ] **Result B (survived):** note it; repeat opening only the PWA, or
   accept that iOS treated your site as active. In both cases: no corruption.
5. [ ] In both cases the app must **warn** before considering data lost
   (never silent loss).

---

## Session registry

| Milestone | Date | Result | Notes |
|---|---|---|---|
| Sections 1–4 executed | | | |
| Day 0 seeded (Safari closed) | | | |
| Day 3 check (.bmf in iCloud) | | | |
| Day 8 Safari open | | | Result A / B |
| Day 8 restore | | | |

**Closing:** with sections 1–4 OK and day 8 A-or-B-without-corruption, the
iPhone is **certified for launch** (row 5 of the script's results registry).
