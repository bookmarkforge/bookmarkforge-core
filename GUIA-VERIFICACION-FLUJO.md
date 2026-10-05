# 🔍 COMPLETE FLOW VERIFICATION GUIDE

This guide will help you verify that everything works correctly:
GitHub public → Vercel → Whop → Purchase

---

## 📋 VERIFICATION CHECKLIST

### Step 1: Verify Public GitHub

1. Open: https://github.com/bookmarkforge/bookmarkforge-core
2. Verify:
   - ✅ The repo is public
   - ✅ The README describes the project
   - ✅ No Pro code is visible (only placeholders)
   - ✅ The web link is in the README

### Step 2: Verify Application URL

Open your production application:
- **URL**: https://bookmarkforgeapp.com

Verify:
- ✅ The page loads correctly
- ✅ No errors in console (F12 → Console)
- ✅ The design looks good
- ✅ The site is responsive (works on mobile)

### Step 3: Verify License Flow

1. In the application, navigate to the **Licenses** or **Pro** section
2. Verify:
   - ✅ The Whop checkout link appears
   - ✅ The link is: `https://whop.com/checkout/plan_XU1GaWhoYhoDh`
   - ✅ Clicking opens Whop

### Step 4: Verify Whop Checkout

1. Click the checkout link
2. Verify:
   - ✅ Whop opens correctly
   - ✅ It shows the BookmarkForge plan
   - ✅ The price is correct
   - ✅ You can start the purchase process

### Step 5: Verify Environment Variables (Optional)

If you want to verify the variables are configured:

1. Go to Vercel Dashboard: https://vercel.com/dashboard
2. Find project: **bookmark7**
3. Settings → Environment Variables
4. Verify:
   - ✅ WHOP_API_KEY is configured (Secret)
   - ✅ WHOP_LICENSE_API_URL is configured
   - ✅ VITE_WHOP_CHECKOUT_URL is configured
   - ✅ VITE_BUILD_ENV = production
   - ✅ VITE_APP_VERSION = 1.0.0

---

## 🧪 COMPLETE MANUAL TEST

### Scenario: New User

1. **User opens GitHub**
   - Visits: https://github.com/bookmarkforge/bookmarkforge-core
   - Reads the README
   - Clicks the web link

2. **User arrives at the web**
   - Opens: https://bookmarkforgeapp.com
   - Sees the landing page
   - Registers or logs in

3. **User wants Pro**
   - Navigates to Licenses
   - Sees the "Buy Pro" button
   - Clicks it

4. **User goes to Whop**
   - Whop checkout opens
   - Sees the plan and price
   - Starts purchase process

5. **User purchases**
   - Completes payment on Whop
   - Receives confirmation
   - Returns to the application

6. **User has Pro**
   - The application detects the license
   - Pro features are activated
   - The user can use them

---

## 🔧 TECHNICAL VERIFICATION

### Verify Whop API (server-side only)

`WHOP_API_KEY` is a **server-only** secret: it must never be entered in the
browser console or DevTools — the network/console tabs can log and expose the
value. Verify the contract from a trusted machine, with the key in the
process environment (never as a visible argument):

```bash
# The key lives in the secret manager / .env of the server; it is not printed.
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $WHOP_API_KEY" \
  https://api.whop.com/api/v2/me
```

In production, verification goes through the signing service: the app calls
`/api/license/validate` on the same origin and the server queries Whop. The
browser only verifies the entitlement signature; it never sees the key.

### Verify client variables

`import.meta.env` is module syntax: it is not reliable in the classic DevTools
console. To check what was actually injected into the bundle, use the deployed
build and search for the value in the Assets, or verify the visible app surface
(Pro button checkout URL). In Vercel, variables are reviewed in Dashboard →
Project → Settings → Environment Variables, not from the visitor's browser.

Expected in production:
- `VITE_WHOP_CHECKOUT_URL`: Whop checkout URL
- `VITE_BUILD_ENV`: production
- `VITE_APP_VERSION`: 1.0.0 (or the published version)

---

## 🐛 TROUBLESHOOTING

### If the Whop link doesn't work:

1. Verify that `VITE_WHOP_CHECKOUT_URL` is configured in Vercel
2. Verify that the checkout plan ID matches the actual Whop plan
3. Check the browser console for errors

### If license activation fails:

1. Check that the license companion responds: `GET /api/license/health`
2. Review server logs (not browser logs) for the Whop error
3. Remember that trial only exists if Whop grants it; there is no local trial

### If the application doesn't load:

1. Verify that Vercel is deployed
2. Review Vercel logs
3. Verify that environment variables are configured

### If Whop doesn't open:

1. Verify that the checkout URL is correct
2. Verify that Whop has the plan configured
3. Contact Whop support if necessary

---

## 📊 MONITORING IN VERCEL

To monitor the status:

1. Go to Vercel Dashboard
2. Deployments → View recent deployments
3. Logs → View error logs
4. Analytics → View performance

---

## ✅ EXPECTED RESULT

If everything works correctly:
- ✅ Public GitHub shows only Core MIT code
- ✅ The application loads on Vercel
- ✅ The Whop checkout works
- ✅ The purchase flow is smooth
- ✅ Users can purchase licenses

---

## 📞 NEED HELP?

If you encounter any problem:
1. Check the browser console (F12)
2. Review Vercel logs
3. Verify environment variables
4. Let me know the specific error
