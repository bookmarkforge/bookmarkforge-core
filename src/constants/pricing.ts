/**
 * PRICING STRATEGY — BookmarkForge v1
 * "Lifetime of the major version" — pays once, owns forever.
 *
 * Model: Lifetime License for Major Version (no subscriptions)
 * — Buy Pro v1 once, use v1.x forever (all minor + patch + security updates forever).
 * — Includes 12 months of feature updates from purchase date.
 * — After month 13 you keep v1 functional forever, only without new features.
 * — v2.0 (paid major) is a new product: $89 for new customers, $35 for v1 owners (60% off).
 * — Founder Edition: same Pro v1 binary, vanity badge + lifetime 60% off future majors.
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
 * - Founder (100-200 limited): $99 — same Pro v1, badge Founder #042 + 60% off v2 lifetime + beta
 *
 * Individual tiers stay lifetime; B2B commercial licenses stay annual (D7).
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
      description: "Try BookmarkForge private and local-first. 1,000 bookmarks to start.",
      features: [
        { text: "1,000 bookmarks, notes, documents", included: true },
        { text: "Full-text & semantic search", included: true },
        { text: "1 device", included: true },
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
        maxBookmarks: 1000,
        maxDevices: 1,
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
      description: "Unlimited bookmarks, 3 devices, local AI. Pay once, yours forever (v1).",
      badge: "Most Popular",
      earlyBadge: "Early Bird — 200 left",
      features: [
        { text: "Everything in Free", included: true },
        { text: "Unlimited bookmarks", included: true },
        { text: "3 devices + P2P sync", included: true },
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
        maxDevices: 3,
        cloudSync: true,
        localAI: true,
        teamSharing: false,
      },
      cta: "Get Pro Lifetime",
      popular: true,
    },
    {
      id: "founder",
      name: "Founder",
      price: 99,
      currency: "USD",
      interval: "lifetime",
      lifetimeLine: "Lifetime of v1 · Founder # · Beta access · v2 60% off lifetime",
      description: "Same Pro v1, vanity + priority. Founder badge in app + beta access. 100 limited.",
      badge: "Founder — 100 limited",
      vanity: true,
      limitedSupply: 100,
      features: [
        { text: "Everything in Pro", included: true },
        { text: "Founder badge #042 in app", included: true },
        { text: "Beta access to v2 early builds", included: true },
        { text: "60% off v2 (and v3) forever for this account", included: true },
        { text: "Lifetime of v1 · Security forever", included: true },
        { text: "30-day refund via Whop", included: true },
      ],
      limitations: {
        maxBookmarks: Infinity,
        maxDevices: 3,
        cloudSync: true,
        localAI: true,
        teamSharing: false,
      },
      cta: "Get Founder",
      popular: false,
    },
  ],

  // ── Commercial (B2B) license anchors ──────────────────────────────────
  // These are NOT individual tiers: they license companies that embed / redistribute / host the AGPL codebase.
  commercialLicenses: [
    {
      id: "integration",
      label: "Integration",
      description: "Embed the vault in one product",
      pricePerYear: 2500,
      interval: "year",
      decision: "D4",
    },
    {
      id: "redistribution",
      label: "Redistribution",
      description: "Ship a modified build",
      pricePerYear: 7500,
      interval: "year",
      decision: "D5",
    },
    {
      id: "hosting",
      label: "Service / hosting",
      description: "Offer it as a service (AGPL §13 trigger)",
      pricePerYear: 5000,
      interval: "year",
      decision: "D6",
    },
  ],

  trial: {
    enabled: false,
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
      founder: 100,
    },
    phases: {
      early: {
        label: "Early Bird",
        tagline: "Launch price — 200 licenses",
        validUntilWeeks: 2,
        pro: 59,
        founder: 99,
      },
      regular: {
        label: "Regular v1",
        tagline: "Lifetime of v1",
        validUntilWeeks: 26,
        pro: 79,
        founder: 99,
      },
      full: {
        label: "Full Price",
        tagline: "After traction",
        pro: 99,
        founder: 129,
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
      founder: {
        channel: "Email priority — bookmarkforge@proton.me (Founder)",
        response: "24h (business days)",
        availability: "Priority queue + beta access",
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
    fomo: "Early Bird $59 (200 licenses) → Regular $79 → Full $99. Founder $99 limited 100.",
    trial: "No trial paywall — Free 1,000 bookmarks forever to evaluate. Pro is lifetime of v1.",
  },

  projections: {
    earlyBirdTarget: 200,
    month1Target: 500,
    month6Target: 2000,
    year1Target: 5000,
    // Founder cap 100 × $99 = $9.9k vanity revenue at no extra feature cost
  },
};

export const LICENSE_FEATURES = {
  free: {
    bookmarks: "1,000 bookmarks",
    devices: "1 device",
    ai: "With your API key",
    sync: "No",
    graph: true,
    flashcards: false,
    pdf: false,
    support: "Community — /help",
  },
  pro: {
    bookmarks: "∞ UNLIMITED",
    devices: "3 devices",
    ai: "Local AI (no API key)",
    sync: "P2P (3 devices)",
    graph: true,
    flashcards: true,
    pdf: true,
    support: "Email 48h",
  },
  founder: {
    bookmarks: "∞ UNLIMITED",
    devices: "3 devices",
    ai: "Local AI (no API key)",
    sync: "P2P (3 devices)",
    graph: true,
    flashcards: true,
    pdf: true,
    support: "Priority 24h + Beta",
  },
};
