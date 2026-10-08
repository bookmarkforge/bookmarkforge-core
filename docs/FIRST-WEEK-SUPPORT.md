# Support Plan — First Week of Launch

> For single operator. This plan helps you manage the initial support load without burning out.

---

## 📅 Day by Day

### Day 1 (Launch)

**Expectation**: Very high initial load. You may receive 20-50 messages on the first day.

**Your checklist**:
- [ ] Monitor GitHub Issues (Issues tab)
- [ ] Monitor store reviews (Chrome + Firefox)
- [ ] Monitor Whop (orders dashboard)
- [ ] Respond to EVERYTHING in <24h
- [ ] Document each ticket in logs

**Priority**:
1. 🔴 Purchases not activating (license)
2. 🔴 Extension not working
3. 🟡 General questions
4. 🟢 Feature requests

**Ready-to-copy/paste templates**:
- ✅ FAQ → `docs/FAQ-SOPORTE.md`
- ✅ Runbook → `docs/support-license-runbook.md`
- ✅ Refunds → `docs/REFUND-POLICY.md`

---

### Days 2-3

**Expectation**: Less load than Day 1, but repetitive questions start appearing.

**Actions**:
- [ ] Update FAQ with most frequent questions from Day 1
- [ ] Write response templates for repetitive questions
- [ ] Verify server is still running
- [ ] Review server logs
- [ ] Verify Whop is still processing correctly

**Metrics**:
- Tickets received: how many?
- Average response time
- Average resolution time
- Most common category

---

### Days 4-5

**Expectation**: Load stabilizing. First store reviews appearing.

**Actions**:
- [ ] Respond to ALL reviews (positive and negative)
- [ ] If there are negative reviews:
  - Respond courteously
  - Ask for Order ID
  - Try to resolve
- [ ] Verify refund process works
- [ ] Review `support-chargebacks-log.md` and `support-refunds-log.md`
- [ ] Update FAQ with new questions

---

### Days 6-7

**Expectation**: Initial week stabilizing. Evaluate metrics.

**Actions**:
- [ ] Weekly ticket summary
- [ ] Review summary
- [ ] Review installation and usage metrics
- [ ] Plan next week
- [ ] Verify processes work well

---

## 🎯 Quick Response Templates

### For sales/general questions
```
Thank you for your interest in BookmarkForge!

To purchase: https://whop.com/bookmarkforge
For help: include your Order ID in the ticket.

All data is encrypted and local.
We never ask for your password or recovery phrase.

Response time: <24h
```

### For technical issues
```
Thank you for reporting this. To help you better:

1. What browser and version do you use?
2. Did this happen since you updated something?
3. Can you share a screenshot?

Meanwhile:
- Clear browser cache
- Update to latest version
- Try in incognito mode

If it's a license issue, include your Order ID.

Response time: <24h
```

### For refunds
```
I understand you want a refund. To process it:

1. Go to https://whop.com/orders
2. Request refund there
3. Refund takes 3-7 business days
4. Once processed, your license is automatically revoked
5. Your vault data is NOT affected

If you need help with Whop, I can escalate.

Response time: <12h
```

### For spam/empty tickets
```
Hello,

Thank you for contacting us. To help you, please include:
- Your Order ID (if you purchased)
- The specific problem you have
- What browser you use

Without this data we cannot investigate your case.

Thanks,
The BookmarkForge team
```

---

## 📊 Weekly Metrics (to track)

| Metric | Day 1 | Day 2-3 | Day 4-5 | Day 6-7 |
|--------|-------|---------|---------|---------|
| Tickets received | ? | ? | ? | ? |
| Avg response time | ? | ? | ? | ? |
| Avg resolution time | ? | ? | ? | ? |
| Refunds processed | ? | ? | ? | ? |
| Positive/negative reviews | ? | ? | ? | ? |
| Installations (Chrome) | ? | ? | ? | ? |
| Installations (Firefox) | ? | ? | ? | ? |
| Whop sales | ? | ? | ? | ? |

---

## 🔴 Escalation

### When to escalate (you can't resolve alone)

| Situation | Escalate to | Time |
|-----------|------------|------|
| Critical server bug | GitHub Issues + immediate fix | <24h |
| Whop API not responding | Whop support | <2h |
| Domain lost | Registrar + purchase new | Immediate |
| SSL expired | Let's Encrypt + renew | Immediate |
| Server down | Restart Docker + verify | <1h |
| Too many tickets for 1 person | Consider hiring help | Plan |

### Escalation to Whop

Contact Whop for:
- Complex bank disputes (chargebacks)
- Technical issues with Whop API
- Account blocked or limited
- Webhooks not delivering

---

## 🧠 Tips for Single Operator

### Productivity
1. **Respond in batches**: Don't answer ticket by ticket. Respond every 2h in blocks.
2. **Use templates**: Each response should take <5 min with templates.
3. **Document everything**: Each ticket, resolution, and lesson learned.
4. **Block time**: Dedicate 2h blocks for support, then return to development.

### Mental health
1. **Don't respond angry**: If a ticket frustrates you, wait 30 min.
2. **Don't promise what you can't**: If you don't know, say "I'll investigate and respond in <24h".
3. **Distinguish urgency from importance**: A critical bug is urgent; a feature request is not.
4. **Rest**: Don't work more than 12h straight in the first days.

### Ticket prevention
1. **Clear FAQ**: The more answers in FAQ, the fewer tickets you receive.
2. **Excellent documentation**: If a user can resolve alone, you don't need support.
3. **Clear onboarding**: Guide user from purchase to successful use.
4. **Proactive communication**: Announce maintenance before users notice.

---

## 📞 Emergency Contacts

| Service | Contact | Response time |
|---------|---------|---------------|
| Whop Support | https://whop.com/support | <2h |
| Whop Status | https://status.whop.com | Real-time |
| Chrome Web Store | https://support.google.com/chrome_webstore | <24h |
| Firefox AMO | https://support.mozilla.org | <24h |
| GitHub Issues | Your repo issues | Variable |
| Let's Encrypt | https://letsencrypt.org/docs/ | 1-3 days |

---

> **Remember**: As a single person, you can't resolve everything instantly. You're launching an excellent product — users will understand. What matters is responding, being honest, and resolving.
