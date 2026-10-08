# Refund Policy — BookmarkForge Pro

> This policy covers the refund flow for Pro licenses purchased through Whop.
> Whop manages refund processing; BookmarkForge handles license revocation.

---

## Summary

BookmarkForge uses Whop as the payment processor. Refunds are managed by Whop. Your responsibility as the operator is:

1. Verify that the refund was processed by Whop
2. Revoke the corresponding Pro license
3. Ensure the user reverts to Free
4. Log the transaction

## Refund Policy (what you communicate to the user)

### Accepted Refunds

Refunds are processed through Whop. Users must request them at:
- https://whop.com/orders → Select order → Request refund

**Typical acceptance criteria:**
- Product was not used (or used less than 24h)
- Technical issues preventing product use
- Accidental purchase

**Typical rejection criteria:**
- Product was used extensively (>7 days)
- User already received a previous refund for the same license
- License was revoked for abuse

### Timeframes

| Step | Estimated Time |
|------|----------------|
| User request on Whop | Immediate |
| Processing by Whop | 3-7 business days |
| License revocation | <1 hour after confirming refund |
| User reverts to Free | Immediate after revocation |

## Operational Flow (for the operator)

### Step 1: Receive Refund Request

The user requests a refund through Whop or contacts BookmarkForge support.

If contacting support:
1. Request the **Order ID** from Whop
2. Verify order status on Whop (dashboard or API)
3. If order doesn't exist → inform the user

### Step 2: Verify Refund Status

**Option A: User already processed on Whop**
```
Verify on Whop Dashboard:
- Order → Status: "Refunded" or "Partially Refunded"
```

**Option B: User needs help**
- Guide user to https://whop.com/orders
- User must initiate the process there

### Step 3: Revoke License

Once refund is confirmed on Whop:

```bash
# On the server:
POST /api/license/deactivate
Body: { license_key: "...", instance_name: "deviceId" }
```

Verify:
- Response is `{ ok: true }`
- License was successfully revoked

### Step 4: Verify Reversion to Free

1. Ask user to verify in Settings → Pro
2. Plan should show "Free" or "Free Plan"
3. Pro features should be blocked

If it doesn't revert to Free:
- Verify that `WHOP_API_KEY` is configured on the server
- Verify that Whop response reflects the refund
- Document as escalation case

### Step 5: Log

In `support-refunds-log.md`:
```
Date: YYYY-MM-DD
Ticket: TICKET-XXXX
Order: ORDER-XXXX
Reason: change of mind / technical / other
Amount: $59.00 USD
License revoked: yes/no
Operator: [your name]
```

In `support-chargebacks-log.md`:
- If user contacts their bank to dispute the charge (chargeback) instead of requesting refund directly from Whop, log here

## Special Scenarios

### Scenario: User requests refund but license remains active

**Cause**: Whop processed refund but server didn't receive notification.

**Solution**:
1. Verify on server that user still has "pro" plan
2. Manually execute revocation: `POST /api/license/deactivate`
3. Confirm it reverts to Free

### Scenario: User requests chargeback (bank dispute)

**Cause**: User contacted their bank instead of Whop.

**Action**:
1. Log in `support-chargebacks-log.md`
2. Contact Whop to notify
3. Do not revoke license until Whop confirms
4. User likely won't receive refund (chargebacks are harder)
5. Document as reference for future cases

### Scenario: User has a bug preventing Pro use

**Action**:
1. Evaluate if bug is critical (prevents complete Pro use)
2. If critical → process refund without penalty
3. If minor → inform user and give time to resolve
4. Document in `support-data-loss-runbook.md` if applicable

### Scenario: Refund but user has data in vault

**Action**:
- Vault data is NOT affected by refunds
- User keeps all their local data
- License reverts to Free but data persists
- Inform user: "Your data is safe. You only lose access to Pro features."

## Do-Not List

- ❌ NEVER process a refund manually without confirming on Whop
- ❌ NEVER revoke a license without confirming the refund
- ❌ NEVER return vault data to user as compensation (it's their responsibility)
- ❌ NEVER discuss internal server details with the user
- ❌ NEVER accept refund outside Whop (don't send money via PayPal, transfer, etc.)
- ❌ NEVER ignore a chargeback — always respond to it

## Metrics

Track monthly:
- Total refund requests
- Total processed
- Average processing time
- Primary reason for refunds
- Chargeback rate vs refunds
- Post-refund satisfaction (if applicable)

**Goal**: Less than 2% refunds on total sales.

## Whop Contact for Support

- Whop support: https://whop.com/support
- Whop status: https://status.whop.com
- For complex disputes: contact Whop directly
