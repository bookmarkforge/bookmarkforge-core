# iPhone manual test script — BookmarkForge (pre-launch)

> **Objective:** validate on a real iPhone the routes that no automation can
> certify — Safari/WebKit iOS is the engine with the most aggressive behavior
> against local data (ejects IndexedDB after 7 days of inactivity, different
> quotas, different download management). If something fails here, it is a
> launch blocker: users who lose data do not forgive.
>
> - **Total duration:** ~45 min first session + 2 visits of 5 min during
>   8 days (Safari ejection test).
> - **You need:** iPhone with iOS 16+, production URL (or staging HTTPS —
>   SW and installation require secure context), paper for the phrase,
>   access to your email to verify cloud copy.
> - **Golden rule:** document each result with screenshot. What is not
>   documented does not count as proven.
> - **Relationship:** complements item 16 of [launch-checklist.md](launch-checklist.md)
>   and the runbook [launch-day-smoke.md](launch-day-smoke.md). The 24 words and
>   minimum password are already automated in Chromium/Firefox/WebKit desktop;
>   here the real device is certified.

---

## Preparation (5 min)

1. [ ] Open Safari on iPhone and navigate to the app URL (HTTPS mandatory).
2. [ ] Verify the page loads without certificate warnings.
3. [ ] Settings → enable **Safari Copy** if you want to save screenshots:
       side button + volume up (or Assist → "screenshot").
4. [ ] Have at hand: **test password** (minimum 12 characters — e.g.
       `prueba-iphone-2026`), paper and pen.

---

## 1. Vault creation and 12-character password (10 min)

1. [ ] Start the app for the first time: creation flow should appear
       (SecurityConfirmation → create vault).
2. [ ] **Negative test:** write an **11-character password**
       (e.g. `prueba-11-a`). The validator must reject it BEFORE creating
       anything — look for the minimum characters message. _Screenshot._
3. [ ] Write the 12+ password (`prueba-iphone-2026`) and confirm.
4. [ ] Creation on iPhone may take **20-60 s** (mobile Argon2id,
       64 MiB): normal; if it takes more than 2 min, note as finding.
5. [ ] When finished, the app should open unlocked (Dashboard).
6. [ ] **Lock the vault** and unlock with the same password:
       the lock→unlock round-trip must work without errors.
       _Screenshot of unlock._
7. [ ] Leave the app with **1 test bookmark** created (you need it for
       section 3): add a bookmark with recognizable URL and title
       (e.g. "iPhone smoke test").

**✅ Success criteria:** 11-character password rejected, 12 accepted,
lock/unlock OK, bookmark visible.

---

## 2. 24-word recovery phrase (10 min)

1. [ ] If you still have it on screen, skip to step 3. If not: Vault
       settings → show/verify recovery phrase option
       (enter password if asked).
2. [ ] **Copy the 24 words BY HAND to paper** — do not use screenshots or
       phone notes. This is exactly what we will ask users to do.
3. [ ] Verify the counter: must be **exactly 24 words**, not 12 nor 23.
       _Screenshot of the phrase screen (without words in frame)._
4. [ ] **Negative test:** use recovery function with **deliberately incomplete
       phrase** (23 words). It must reject with clear message and NOT
       unlock anything.
5. [ ] Now recover with the correct 24 words (in exact order).
       The vault must unlock.
6. [ ] NOTE: between a failed attempt and retry wait **a few seconds** —
       the service limits to one attempt every 2 s (anti-brute force).

**✅ Success criteria:** exact 24 words on paper; 23 rejected;
24 unlock the vault.

---

## 3. Encrypted .bmf backup and restoration (10 min)

1. [ ] With vault unlocked: Settings → Storage → **Export Backup**.
2. [ ] When asked for backup password, use **the same vault password**
       (`prueba-iphone-2026`) — the restoration assistant will expect
       it after total loss.
3. [ ] Safari will download the file: locate it in **Files → Downloads**
       (Safari iOS). Move a copy to **iCloud Drive** (or email it) — this
       simulates the backup OFF the device that we recommend.
       _Screenshot of file in iCloud/Email._
4. [ ] Verify the file has **.bmf** extension and non-zero size.
5. [ ] **Simulate total loss:** Settings → Safari → Advanced → **Website
       Data** → search for the app domain → **Delete**. This deletes
       IndexedDB/localStorage — the real disaster Safari can cause.
