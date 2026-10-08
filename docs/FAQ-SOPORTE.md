# Support FAQ — BookmarkForge

> Quick guide for the operator. Answer tickets in <24h.
> Every reply should be personalized but may use these templates as a base.

---

## 🔑 Category: Licensing and Pro

### Q: How do I activate my Pro license?

**Answer:**
1. Go to **Settings → Pro** in the application
2. Click "Activate Pro License"
3. Enter your license key (received by email from Whop)
4. The app will verify automatically against our server
5. If it is valid, the Pro features unlock immediately

**If it does not work:**
- Verify that the internet connection works
- Make sure you use the same email you purchased with
- Restart the application after activation
- If it persists, contact us with your Order ID at [soporte@bookmarkforgeapp.com]

---

### Q: What does the Pro license include?

**Answer:**
- 📁 Unlimited bookmarks (Free: 2,500)
- 💾 Automatic encrypted backups
- 📄 PDF/OCR export
- 🃏 Flashcards from bookmarks
- 🔄 P2P sync between devices
- 📧 Priority email support (<48h)

---

### Q: How does the pricing work?

**Answer:**
- It is a **lifetime license** for the current major version
- **Early Bird**: $59 (first 200 licenses)
- **Regular price**: $79 after Early Bird sells out
- **Upgrade to v2**: $89 new / $35 for v1 owners (60% off)
- There is no monthly or annual subscription
- One purchase = permanent use of that version

---

### Q: Can I get a refund?

**Answer:**
- Yes, Whop handles refunds
- Contact your order at: https://whop.com/orders
- The refund reverts your license to Free automatically
- Your vault and data are NOT affected
- Estimated processing time: 3-7 business days

**If the refund does not reflect in the app:**
- Verify that the license was revoked on the server
- Disconnect and reconnect your account
- If it persists, include the Order ID in the ticket

---

### Q: What happens if I buy Pro and it does not work?

**Answer:**
1. Verify your internet connection
2. Try deactivating and reactivating the license in Settings
3. Test in another browser/device
4. If the error persists, send your Order ID to support

**We will NEVER ask you for:** your password, recovery phrase, or access to your vault.

---

### Q: Do I have a device limit?

**Answer:**
- Each device has its own local vault (no device limit for the app)
- The Pro license is verified per individual device
- You can use the app on as many devices as you want
- Pro P2P sync works between your devices

---

### Q: How do I change my email or account?

**Answer:**
- Your license is tied to the purchase email at Whop
- To change the contact email: edit your account at https://whop.com/account
- Access to your data does NOT depend on your email — everything is encrypted locally
- If you lost access to your email, contact Whop to recover your account

---

## 🔒 Category: Security and Privacy

### Q: Where is my data stored?

**Answer:**
- **On your device**, encrypted with AES-256-GCM
- In the browser's IndexedDB (or the filesystem with the PWA)
- No data is sent to external servers without your consent
- We can **never** see your data
- The recovery phrase (24 words) is the only way to recover your vault

---

### Q: What happens if I lose my password?

**Answer:**
- Use your **24-word recovery phrase** to restore
- If you lost both (password + phrase), the data is unrecoverable
- That is why we recommend keeping the phrase somewhere safe
- We will never ask you for it

---

### Q: Does the app collect personal data?

**Answer:**
- **Not by default**
- Telemetry is **opt-in** (you must enable it explicitly)
- The data collected is: event type, aggregate count (NOT vault content)
- No personal data, IP, or vault content is collected
- You can disable it at any time in Settings

---

### Q: Is it GDPR compliant?

**Answer:**
- Yes, we are GDPR-compliant
- Your data is on your device, not on our servers
- Data processing is documented in our ROPA
- You can exercise your access, rectification and deletion rights
- DPO contact: available on request

---

## 📱 Category: Using the App

### Q: The app does not load / freezes

**Answer:**
1. Close the app completely
2. Open a clean browser (no extensions)
3. Go to the BookmarkForge URL
4. If it still fails, clear the browser cache
5. If it persists, try in incognito mode
6. If everything fails, reinstall the PWA

---

### Q: I cannot log in / the vault is locked

**Answer:**
1. Make sure you have the latest version
2. Try another password (the one you used to create the vault)
3. If you forgot the password, use the 24-word recovery phrase
4. If the phrase does not work, the vault may be corrupted — restore from backup

---

### Q: How do I back up my data?

**Answer:**
- Go to **Settings → Backup**
- Create an encrypted .bmf file
- Save it in a safe location (personal cloud, external drive)
- To restore: Settings → Restore → select the .bmf file
- The backup is encrypted with your password — without it, it cannot be opened

