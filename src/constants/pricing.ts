/**
 * PRICING STRATEGY — BookmarkForge v1
 * "Lifetime of the major version" — pays once, owns forever.
 *
 * Model: Lifetime License for Major Version (no subscriptions)
 * — Buy Pro v1 once, use v1.x forever (all minor + patch + security updates forever).
 * — Includes 12 months of feature updates from purchase date.
 * — After month 13 you keep v1 functional forever, only without new features.
 * — v2.0 (paid major) is a new product: $89 for new customers, $35 for v1 owners (60% off).

 *
 * Why this beats subscription:
 * - User local-first hates recurring billing (same persona as Obsidian $0+Sync $48/y).
 * - Raindrop $28-38/y and Instapaper $60/y prove the ceiling; $79 lifetime = 2× Raindrop annual, 1.3× Instapaper — justified by lifetime + privacy.
 * - Affinity/Sketch/Sublime proved versioned lifetime is sustainable without churn.
 *
 * Launch ladder:
 * - Early Bird (200 licenses): Pro $59 — FOMO real
 * - Regular v1 (next 6-12mo): Pro $79 — anchor < $100 psychological
 * - Post-traction / v1.5: Pro $89-99 — after 500+ reviews, A/B $79 vs $99

 *
*/

export const PRICING_CONFIG = {
  /** Lifetime versioned contract — legal text pinned in landing + privacy-and-terms + JSON-LD. */
  lifetimeVersioned: {
    majorVersion: 1,
    label: "Lifetime license for BookmarkForge v1",
    includes: "All v1.x updates (bugfixes + minor features) forever + 12 months of feature updates from purchase. Security updates forever.",
    upgradeDiscountPct: 60,
    upgradePolicy: "Future major versions (v2, v3) are separate products: $89 for new customers, $35 for v1 owners (60% off). If you don't upgrade you keep v1 functional forever.",
    legalLine: "Lifetime license for BookmarkForge v1. Includes all v1.x updates and 12 months of feature updates. Security updates forever. Future major versions (v2, v3) 60% off for existing owners. 30-day refund via Whop.",
    refundDays: 30,
  },

  tiers: [
    {
      id: "free",
      name: "Free",
      price: 0,
      currency: "USD",
      interval: "forever",
      description: "Free forever: 2,500 bookmarks plus the smart search competitors charge yearly for. At 2,500 the vault stays whole — reading, search and export never stop; only new saves pause.",
      features: [
        { text: "Smart search (full-text + semantic) — included free; Raindrop charges yearly for this", included: true },
        { text: "2,500 bookmarks, notes, documents", included: true },
        { text: "Works on any device — each keeps its own vault", included: true },
        { text: "AI with your own API key (you pay usage)", included: true },
        { text: "Knowledge graph", included: true },
        { text: "Basic templates", included: true },
        { text: "JSON/HTML export", included: true },
        { text: "PWA + browser extensions", included: true },
        { text: "P2P sync across devices", included: false },
        { text: "Local AI (WebLLM/Ollama) & RAG chat", included: false },
        { text: "Flashcards + PDF/OCR", included: false },
        { text: "Advanced export (10+ formats)", included: false },
      ],
      limitations: {
        maxBookmarks: 2500,
        maxDevices: 0,
        cloudSync: false,
        localAI: false,
        teamSharing: false,
      },
      cta: "Start Free",
      popular: false,
    },
    {
      id: "pro",
      name: "Pro",
      price: 79,
      // Display ladder — active phase controlled by earlyBird.phase
      originalPrice: 79,
      earlyBirdPrice: 59,
      regularPrice: 79,
      fullPrice: 99,
      upgradePriceNew: 89,
      upgradePriceOwner: 35,
      currency: "USD",
      interval: "lifetime",
      // Human-readable lifetime line — landed here + landing.html + privacy-and-terms
      lifetimeLine: "Lifetime of v1 · 12 months feature updates · Security forever · v2 60% off",
      description: "Unlimited bookmarks, 5 devices, local AI. Pay once, yours forever (v1).",
      badge: "Most Popular",
      earlyBadge: "Early Bird — 200 left",
      features: [
        { text: "Everything in Free", included: true },
        { text: "Unlimited bookmarks", included: true },
        { text: "5 devices + P2P sync", included: true },
        { text: "Local AI (WebLLM, no API key)", included: true },
        { text: "RAG chat over your data + Expert agents", included: true },
        { text: "Flashcards with spaced repetition", included: true },
        { text: "PDF + OCR", included: true },
        { text: "Advanced export (10+ formats) + Encrypted backups", included: true },
        { text: "Security vault (AES-GCM)", included: true },
        { text: "Lifetime of v1 · 12 months feature updates", included: true },
        { text: "Security updates forever", included: true },
        { text: "30-day refund via Whop", included: true },
      ],
      limitations: {
        maxBookmarks: Infinity,
        maxDevices: 5,
        cloudSync: true,
        localAI: true,
        teamSharing: false,
      },
      cta: "Get Pro Lifetime",
      popular: true,
    },

  ],

  trial: {
    enabled: true,
    days: 7,
    features: "pro",
  },

  earlyBird: {
    enabled: true,
    // Controls which price the landing shows: 'early' | 'regular' | 'full'
    // Early = $59 (200 licenses FOMO) → Regular = $79 anchor → Full = $99 post-traction
    phase: "early" as "early" | "regular" | "full",
    caps: {
      early: 200,
    },
    phases: {
      early: {
        label: "Early Bird",
        tagline: "Launch price — 200 licenses",
        validUntilWeeks: 2,
        pro: 59,
      },
      regular: {
        label: "Regular v1",
        tagline: "Lifetime of v1",
        validUntilWeeks: 26,
        pro: 79,
      },
      full: {
        label: "Full Price",
        tagline: "After traction",
        pro: 99,
      },
    },
  },

  /** Upgrade pricing — recurring revenue without subscriptions */
  upgrade: {
    v2: {
      newCustomerPrice: 89,
      ownerPrice: 35,
      discountPct: 60,
      label: "v2.0 — 60% off for v1 owners",
    },
    v3: {
      newCustomerPrice: 99,
      ownerPrice: 39,
      discountPct: 60,
      label: "v3.0 — 60% off for owners",
    },
  },

  strategies: {
    referral: {
      name: "Referral Program",
      reward: 10,
      maxReferrals: 10,
      description: "Refer BookmarkForge and get $10 credit for each friend who buys.",
    },
    upgrade: {
      name: "Upgrade from Free",
      discount: 0,
      description: "Free users can upgrade to Pro Lifetime v1 anytime — no trial paywall.",
    },
  },

  // ── Support SLA by tier ───────────────────────────────────────────────
  // Keeps support sustainable at single-maintainer scale.
  support: {
    tiers: {
      free: {
        channel: "Community — Docs + /help + GitHub Discussions",
        response: "Best effort (community)",
        availability: "Self-service: /help, error codes BF-E*, diagnostics copy",
      },
      pro: {
        channel: "Email — bookmarkforge@proton.me",
        response: "48h (business days)",
        availability: "Mon–Fri, email + early access",
      },
    },
    // Public commitment: where the line is drawn
    note: "Vault is encrypted — we cannot see your data. Forgot password cannot be recovered without the 24-word recovery phrase. Support never asks for your vault password or recovery phrase.",
  },

  competitors: {
    notion: {
      priceMonthly: 8,
      priceYearly: 96,
      model: "subscription",
      strengths: ["Collaboration"],
      weaknesses: ["No offline", "Subscription"],
    },
    obsidian: {
      priceMonthly: 0,
      priceYearly: 48,
      model: "freemium-sync",
      strengths: ["Local-first", "Plugins"],
      weaknesses: ["Sync is paid add-on"],
    },
    raindrop: {
      priceMonthly: 3,
      priceYearly: 33,
      model: "subscription",
      strengths: ["Bookmarks"],
      weaknesses: ["No local AI", "Cloud only"],
    },
    readwise: {
      priceMonthly: 9.99,
      priceYearly: 120,
      model: "subscription",
      strengths: ["Read-later premium"],
      weaknesses: ["$120/y", "No graph"],
    },
    capacities: {
      priceMonthly: 9.99,
      priceYearly: 120,
      model: "subscription",
      strengths: ["Free core + AI upsell"],
      weaknesses: ["$120/y Pro"],
    },
    instapaper: {
      priceMonthly: 5.99,
      priceYearly: 60,
      model: "subscription",
      strengths: ["Read-later ceiling"],
      weaknesses: ["Doubled 2025"],
    },
  },

  psychology: {
    anchoring: true,
    bundleEffect: true,
    lifetimePremium: "One-time payment vs $96-120/year from competitors. At 2 years you've already paid more with any other tool. BookmarkForge: pay once, own v1 forever.",
    fomo: "Early Bird $59 (200 licenses) → Regular $79 → Full $99.",
    trial: "No trial paywall — Free 2,500 bookmarks forever to evaluate. Pro is lifetime of v1.",
  },

  projections: {
    earlyBirdTarget: 200,
    month1Target: 500,
    month6Target: 2000,
    year1Target: 5000,
  },
};

