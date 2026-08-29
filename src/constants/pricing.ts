/**
 * PRICING STRATEGY - BookmarkForge
 * "The Own Your Brain License" - May 2026
 *
 * Model: one-time payment, lifetime, no subscriptions
 * Marginal cost per user: ~$0 (no own servers)
 *
 * Optimized pricing structure:
 * - Free: 1,000 bookmarks, 1 device (entry point)
 * - Pro: Individual, 3 devices, local AI (most popular)
 * - Team: Shared, 5 devices, team sharing
 * - Enterprise: Group, 15 devices, dedicated support
 *
 * Early Bird Strategy (validated):
 * - Early phase (Weeks 1-2): $79/$189/$369 (53% discount)
 * - Launch phase (Weeks 3-4): $109/$209/$409
 * - Full phase (Week 5+): $159/$269/$509
 *
 * Conservative Projections:
 * - Early Bird: 150-300 sales ($25k-$51k)
 * - Month 1: 250-500 sales ($30k-$60k)
 * - Year 1: 1,500-2,500 sales ($135k-$225k)
 *
 * Competitive Advantage: Lifetime vs $480+ in competitor subscriptions
 */

export const PRICING_CONFIG = {
  tiers: [
    {
      id: "free",
      name: "Free",
      price: 0,
      currency: "USD",
      interval: "forever",
      description:
        "Perfect for trying BookmarkForge and organizing your daily bookmarks.",
      features: [
        { text: "1,000 bookmarks", included: true },
        { text: "Basic search", included: true },
        { text: "1 device", included: true },
        { text: "AI with your own API key (you pay usage)", included: true },
        { text: "Installable PWA (offline-first)", included: true },
        { text: "Knowledge graph", included: true },
        { text: "Basic templates", included: true },
        { text: "JSON/HTML export", included: true },
        { text: "P2P sync", included: false },
        { text: "Local AI (WebLLM)", included: false },
        { text: "Flashcards", included: false },
        { text: "Priority support", included: false },
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
      originalPrice: 159,
      earlyBirdPrice: 79,
      midPrice: 109,
      fullPrice: 159,
      currency: "USD",
      interval: "lifetime",
      description:
        "Your complete digital brain. One-time payment, yours forever.",
      badge: "Early Bird",
      features: [
        { text: "UNLIMITED bookmarks", included: true },
        { text: "3 devices", included: true },
        { text: "P2P sync", included: true },
        { text: "Local AI (WebLLM, no API key)", included: true },
        { text: "Generative AI (summaries, chat)", included: true },
        { text: "RAG Engine + Expert agents", included: true },
        { text: "Full knowledge graph", included: true },
        { text: "Flashcards with spaced repetition", included: true },
        { text: "PDF + OCR", included: true },
        { text: "Advanced export (10+ formats)", included: true },
        { text: "Security vault (AES-GCM)", included: true },
        { text: "Installable PWA (offline-first)", included: true },
        { text: "Updates for 12 months", included: true },
        { text: "Email support", included: true },
      ],
      limitations: {
        maxBookmarks: Infinity,
        maxDevices: 3,
        cloudSync: true,
        localAI: true,
        teamSharing: false,
      },
      cta: "Get Pro",
      popular: true,
    },
    {
      id: "team",
      name: "Team",
      price: 189,
      originalPrice: 269,
      earlyBirdPrice: 189,
      midPrice: 209,
      fullPrice: 269,
      currency: "USD",
      interval: "lifetime",
      description:
        "Share with your partner or small family. Everything in Pro + vault sharing.",
      // NOTE (non-goals, docs/ROADMAP.md): do NOT promise Notion-style
      // collaboration here — "the private individual is the market". Vault
      // sharing (a shipped CollaborationService feature) is the honest
      // ceiling for this tier.
      features: [
        { text: "Everything in Pro included", included: true },
        { text: "5 devices", included: true },
        { text: "Share vault with partner/family", included: true },
        { text: "Shared team templates", included: true },
        { text: "Priority email support", included: true },
      ],
      limitations: {
        maxBookmarks: Infinity,
        maxDevices: 5,
        cloudSync: true,
        localAI: true,
        teamSharing: true,
      },
      cta: "Get Team",
      popular: false,
    },
    {
      id: "empresa",
      name: "Empresa",
      price: 369,
      originalPrice: 509,
      earlyBirdPrice: 369,
      midPrice: 409,
      fullPrice: 509,
      currency: "USD",
      interval: "lifetime",
      description: "For teams, offices, and study groups.",
      // NOTE (non-goals, docs/ROADMAP.md): an "Admin panel" / user management
      // is Notion-style collaboration territory and is NOT on the roadmap. Do
      // not promise it as "coming soon" — it would never ship.
      features: [
        { text: "Everything in Team included", included: true },
        { text: "15 devices", included: true },
        { text: "Dedicated Slack support", included: true },
        { text: "Personalized onboarding", included: true },
      ],
      limitations: {
        maxBookmarks: Infinity,
        maxDevices: 15,
        cloudSync: true,
        localAI: true,
        teamSharing: true,
      },
      cta: "Get Empresa",
      popular: false,
    },
  ],

  // ── Commercial (B2B) license anchors ──────────────────────────────────
  // Market-validated commercial license anchors (D4–D6).
  // These are NOT individual tiers: they
  // license companies that embed / redistribute / host the AGPL codebase.
  // The "no subscriptions" promise covers individuals; B2B is annual by
  // design (D7), matching F2-A's recurring-revenue goal.
  commercialLicenses: [
    {
      id: "integration",
      label: "Integration",
      description: "Embed the vault in one product",
      pricePerYear: 2500, // $2,500 / year (D4: public band Sidekiq Pro → Documenso Platform)
      interval: "year",
      decision: "D4",
    },
    {
      id: "redistribution",
      label: "Redistribution",
      description: "Ship a modified build",
      pricePerYear: 7500, // $7,500 / year (D5: ≈ Qt for Device Creation Professional)
      interval: "year",
      decision: "D5",
    },
    {
      id: "hosting",
      label: "Service / hosting",
      description: "Offer it as a service (AGPL §13 trigger)",
      pricePerYear: 5000, // $5,000 / year flat (D6: ≈ Metabase Pro; no revenue share)
      interval: "year",
      decision: "D6",
    },
  ],

  trial: {
    // Legacy metadata only: local trial timestamps never grant Pro. Any
    // active trial must come from the signed server-side entitlement flow.
    enabled: false,
    days: 7,
    features: "pro",
  },

  earlyBird: {
    enabled: true,
    phase: "early", // 'early' | 'mid' | 'full'
    phases: {
      early: {
        label: "Early Bird",
        validUntilWeeks: 2,
        pro: 79,
        team: 189,
        empresa: 369,
      },
      mid: {
        label: "Launch",
        validUntilWeeks: 4,
        pro: 109,
        team: 209,
        empresa: 409,
      },
      full: {
        label: "Full Price",
        pro: 159,
        team: 269,
        empresa: 509,
      },
    },
  },

  strategies: {
    referral: {
      name: "Referral Program",
      reward: 10,
      maxReferrals: 10,
      description:
        "Refer BookmarkForge and get $10 credit for each friend who buys.",
    },
    upgrade: {
      name: "Upgrade from Free",
      discount: 0,
      description:
        "Free users can activate a 7-day trial to try everything in Pro.",
    },
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
      priceMonthly: 8,
      priceYearly: 96,
      model: "subscription",
      strengths: ["Plugins"],
      weaknesses: ["Complex UI", "Subscription"],
    },
    evernote: {
      priceMonthly: 8,
      priceYearly: 95.88,
      model: "subscription",
      strengths: ["History"],
      weaknesses: ["Expensive", "No local AI"],
    },
    craft: {
      priceMonthly: 5,
      priceYearly: 59.88,
      model: "subscription",
      strengths: ["Design"],
      weaknesses: ["No local AI"],
    },
    anytype: {
      priceMonthly: 0,
      priceYearly: 0,
      model: "free",
      strengths: ["P2P"],
      weaknesses: ["Beta", "No AI"],
    },
    raindrop: {
      priceMonthly: 6,
      priceYearly: 72,
      model: "subscription",
      strengths: ["Bookmarks"],
      weaknesses: ["No AI", "No graph"],
    },
    readwise: {
      priceMonthly: 7,
      priceYearly: 84,
      model: "subscription",
      strengths: ["Highlights"],
      weaknesses: ["No graph", "No offline"],
    },
    logseq: {
      priceMonthly: 0,
      priceYearly: 0,
      model: "freemium",
      strengths: ["Open source"],
      weaknesses: ["No local AI"],
    },
  },

  psychology: {
    anchoring: true,
    bundleEffect: true,
    lifetimePremium:
      "One-time payment vs $96-180/year from competitors. At 2 years you've already paid more with any other tool.",
    fomo: "Early Bird: $79 instead of $159. After week 4 it goes up to full price.",
    trial: "7 days of Pro free so you can try everything with no commitment.",
  },

  projections: {
    earlyBirdTarget: 300,
    month1Target: 500,
    month6Target: 2000,
    year1Target: 5000,
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
    support: "Community",
  },
  pro: {
    bookmarks: "∞ UNLIMITED",
    devices: "3 devices",
    ai: "Local AI (no API key)",
    sync: "P2P (3 devices)",
    graph: true,
    flashcards: true,
    pdf: true,
    support: "Email",
  },
  team: {
    bookmarks: "∞ UNLIMITED",
    devices: "5 devices",
    ai: "Local AI (no API key)",
    sync: "P2P (5 devices)",
    graph: true,
    flashcards: true,
    pdf: true,
    support: "Priority",
  },
  empresa: {
    bookmarks: "∞ UNLIMITED",
    devices: "15 devices",
    ai: "Local AI (no API key)",
    sync: "P2P (15 devices)",
    graph: true,
    flashcards: true,
    pdf: true,
    support: "Dedicated",
  },
};