6. [ ] Reopen the app: it should start as first time.
7. [ ] Follow the restoration assistant (F0-2): choose restore from
       file → select the .bmf from iCloud Drive → enter the backup
       password.
8. [ ] The vault must open unlocked and **your test bookmark must be**
       present (search by its title). _Screenshot of restored bookmark._
9. [ ] Note: after restoration, the app uses the SAME vault password
       always — restoration does not change credentials.

**✅ Success criteria:** .bmf exported and off-device; after deleting
site data, restoration recovers the bookmark.

---

## 4. PWA and home screen installation (5 min)

1. [ ] In Safari: Share button → **Add to Home Screen**.
       It should suggest the app's name/icon (manifest loaded).
2. [ ] Open from the icon: it should open **full screen** (without Safari
       bar — `display: standalone`).
3. [ ] Verify **airplane mode**: with app already loaded, enable airplane,
       close and reopen the app from the icon. It should open from the service
       worker cache (may show "no connection" state, but vault unlockable
       if session allows).
4. [ ] Disable airplane mode.

**✅ Success criteria:** installable with correct icon/name, standalone,
and the app in airplane mode does not break.

---

## 5. The 7-day test — Safari IndexedDB ejection (8 days)

> This is THE test that motivates the app's warnings. Safari deletes website
> data after **7 days of inactivity** (home screen installed app data gets
> better treatment, but DO NOT rely on it: test it also in normal Safari).
> Your defense: the ejection risk warning + backups + sync.

### Day 0 (today, 2 min)

1. [ ] In Safari (not the PWA), open the app and verify your bookmark
       still exists. Leave the session PERSISTENT closed (do not open it again).
2. [ ] Optional but recommended: install the warning capture — verify that
       the app SHOWS the Safari ejection warning (7 days) at some point
       of onboarding/settings. _Screenshot of warning._

### Day 3 (2 min) — intermediate check

1. [ ] Do NOT open the app yet. Only verify your .bmf is still in iCloud
       Drive / email.
2. [ ] Note the expected day 7 date.

### Day 8 (5 min) — the real test

1. [ ] Open the app in **Safari** (not the PWA) for the first time since day 0.
2. [ ] **Result A (expected):** the app starts "empty" — Safari ejected
       the data. First time / restoration flow should appear, NOT a corrupt
       database error. _Screenshot._
3. [ ] Restore from your iCloud .bmf (section 3, steps 7-8). Everything should
       return, including the test bookmark.
4. [ ] **Result B (if data survived):** note it — can happen if
       iPhone considered the site active. Repeat the experiment opening
       only the installed PWA, or accept that modern iOS treated your use as
       activity. In either case, the app must not corrupt.
5. [ ] In both cases: verify the app does NOT lose the vault silently
       — it must always warn (ejection warning, restoration assistant)
       before considering data lost.

**✅ Success criteria:** after 7+ days without opening, the app degrades
gracefully (first time + restoration), never with corruption or silent loss.

---

## 6. What this test does NOT cover (and why it's fine)

- **Real hardware KDF performance:** the 64 MiB profile is already
  certified in CI with emulated Android (`npm run e2e:mobile`); on iPhone
  what is measured here is that creation takes reasonable time (<2 min).
- **Real Firefox/iPad/Android:** covered by automated batteries
  (e2e:engines, e2e:mobile). This script is specific to the engine no local
  automation reaches: real Safari iOS.
- **P2P sync between devices:** deserves its own script (iPhone ↔
  desktop with QR). If you are launching sync, test separately BEFORE
  the announcement.

---

## Results registry

| Section | Result (OK/FAIL/N-A) | Evidence (screenshot/note) | Date |
|---|---|---|---|
| 1. Vault + 12-character password | | | |
| 2. 24-word phrase | | | |
| 3. .bmf backup + restoration | | | |
| 4. PWA / standalone | | | |
| 5. Safari ejection (day 8) | | | |

**Closing criteria:** all 5 rows OK = iOS device certified for
launch. Any FAIL in 1-3 is blocking; in 4-5, blocking if it prevents
data recovery, finding if cosmetic.