export const LICENSE_FEATURES = {
  free: {
    bookmarks: "2,500 bookmarks",
    devices: "Any device (per-device vaults)",
    ai: "With your API key",
    sync: "No",
    graph: true,
    flashcards: false,
    pdf: false,
    support: "Community — /help",
  },
  pro: {
    bookmarks: "∞ UNLIMITED",
    devices: "5 devices",
    ai: "Local AI (no API key)",
    sync: "P2P (5 devices)",
    graph: true,
    flashcards: true,
    pdf: true,
    support: "Email 48h",
  },
};

/**
 * The Pro price the CURRENT early-bird phase displays, formatted for in-app
 * copy ("$59"). Single source of truth: derived from PRICING_CONFIG so the
 * nudge's price can never drift from the pricing table or the landing.
 */
export function getActiveProPrice(): string {
  const phase = PRICING_CONFIG.earlyBird.phase;
  const pro = PRICING_CONFIG.tiers[1];
  if (!pro) {
    throw new Error("PRICING_CONFIG.tiers[1] (Pro) is missing — pricing table corrupted");
  }
  const price =
    phase === "early"
      ? pro.earlyBirdPrice
      : phase === "regular"
        ? pro.regularPrice
        : pro.fullPrice;
  return `$${price}`;
}

/**
 * Pro's sync-device ceiling from PRICING_CONFIG (3). Single source of truth
 * for in-app copy — the nudge's "sync between your devices (up to 3)" line
 * can never drift from the pricing table.
 */
export function getProDeviceLimit(): number {
  const pro = PRICING_CONFIG.tiers[1];
  if (!pro) {
    throw new Error("PRICING_CONFIG.tiers[1] (Pro) is missing — pricing table corrupted");
  }
  return pro.limitations.maxDevices;
}
