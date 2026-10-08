# Support runbook — data loss

Objective: respond to "lost my data / forgot password" tickets in <10 min with the
correct path. This runbook does not require vault access (zero-knowledge by design).

## Golden rule before responding

ALWAYS ask first:

1. Do you have your **recovery phrase** (24 words you noted when creating the vault)?
2. Do you have a **`.bmf` file** (recovery kit or exported backup)?
3. Where did you save those copies? (same device or off-device — cloud/USB/email?)

Never respond "data is lost" before exhausting the 3 paths.

## Path 1 — Has the recovery phrase (most common case)

- On lock screen: **"Forgot password?"** → paste the 24 words.
- The phrase recovers the **master password** (not the data directly). The vault
  decrypts the saved password and starts normally.
- Sanitization: capitals, line breaks and multiple spaces normalize automatically.
- Rate-limit: 10 attempts → 5 min lockout. If the user locks out, wait and retry.
- Template (EN): *"Open the app, click 'Forgot password?' and paste your 24-word
  recovery phrase. It restores your master password — your data will appear exactly
  as you left it. Tip: paste it in one block; capitals and line breaks are fine."*

## Path 2 — Has a `.bmf` file (backup/kit)

- Lock screen does not ask for it: use **restore from backup** (visible when the
  database fails to open, or from Settings → Storage → Export/Import).
- The `.bmf` is encrypted with the **master password** (not the phrase). Needs
  the password to open it.
- Practical rule:
  - Has `.bmf` + password → full restoration (data + settings).
  - Has `.bmf` but no password → if also has the phrase, use Path 1
    first to recover the password and then restore.
  - Has `.bmf` from another device → equally valid (portable BMF1 format).
- If browser gives error when restoring: try in the same browser (different
  profiles do not share IndexedDB), do not mix browsers.

## Path 3 — Has neither phrase nor `.bmf`

- By design (AES-256-GCM encryption + Argon2id, zero-knowledge): **no recovery
  exists**. Neither support nor anyone can decrypt the vault.
- Communicate clearly and with empathy; it is the same warning the user accepted
  when creating the vault ("I have safely saved the recovery phrase").
- Offer cleanup: `/?reset=true` destroys the vault and allows starting from scratch.
- Refund: per 30-day policy via Whop. Credit without friction if the user
  requests it — retaining it does not recover trust nor avoid review.

## Prevention (what the product already does)

- Creation wizard: mandatory kit download before creating the vault
  (blocking checkbox).
- Multi-device warnings: in setup ("do not save only on this device")
  and in backup banner (golden rule: copy on same device is not backup —
  cloud/USB/email).
- Backup reminder >48h (banner) + auto-backup on unlock.
- Toast after export: indicates saving copy off-device.

## Refund and anti-fraud policy

Refund fraud exists, but the model makes it unprofitable:
**refund = license revocation**. The fraudster recovers the money and
loses Pro (drops to Free tier), so their lie buys nothing.

### Rules by case

- **≤ 30 days:** refund without questions + immediate license
  revocation. No interrogation: fraud at this period gives no benefit.
- **> 30 days with loss claim:** case by case. Ask for minimum
  evidence: order ID + lock screen screenshot. Minimum friction
  discourages the opportunist without punishing the honest customer.
- **Repeat offender:** ban the buyer in Whop. No second chance.

### Chargebacks (the real risk)

A buyer can dispute the charge with their bank without notice. Evidence
for the dispute, without violating vault privacy:

- Order ID, date and amount (Whop dashboard).
- License activation log from license-server (instanceId,
  timestamps): objective proof of delivery and product use.
- Note that the product is zero-knowledge: support never had access
  to content and no forced recovery mechanism exists.

### Revocation procedure

1. Process the refund from the Whop dashboard.
2. Mark the license as revoked in the license-server (`status`
   revoked): Pro validation stops passing on next check
   and the client drops to Free tier.
3. Repeat offender: ban the buyer in Whop.

Never condition the kindness of treatment on fraud suspicion: the
structure (revocation + ban + evidence) is the defense, not the dry treatment.

## Response templates (copy and paste in Whop)

### Template 1 — Refund ≤ 30 days (no questions)

> Hi [name],
>
> I'm sorry BookmarkForge didn't work out for you. I've processed your
> refund for order [ORDER_ID] — it should appear on your statement within
> 5-10 business days, depending on your bank.
>
> Your Pro license has been deactivated, and your account is back on the
> free plan (which stays yours forever — no time limit).
>
> No hard feelings at all, and thanks for giving it a try.
>
> — [your name], BookmarkForge

### Template 2 — Data loss with refund (empathetic + lesson)

> Hi [name],
>
> I'm truly sorry about your data. BookmarkForge is zero-knowledge by
> design: everything is encrypted on your device and only your recovery
> phrase can unlock it — that also means nobody, including me, can recover
> a vault without it.
>
> I've refunded your order [ORDER_ID] in full (5-10 business days to
> appear). Your license is deactivated and you owe nothing.
>
> If you ever give v2 a try: the setup wizard walks you through saving the
> 24-word phrase, and keeping one copy in the cloud (Drive, Dropbox) plus
> one on USB means a lost laptop never means a lost vault.
>
> Again, I'm sorry it ended this way.
>
> — [your name], BookmarkForge

### Template 3 — Response to chargeback (for the bank/Whop)

> Order [ORDER_ID], [DATE], [AMOUNT]. The customer purchased a lifetime
> Pro license for BookmarkForge and successfully activated it on device
> [INSTANCE_ID] on [ACTIVATION_DATE] (server activation log attached).
> The product is a local-first application delivered digitally at the
> moment of activation; support correspondence shows [summary]. We
> respectfully request reversal of the dispute.

### Template 4 — Data loss WITHOUT requested refund (retention)

> Hi [name],
>
> If you still have your 24-word recovery phrase or your .bmf backup file,
> your data is recoverable — click "Forgot password?" on the lock screen
> and paste the phrase, or restore the .bmf from Settings → Storage. Happy
> to walk you through it step by step.
>
> If neither exists, I'm genuinely sorry — the encryption that protects
> your data from everyone else also means it can't be recovered without
> the phrase. Your refund for [ORDER_ID] is processed (5-10 business
> days), and the free plan remains available with no time limit.
>
> — [your name], BookmarkForge

## Metric to watch

- Data loss tickets / total tickets. If it rises above 20%, review if the
  wizard warnings are sufficiently visible (possible A/B of kit text).
