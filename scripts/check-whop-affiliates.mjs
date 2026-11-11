#!/usr/bin/env node
/**
 * check-whop-affiliates.mjs — read-only snapshot of the Whop affiliate
 * program state for the BookmarkForge merchant account.
 *
 * Calls the Whop REST API (https://api.whop.com/api/v1) with WHOP_API_KEY.
 * The key is never printed; only counts and affiliate-related fields are
 * shown. Read-only: this script issues GET requests only.
 *
 * What it reports:
 *   - GET /affiliates          existing affiliate records (needs the
 *                              `affiliate:basic:read` scope on the key)
 *   - GET /companies/me        account-level affiliate settings such as
 *                              affiliate_application_required and
 *                              featured_affiliate_product_id
 *
 * Usage:
 *   WHOP_API_KEY=... node scripts/check-whop-affiliates.mjs
 *   WHOP_API_KEY=... WHOP_API_BASE=https://sandbox-api.whop.com/api/v1 \
 *     node scripts/check-whop-affiliates.mjs
 *
 * Exit codes: 0 ok, 2 missing key, 1 API error.
 */

const API_BASE = process.env.WHOP_API_BASE ?? "https://api.whop.com/api/v1";
const API_VERSION_DATE = "2026-11-04-1";

const AFFILIATE_FIELDS = new Set([
  "affiliate_application_required",
  "featured_affiliate_product_id",
  "affiliate_commission_percent",
  "affiliate_program_enabled",
  "default_affiliate_commission",
]);

async function whopGet(path, apiKey) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      "api-version-date": API_VERSION_DATE,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, body };
}

function summarizeAffiliates(body) {
  const list = Array.isArray(body) ? body : (body?.data ?? body?.affiliates ?? []);
  const rows = Array.isArray(list) ? list : [];
  return {
    count: rows.length,
    sample: rows.slice(0, 5).map((a) => ({
      id: a.id,
      user: a.user?.username ?? a.user_id ?? a.username ?? null,
      status: a.status ?? null,
    })),
  };
}

function summarizeCompany(body) {
  const company = body?.data ?? body;
  if (!company || typeof company !== "object") return { note: "no company object" };
  const out = {};
  for (const [k, v] of Object.entries(company)) {
    if (AFFILIATE_FIELDS.has(k) || /affiliate|commission|referral/i.test(k)) {
      out[k] = v;
    }
  }
  return {
    id: company.id ?? null,
    title: company.title ?? null,
    affiliateFields: Object.keys(out).length ? out : "none exposed by API",
  };
}

async function main() {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    console.error(
      "WHOP_API_KEY is not set. Use the same key the license server uses " +
        "(Vercel env / secret manager) — it needs the `affiliate:basic:read` " +
        "scope for the affiliates list.",
    );
    process.exit(2);
  }

  const affiliates = await whopGet("/affiliates?first=25", apiKey);
  console.log("== GET /affiliates ==");
  if (!affiliates.ok) {
    console.log(`HTTP ${affiliates.status}: ${JSON.stringify(affiliates.body).slice(0, 400)}`);
    if (affiliates.status === 403) {
      console.log(
        "The key lacks `affiliate:basic:read`. Create a key with that scope " +
          "at https://whop.com/dashboard/developer (the affiliates list is the " +
          "main signal; the company check below may still work).",
      );
    }
  } else {
    console.log(JSON.stringify(summarizeAffiliates(affiliates.body), null, 2));
  }

  const company = await whopGet("/companies/me", apiKey);
  console.log("\n== GET /companies/me ==");
  if (!company.ok) {
    console.log(`HTTP ${company.status}: ${JSON.stringify(company.body).slice(0, 400)}`);
  } else {
    console.log(JSON.stringify(summarizeCompany(company.body), null, 2));
  }

  console.log(
    "\nInterpretation: an empty affiliates list means no affiliate records " +
      "exist yet — the program may still accept applications depending on " +
      "affiliate_application_required. Check the Whop dashboard " +
      "(Marketing → Affiliates) for the program toggle and default rate.",
  );
}

main().catch((err) => {
  console.error(`[check-whop-affiliates] ${err?.message ?? err}`);
  process.exit(1);
});
