# Manual test script — P2P Sync iPhone ↔ desktop (pre-launch)

> **Objective:** certify on real devices the flow that no automated battery can
> fully cover: pairing by double QR with a physical camera, real sync between
> two vaults on the same network, and offline behavior.
> The logic (collection replication, LWW reconciliation, recovery after
> interruption) is already automated in `tests/e2e/vault-sync-real.spec.ts`;
> what is tested here only exists with real hardware: cameras, real Wi-Fi,
> real airplane mode and real iOS Safari.
>
> - **Duration:** ~40 min with both devices at hand.
> - **You need:** a desktop/laptop **with a webcam** (both roles scan a QR exactly once) + an iPhone with iOS 16+, both with the app on HTTPS (production or staging), paper for notes.
> - **Important:** BookmarkForge's P2P is **air-gapped by design**
>     (`iceServers: []` — no STUN/TURN): both devices must be on the
>     **same local network**. If they do not connect, 90% of the time it is the
>     network, not the app (section 6).
> - **Relationship:** complements the [iPhone script](ios-manual-test-script.md) and
>     item 16 of [launch-checklist.md](launch-checklist.md).

---

## Preparation (5 min)

1. [ ] Connect the iPhone and the desktop to the **same Wi-Fi network**.
       Avoid "guest" networks: they usually have *client isolation* and block
       traffic between devices (sync will not connect and this is NOT a bug).
2. [ ] Open the app on both devices (HTTPS mandatory: camera and WebRTC
       require a secure context) and unlock each vault.
3. [ ] On the desktop, leave the laptop **unplugged from the network** if you
       want to validate the 100% offline mode (section 5). Wi-Fi can stay
       connected: sync never leaves the LAN anyway.
4. [ ] On the iPhone: Safari settings → camera allowed for the domain
       (it will ask you when scanning; accept it).
5. [ ] Recognizable test data: create on the DESKTOP 2 bookmarks and 1
       document with the word **DESK** in the title; on the iPhone 2 bookmarks
       and 1 document with **PHONE**. Write the exact titles on paper.
6. [ ] Keep **both screens on** for the whole pairing
       (if the iPhone locks or Safari goes to the background, the ICE
       connection drops and you must retry from step 1).

---

## 1. QR pairing (desktop = host) (10 min)

1. [ ] Desktop: Dashboard → **"Secure P2P Sync"** card → **"This is the host"** button. After a few seconds the QR appears (step 1) on a white background. _Capture._
2. [ ] iPhone: same card → **"Link this device"** → Safari will ask for the camera.
       Accept and point it at the desktop's QR.