---

### Q: Does it work without internet?

**Answer:**
- **Yes, completely** for the Core functionality
- Bookmark editing, notes, search, organization: all offline
- Pro P2P sync requires a connection
- Local AI models (WebLLM) work without internet
- Calls to AI providers (BYO key) require internet

---

### Q: Which browsers are supported?

**Answer:**
- Chrome 109+
- Firefox 109+
- Edge (Chromium-based)
- Safari (experimental)
- PWA installable in any modern browser
- Extension available for Chrome and Firefox

---

## 🔌 Category: Browser Extension

### Q: The extension does not work / does not capture the page

**Answer:**
1. Verify the extension is enabled at `chrome://extensions` or `about:addons`
2. Right-click on the page → "Save to BookmarkForge"
3. If it does not appear, make sure the URL is `https://` (not `chrome://`, `file://`, etc.)
4. Verify the extension is up to date
5. If it persists, uninstall and reinstall the extension

---

### Q: Does the extension store my data?

**Answer:**
- **No**
- The extension only captures the URL and title
- It sends that information to the BookmarkForge server via a URL with a hash fragment (#)
- The hash fragment is **NEVER** sent to the server — it stays only in your browser
- No page content is stored externally

---

### Q: How do I configure the BookmarkForge server in the extension?

**Answer:**
1. Go to the extension settings (icon → Settings)
2. Enter the URL of your BookmarkForge instance
3. The default value is `https://bookmarkforgeapp.com`
- You can use your own server if you self-host

---

## ⚠️ Category: Emergencies

### Q: My account was hacked / unauthorized access

**Answer:**
1. Change your password immediately
2. If you use the same password elsewhere, change it there too
3. Review the activity history in Settings
4. Revoke active sessions in Settings
5. Contact support with the details

> **Note**: Your vault data is encrypted with your password. Unauthorized access to the app does not mean access to your encrypted data.

---

### Q: I want to delete all my data

**Answer:**
1. Go to **Settings → Privacy**
2. Select "Delete All Data"
3. Confirm with your password
4. Your IndexedDB data is deleted locally
5. **There is no data of ours to delete** — everything is local-first
6. For the information Whop holds about your purchase, contact Whop

---

## 📧 Reply Templates by Ticket Type

### Template: License does not activate

```
Hello,

Thanks for contacting us. For your activation issue:

1. Verify that your license is active on Whop: [link]
2. Try deactivating and reactivating in Settings → Pro
3. Make sure you use the same internet connection
4. If the Order ID is [ORDER_ID], I can verify the status

Your vault and data are safe — this does not affect your information.

If it persists after these steps, please include:
- Your Order ID
- The purchase email
- A screenshot of the error

Estimated resolution time: <24h

Best regards,
The BookmarkForge team
```

### Template: Refund request

```
Hello,

I understand you want a refund. To process it:

1. Go to https://whop.com/orders and find your order
2. Request the refund directly on Whop
3. Once processed, your license will be revoked automatically
4. Your vault and data are NOT affected

If you have issues with Whop, I can help you escalate.

Whop processing time: 3-7 business days

Best regards,
The BookmarkForge team
```

### Template: Technical issue (support)

```
Hello,

Thanks for reporting this issue. To help you better:

1. Which browser and version does it happen on?
2. Did it start after you updated something?
3. Does it work in incognito mode?
4. Can you share a screenshot of the error?

In the meantime, try:
- Clearing the browser cache
- Updating BookmarkForge to the latest version
- Testing in another browser

If the issue is with a Pro license, include your Order ID.

Best regards,
The BookmarkForge team
```

### Template: Data request (GDPR)

```
Hello,

We received your GDPR rights request.

Since BookmarkForge is local-first and your data is on your device:
- Your vault data: it is in your browser, not on our servers
- To delete it: Settings → Privacy → Delete All Data
- To export it: Settings → Export

For any data Whop processes (purchase, email), contact:
https://whop.com/account/privacy

If you need a formal confirmation, reply to this ticket and we will send it
within <30 days.

Best regards,
The BookmarkForge team
```

---

## Response times

| Priority | Response time | Resolution time |
|-----------|-------------------|---------------------|
| 🔴 Critical (cannot use the app) | <2h | <24h |
| 🟠 High (license does not work) | <4h | <48h |
| 🟡 Medium (technical issue) | <12h | <72h |
| 🟢 Low (general question) | <24h | <5 days |

## Tracking metrics

Keep a record of each ticket:
- Date
- Response time
- Resolution time
- Category
- Was an escalation necessary?
- User satisfaction (if applicable)

Review weekly: which category generates the most tickets? Where is the bottleneck?