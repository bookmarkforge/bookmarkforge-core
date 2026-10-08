// @vitest-environment node
/**
 * functions/_middleware.js — language preference and negotiation, end to end.
 *
 * check-seo.test.mjs pins the CONTRACT (the three host layers carry the same
 * 30-locale list, by string match) and unit-tests the pure helpers. This file
 * tests the BEHAVIOUR those helpers exist for: what a real request to "/"
 * actually gets back. The distinction matters here, because the bug that
 * motivated it was invisible to both — every layer looked consistent and every
 * helper worked in isolation, yet a visitor who picked 日本語 from the 30-rel
 * dropdown was served English on the next visit: public/landing.js wrote the
 * bf_lang cookie for 30 locales and the middleware only recognised 6, so the
 * cookie was silently dropped (see ADR-055's sibling note on the preference).
 *
 * Node environment on purpose: the middleware returns a real Response.
 */
import { describe, expect, it } from "vitest";
import { onRequest } from "../../functions/_middleware.js";
import { LANDING_LANG_CODES } from "../check-seo.mjs";

const SITE = "https://bookmarkforgeapp.com";
const nextCalled = () => new Response("next");

function invoke(pathname, headers = {}) {
  return onRequest({
    request: new Request(new URL(pathname, SITE), { headers }),
    next: nextCalled,
  });
}

/** Set-Cookie values, whichever API this undici exposes. */
function setCookies(res) {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  return (res.headers.get("set-cookie") ?? "").split(/,\s*(?=[^;=]+=)/);
}

function redirectPath(res) {
  const location = res.headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

describe("Cloudflare middleware — language preference", () => {
  it("honours the bf_lang preference of every shipped locale", async () => {
    for (const lang of LANDING_LANG_CODES) {
      const res = await invoke("/", { cookie: `theme=dark; bf_lang=${lang}` });
      expect(res.status).toBe(302);
      expect(redirectPath(res)).toBe(`/${lang}/`);
      // Both cookies are re-issued, so the choice stays sticky across visits
      // (bf_lang for nginx + this middleware, nf_lang for Netlify). Two
      // SEPARATE Set-Cookie headers: folded into one comma-joined header, a
      // browser would keep only the first (the Cloudflare community hit this
      // with Headers.append).
      const cookies = setCookies(res);
      expect(cookies).toHaveLength(2);
      const joined = cookies.join(" | ");
      expect(joined).toContain(`bf_lang=${lang};`);
      expect(joined).toContain(`nf_lang=${lang};`);
    }
  });

  it("negotiates the same set from Accept-Language when there is no choice yet", async () => {
    for (const lang of LANDING_LANG_CODES) {
      const res = await invoke("/", { "accept-language": `${lang}-XX,${lang};q=0.9,en;q=0.8` });
      expect(res.status).toBe(302);
      expect(redirectPath(res)).toBe(`/${lang}/`);
    }
  });

  it("keeps EN and unknown visitors on the root landing", async () => {
    // No preference and a non-localized browser: pass through to the EN page.
    const plain = await invoke("/");
    expect(plain.status).toBe(200);
    expect(await plain.text()).toBe("next");

    const enBrowser = await invoke("/", { "accept-language": "en-US,en;q=0.9" });
    expect(enBrowser.status).toBe(200);

    const unknownBrowser = await invoke("/", { "accept-language": "xx-YY,xx;q=0.9" });
    expect(unknownBrowser.status).toBe(200);
  });

  it("treats bf_lang=en as 'stop negotiating, serve EN' without a redirect loop", async () => {
    const res = await invoke("/", { cookie: "bf_lang=en", "accept-language": "ja-JP,ja;q=0.9" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("next");
  });

  it("ignores an unknown cookie instead of trusting it", async () => {
    const res = await invoke("/", { cookie: "bf_lang=xx" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("next");
  });

  it("records ?lang= for the new locales and bounces to their clean URL", async () => {
    const res = await invoke("/?lang=ja");
    expect(res.status).toBe(302);
    expect(redirectPath(res)).toBe("/ja/");
    expect(setCookies(res).join(" | ")).toContain("bf_lang=ja;");

    // ?lang=en still bounces once so the cookie lands in the browser.
    const en = await invoke("/?lang=en");
    expect(en.status).toBe(302);
    expect(redirectPath(en)).toBe("/");
    expect(setCookies(en).join(" | ")).toContain("nf_lang=en;");
  });

  it("leaves every non-root path untouched", async () => {
    for (const path of ["/app", "/ja/", "/privacy-and-terms", "/assets/index.js"]) {
      const res = await invoke(path, { cookie: "bf_lang=ja", "accept-language": "de-DE" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("next");
    }
  });
});
