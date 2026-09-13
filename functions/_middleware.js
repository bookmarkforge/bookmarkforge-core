/**
 * functions/_middleware.js — Cloudflare Pages middleware.
 *
 * Accept-Language negotiation for the bare root: a browser whose PRIMARY
 * language is one of the localized landings gets a 302 redirect to its
 * landing (/fr/, /es/, /de/, /pt/, /it/). Everything else passes through
 * untouched — the `_redirects` rules and the static-assets pipeline serve
 * the request as usual (English users and crawlers without a language
 * preference stay on the EN landing at /).
 *
 * Manual preference override (same contract as nginx + Netlify, pinned by
 * scripts/check-seo.mjs):
 *   - `?lang=<code>` on / (footer/nav language links) is the strongest
 *     signal: it sets the persistent preference cookie (bf_lang + nf_lang)
 *     and 302s to the clean landing URL.
 *   - The bf_lang cookie then overrides Accept-Language entirely — once the
 *     user picks a language manually, the redirect stops bouncing them
 *     (a cookie value of "en" means "serve the EN landing", not
 *     "re-negotiate").
 *   - Accept-Language only applies when NO preference cookie exists (first
 *     visit).
 *
 * 302 (not 301) on purpose: language negotiation must stay temporary so
 * search engines keep the EN canonical at / (Google's guidance). Mirrors
 * the `location = /` rules in public/nginx.conf (Docker path) and the
 * `conditions = { Language = [...] }` 302 rules in netlify.toml (same
 * primary-language semantics — Netlify ignores quality values, and its
 * native nf_lang cookie overrides its Language conditions). All three are
 * pinned by scripts/check-seo.mjs.
 *
 * Pages Functions run before the static-asset pipeline on Cloudflare's
 * edge; `context.next()` continues to `_redirects` + assets.
 */
const LANDING_BY_LANG = {
  es: "/es/",
  fr: "/fr/",
  de: "/de/",
  pt: "/pt/",
  it: "/it/",
};

/** Every preference language, including en ("en" = stop negotiating). */
const PREF_LANGS = ["en", "es", "fr", "de", "pt", "it"];

const COOKIE_MAX_AGE = 31536000; // 1 year
const COOKIE_ATTRS = `Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`;

/**
 * Pick the localized landing for an Accept-Language header, or null when
 * the primary language is not one of ours (EN stays at /). Pure function,
 * unit-tested in scripts/__tests__/check-seo.test.mjs.
 */
export function pickLandingLang(acceptLanguage) {
  if (!acceptLanguage) {
    return null;
  }
  const primary = acceptLanguage.split(",")[0].trim().toLowerCase();
  const lang = primary.split(";")[0].split("-")[0].trim();
  return LANDING_BY_LANG[lang] ?? null;
}

/**
 * Read the bf_lang preference cookie (the user's manual language choice),
 * or null when absent / not one of the known languages. Pure function,
 * unit-tested.
 */
export function pickPreferenceCookie(cookieHeader) {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim().toLowerCase();
    if (name === "bf_lang" && PREF_LANGS.includes(value)) {
      return value;
    }
  }
  return null;
}

/** Landing URL for a preference language ("en" → "/", the EN landing). */
export function landingForLang(lang) {
  return lang === "en" ? "/" : LANDING_BY_LANG[lang] ?? null;
}

function preferenceCookie(name, lang) {
  return `${name}=${lang}; ${COOKIE_ATTRS}`;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname !== "/") {
    return context.next();
  }

  const cookieLang = pickPreferenceCookie(context.request.headers.get("cookie"));
  const paramLang = url.searchParams.get("lang")?.trim().toLowerCase() ?? null;
  const validParam = paramLang && PREF_LANGS.includes(paramLang) ? paramLang : null;
  const chosen = validParam ?? cookieLang;

  if (chosen) {
    const target = landingForLang(chosen);
    // A bf_lang=en cookie on / already means "serve the EN landing": no
    // redirect (and no redirect loop). ?lang=en still bounces once so the
    // cookie lands in the browser.
    if (target === "/" && !validParam) {
      return context.next();
    }
    const res = Response.redirect(new URL(target, url), 302);
    res.headers.append("Set-Cookie", preferenceCookie("bf_lang", chosen));
    res.headers.append("Set-Cookie", preferenceCookie("nf_lang", chosen));
    return res;
  }

  const target = pickLandingLang(context.request.headers.get("accept-language"));
  if (target) {
    return Response.redirect(new URL(target, url), 302);
  }
  return context.next();
}