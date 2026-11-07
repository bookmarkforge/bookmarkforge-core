/**
 * scripts/legal-identity.mjs — the single source of truth for the identity of
 * the data controller behind BookmarkForge.
 *
 * Why this module exists
 * ----------------------
 * Three surfaces used to name three different controllers: the public legal
 * notice said "BookmarkForge (contact in section 17)" with no entity at all,
 * docs/PRIVACY-POLICY.md said "Leonardo, Castrelos, Vigo, Spain", and
 * legal/REGISTRO.md still carried the placeholder "[NOMBRE LEGAL / ENTIDAD]".
 * GDPR Art. 13(1)(a) requires the identity and contact details of the
 * controller — a notice that names three different controllers names none.
 *
 * Every surface now reads the SAME values from here, and
 * scripts/check-legal-consolidation.mjs fails when one of them drifts.
 *
 * The values are the real ones already published by the project (e-mail,
 * municipality, repository). The operator's FULL legal name and tax
 * identifier are NOT known yet: they are tracked as a launch blocker in
 * legal/REGISTRO.md and docs/ROPA.md, and the notice below is the fallback
 * until they are filled in.
 */

/** The product name as it appears in every notice. */
export const CONTROLLER_BRAND = "BookmarkForge";

/** The natural person operating the project (GDPR Art. 4(7) controller). */
export const CONTROLLER_OPERATOR = "Leonardo";

/** Municipality of establishment (Art. 13(1)(a) contact details). */
export const CONTROLLER_LOCALITY = "Castrelos, Vigo, Spain";

/** The single contact channel for privacy and data-subject requests. */
export const CONTROLLER_EMAIL = "bookmarkforge@proton.me";

/** Public source repository (support channel + change history). */
export const CONTROLLER_REPOSITORY = "https://github.com/bookmarkforge/bookmarkforge";

/**
 * The identity block as the English surfaces state it. Every surface that
 * carries the identity must carry this exact block (or a subset of it).
 */
export const CONTROLLER_IDENTITY = {
  brand: CONTROLLER_BRAND,
  operator: CONTROLLER_OPERATOR,
  locality: CONTROLLER_LOCALITY,
  email: CONTROLLER_EMAIL,
  repository: CONTROLLER_REPOSITORY,
};

/**
 * The one-sentence statement used by the legal notice: who the controller is,
 * where it is established and how to reach it.
 */
export const CONTROLLER_SENTENCE =
  `The data controller for the processing described in this policy is ${CONTROLLER_BRAND}, ` +
  `operated by ${CONTROLLER_OPERATOR} (${CONTROLLER_LOCALITY}). ` +
  `Privacy questions and data subject requests: ${CONTROLLER_EMAIL}.`;

/**
 * Tokens that identify the controller. A surface that carries the identity
 * must carry the operator name and the contact e-mail — the two values that
 * are language-independent — so the check works on translated notices too.
 */
export const CONTROLLER_MARKERS = [CONTROLLER_OPERATOR, CONTROLLER_EMAIL];

/**
 * E-mail addresses that must NOT appear as the controller contact on a legal
 * surface: any other address is a divergence between two notices.
 */
export const FOREIGN_CONTACT_RE = /[\w.+-]+@[\w.-]+\.\w{2,}/g;

/**
 * The surfaces that MUST state the controller's identity. GDPR Art. 13(1)(a)
 * requires the identity and the contact details of the controller; a notice
 * that names a different controller in every document names none.
 *
 * The list covers the public notice (English), its five reviewed
 * translations, and the internal references (privacy policy, ROPA, extension
 * policy, private register).
 */
export const IDENTITY_SURFACES = [
  "public/privacy-and-terms.html",
  "public/es/privacy-and-terms.html",
  "public/fr/privacy-and-terms.html",
  "public/de/privacy-and-terms.html",
  "public/pt/privacy-and-terms.html",
  "public/it/privacy-and-terms.html",
  "docs/PRIVACY-POLICY.md",
  "docs/PRIVACY-EXTENSION.md",
  "docs/ROPA.md",
  "legal/REGISTRO.md",
];