3. [ ] The iPhone now shows **its response QR** ("Step 2: Show this QR
       to your main device camera").
4. [ ] Desktop: press **"Step 2: Scan answer"** and point the webcam at the
       iPhone. The desktop's camera must read the phone's QR (adjust
       distance/brightness if it takes more than ~15 s).
5. [ ] Both sides go through **"Syncing vaults..."** with a progress bar and
       finish at **"Sync Successful!"** / "Both devices are up to date."
       _Capture of the final state on both._
6. [ ] **Verify convergence:** on the iPhone the titles with **DESK** must
       appear; on the desktop the ones with **PHONE** (bookmarks AND
       documents). Count them out loud against your paper.

**✅ Success criterion:** both sides reach "Sync Successful!" and each
device sees the other's 4 items.

---

## 2. Reversed roles (iPhone = host) (5 min)

1. [ ] Close the modal on both devices (the disconnect is automatic).
2. [ ] Repeat the pairing with **roles reversed**: the iPhone as
       "This is the host" and the desktop as "Link this device".
3. [ ] Again: double QR, progress, "Sync Successful!" and convergence
       (use a new **SWAP** bookmark on each side to verify it).

**✅ Success criterion:** the flow works the same in both directions — the
role is not a privilege, it is only who generates the first QR.

---

## 3. Incremental sync (5 min)

1. [ ] With the session still connected (or repeating the pairing, ~1 min):
       create a new bookmark on the iPhone (**INC1**) while the bar can still
       sync, or create it BEFORE and pair after — both paths must converge.
2. [ ] Check that **INC1** appears on the desktop and **INC2** (created on the
       desktop) appears on the iPhone.
3. [ ] On the desktop edit the description of a **DESK** bookmark and
       verify the change reaches the iPhone after the next pairing.

**✅ Success criterion:** new changes travel in the next session without
creating duplicates (same title = 1 row, not 2).

---

## 4. Concurrent edits and conflict resolution (8 min)

> Reconciliation is **last-writer-wins by timestamp**: the version with the
> MOST RECENT modification wins, on both devices. This block verifies that
> it is deterministic and duplicate-free.

1. [ ] Before connecting: edit the SAME bookmark on both devices
       (a different title on each: **WINS-DESK** on desktop,
       **WINS-PHONE** on iPhone). Leave **2-3 minutes** between the two
       edits so the timestamps are not almost simultaneous.
2. [ ] Pair and wait for "Sync Successful!".
3. [ ] Expected result: **both** devices show the most recent
       edit (if you edited WINS-PHONE last, both show WINS-PHONE).
       _Note which one won and in what order you edited — they must match._
4. [ ] **No duplicates:** the conflicting bookmark appears only ONCE in
       each vault (neither odd merges nor twin rows).
5. [ ] **Simultaneous creation of the same title:** create on both sides a
       bookmark with an identical title (e.g. **DUPTEST**) before connecting.
       After sync: a single entry (deduplication by id/operation), not two.
6. [ ] Verify that the conflict loser did not corrupt anything else: the
       DESK/PHONE/INC titles remain intact on both sides.

**✅ Success criterion:** deterministic LWW (the newest edit wins on both),
no duplicates and no collateral damage.

---

## 5. Real offline / air-gapped (7 min)

> The product's promise: data **never leaves your network**. Here it is proven.

1. [ ] **Full airplane mode on the iPhone** (Wi-Fi OFF too)… but then there is
       no LAN: this step verifies the opposite — that it does NOT need internet:
       with the router **disconnected from the internet** (or the laptop
       unplugged and the phone on Wi-Fi to a router without WAN), pair and sync.
2. [ ] Sync must complete the same as in section 1 (the app must not
       show network errors or block for lack of internet).
3. [ ] **Cut mid-sync:** during "Syncing vaults..." (with a large vault so it
       lasts), force the modal closed on the desktop halfway through the bar.
       Reopen and re-pair: it must complete without duplicates
       nor corruption (the e2e already covers recovery after interruption;
       here it is confirmed on real hardware).
4. [ ] **Safari in the background:** with pairing half done, send the
       iPhone to the background for 10 s and come back. Expected behavior: a
       visible connection error or clean retries — never a false "completed"
       state nor a silent hang. _Capture if there is an error._
5. [ ] After each step verify that both vaults remain unlockable and
       with their data intact.

**✅ Success criterion:** full sync WITHOUT internet; interruptions degrade
with a visible error and recover by re-pairing.

---

## 6. Network limits: what must NOT connect (5 min)

> Privacy by design: outside the LAN, sync does not exist.

1. [ ] iPhone on **mobile data** (Wi-Fi OFF) + desktop on its network:
       try to pair. After the QR it must stay at "connecting" and end in a
       visible error/timeout — it must **never** complete. _Capture of the error._
2. [ ] iPhone on a **different guest network** (if you have one) with the
       desktop on the main one: same expected result (it does not connect).
3. [ ] Restore the iPhone to the correct network and pair again: it must work
       again (the earlier failure left no broken state).

**✅ Success criterion:** different networks = no connection (and a visible
error, not a hang); back on the LAN = it works.

---

## 7. iOS particularities to watch (findings, not always blocking)

- **"WebRTC is not supported" banner** in the modal instead of the role
  selector: if it appears on your iOS, it is a **blocking** finding (note the
  iOS version) — P2P sync will not work for iPhone users.
- **Camera inside the installed PWA:** iOS is restrictive with getUserMedia
  in standalone mode. If scanning fails in the PWA but works in Safari,
  note it: the user documentation must say "always pair from
  Safari".
- **Screen lock** mid-pairing: ICE is cut. The app must show an error and
  allow a retry (verified in 5.4).
- **QR the desktop webcam cannot read:** lower the iPhone's brightness or move
  it away — it is optics, not software, if the same QR reads with another camera.

---

## Results log

| Section | Result (OK/FAIL/N-A) | Evidence (screenshot/note) | Date |
|---|---|---|---|
| 1. QR pairing (desk host) | | | |
| 2. Reversed roles (iPhone host) | | | |
| 3. Incremental sync | | | |
| 4. LWW conflicts / deduplication | | | |
| 5. Real offline + cuts | | | |
| 6. Network limits (must not connect) | | | |

**Closure criterion:** all 6 rows OK = P2P sync certified to announce.
FAIL in 1-2 = blocks the sync announcement (the rest of the launch can
proceed); FAIL in 5 = reputation blocker (review BEFORE launching any mention
of "air-gapped"); FAIL in 4 or 6 = blocking if it implies loss or
duplication of user data.