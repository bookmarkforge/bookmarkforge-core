/**
 * functions/_middleware.js — Cloudflare Pages middleware.
 *
 * Accept-Language negotiation for the bare root: a browser whose PRIMARY
 * language is one of the localized landings gets a 302 redirect to its
 * landing (/fr/, /es/, ... — every locale in LANDING_BY_LANG, 29 of them
 * since the 30-locale expansion; EN is the root landing itself). Everything
 * else passes through untouched — the `_redirects` rules and the
 * static-assets pipeline serve the request as usual (English users and
 * crawlers without a language preference stay on the EN landing at /).
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
 * The three layers carry ONE list, not two: the explicit preference
 * (`?lang=` / bf_lang) and the implicit negotiation (Accept-Language) cover
 * exactly the same 29 languages. Netlify is why — its preference mechanism
 * IS its Language condition (the platform matches the nf_lang cookie
 * against those same rules), so a language the middleware knew but Netlify
 * did not would honour the choice on two hosts out of three. When this list
 * was 6, picking 日本語 from the 30-language dropdown set the cookie and then
 * silently served English on the next visit to /.
 *
 * Pages Functions run before the static-asset pipeline on Cloudflare's
 * edge; `context.next()` continues to `_redirects` + assets.
 */
/**
 * Landing URLs and preference languages come from
 * scripts/landing-registry.mjs — the single source of truth for the
 * 30-locale set (29 localized routes + EN at the root). Deriving here
 * closes the bug class this file once shipped: the hand-written copy
 * stayed at 6 while the dropdown offered 30, so landing.js wrote a
 * bf_lang cookie this middleware then silently dropped.
 *
 * NOTE FOR THE EDGE: Pages Functions bundle relative imports at deploy
 * (esbuild, `wrangler pages functions build`), so
 * "../scripts/landing-registry.mjs" ships inside the worker bundle. That
 * step is itself under test: scripts/__tests__/middleware-bundle.test.mjs
 * compiles this file the way the runtime does and drives the BUILT module,
 * so a pipeline that stops inlining the registry (or leaves the import
 * external) fails there with the edge's own load error. No need to re-inline
 * the constants by hand — the other contract tests (check-seo.test.mjs +
 * middleware-language-preference.test.mjs) only pin the SOURCE, so they stay
 * green while the deployed worker is the thing that breaks.
 */
import {
  LOCALIZED_LANDING_CODES,
  PREF_LANGS,
} from "../scripts/landing-registry.mjs";

/** Landing URL per localized code ("en" is the root landing, not a target). */
const LANDING_BY_LANG = Object.fromEntries(
  LOCALIZED_LANDING_CODES.map((code) => [code, `/${code}/`]),
);

const COOKIE_MAX_AGE = 31536000; // 1 year
const COOKIE_ATTRS = `Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`;

/**
 * Pick the localized landing for an Accept-Language header, or null when
 * the primary language is not one of ours (EN stays at /). Covers every
 * locale in LANDING_BY_LANG — same set as the manual preference, so a
 * language can never be choosable from the dropdown but unnegotiable at the
 * edge. Pure function, unit-tested in scripts/__tests__/check-seo.test.mjs.
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
    // Deliberately NOT Response.redirect(): the fetch spec gives a redirect
    // response an IMMUTABLE header guard, so appending to it throws
    // "TypeError: immutable" (cloudflare/workers-sdk#5378). That turned this
    // preference path into a 500 on the edge — the 302 was never sent, and
    // with it went the cookies. Build the redirect explicitly; these headers
    // are ours to write.
    const res = new Response(null, {
      status: 302,
      headers: { Location: new URL(target, url).toString() },
    });
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