/**
 * The e-mail addresses a legal surface may carry. Today there is exactly one
 * channel for privacy questions and data-subject requests; a second address
 * that only one document knows about is a divergence, not a convenience.
 * Adding one here is a deliberate act.
 */
export const ALLOWED_LEGAL_EMAILS = [CONTROLLER_EMAIL];

/**
 * The sub-processor parity contract (GDPR Art. 13(1)(f) / 14(1)(f): the
 * recipients of the data, or the CATEGORIES of recipients).
 *
 * Each row of legal/REGISTRO.md is a processing relationship with a named
 * counterparty. Each of those counterparties must also appear in EVERY
 * published legal notice — a notice that omits a sub-processor the register
 * lists under-declares the processing, and a register that omits a
 * sub-processor the notice names over-declares it. Both are audit findings.
 *
 * `register`  — the marker that identifies the row in legal/REGISTRO.md.
 * `notices`   — the marker that identifies the same counterparty in each
 *               published notice. The markers are language-independent by
 *               design (a product name, an acronym, a domain) so the check
 *               works on the translated notices too.
 */
export const SUBPROCESSOR_PARITY = [
  {
    id: "P-01",
    register: "Whop",
    notices: {
      en: "Whop",
      es: "Whop",
      fr: "Whop",
      de: "Whop",
      pt: "Whop",
      it: "Whop",
    },
  },
  {
    id: "P-02",
    register: "hosting web",
    notices: {
      en: "CDN",
      es: "CDN",
      fr: "CDN",
      de: "CDN",
      pt: "CDN",
      it: "CDN",
    },
  },
  {
    id: "P-03",
    register: "GitHub",
    notices: {
      en: "GitHub",
      es: "GitHub",
      fr: "GitHub",
      de: "GitHub",
      pt: "GitHub",
      it: "GitHub",
    },
  },
  {
    id: "P-04",
    register: "correo transaccional",
    notices: {
      en: "Transactional e-mail provider",
      es: "correo electrónico transaccional",
      fr: "e-mail transactionnel",
      de: "Transaktions-E-Mails",
      pt: "e-mail transacional",
      it: "e-mail transazionale",
    },
  },
  {
    id: "P-05",
    register: "Sentry",
    notices: {
      en: "Sentry",
      es: "Sentry",
      fr: "Sentry",
      de: "Sentry",
      pt: "Sentry",
      it: "Sentry",
    },
  },
  {
    id: "P-06",
    register: "relay WebRTC",
    notices: {
      en: "rxdb.info",
      es: "rxdb.info",
      fr: "rxdb.info",
      de: "rxdb.info",
      pt: "rxdb.info",
      it: "rxdb.info",
    },
  },
  {
    id: "P-07",
    register: "IA externos",
    notices: {
      en: "OpenAI",
      es: "OpenAI",
      fr: "OpenAI",
      de: "OpenAI",
      pt: "OpenAI",
      it: "OpenAI",
    },
  },
  {
    id: "P-08",
    register: "dominio / DNS",
    notices: {
      en: "DNS",
      es: "DNS",
      fr: "DNS",
      de: "DNS",
      pt: "DNS",
      it: "DNS",
    },
  },
  {
    id: "P-09",
    register: "almacenamiento cloud",
    notices: {
      en: "WebDAV",
      es: "WebDAV",
      fr: "WebDAV",
      de: "WebDAV",
      pt: "WebDAV",
      it: "WebDAV",
    },
  },
];

/**
 * The root of the private legal workspace. The register's `evidence_ref`
 * column points into it (`proveedores/whop/`), so the gate can prove that
 * every referenced evidence folder exists instead of trusting the column.
 */
export const LEGAL_WORKSPACE_ROOT = "legal";
