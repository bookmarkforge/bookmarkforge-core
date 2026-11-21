#!/usr/bin/env node
/**
 * scripts/sync-sitemap-legal-cluster.mjs — keep public/sitemap.xml's legal
 * cluster in step with the legal pages the project actually ships.
 *
 * The sitemap used to list 30 localized legal pages, 24 of which were English
 * copies served under a localized <html lang> (see
 * scripts/retire-unreviewed-legal-pages.mjs). The legal notice now exists in
 * the six reviewed languages only, so the sitemap advertises the six and
 * points its hreflang set at them.
 *
 * Idempotent: running it twice leaves the same file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEGAL_LOCALE_CODES,
  SITE_URL,
  LANDING_CODES,
} from "./landing-registry.mjs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(THIS_DIR, "..");
const SITEMAP = join(ROOT, "public", "sitemap.xml");

const reviewed = new Set(LEGAL_LOCALE_CODES);
const retired = LANDING_CODES.filter((code) => !reviewed.has(code));
const retiredLocs = new Set(
  retired.map((code) => `${SITE_URL}/${code}/privacy-and-terms.html`),
);

const link = (hreflang, href) =>
  `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}" />`;

const clusterAlternates = [
  ...LEGAL_LOCALE_CODES.map((code) =>
    link(
      code,
      code === "en"
        ? `${SITE_URL}/privacy-and-terms.html`
        : `${SITE_URL}/${code}/privacy-and-terms.html`,
    ),
  ),
  link("x-default", `${SITE_URL}/privacy-and-terms.html`),
].join("\n");

let xml = readFileSync(SITEMAP, "utf8");

// 1. Drop the blocks of the retired legal pages.
let removed = 0;
for (;;) {
  const blocks = [...xml.matchAll(/  <url>[\s\S]*?  <\/url>\r?\n/g)];
  const target = blocks.find((match) => {
    const loc = match[0].match(/<loc>([^<]+)<\/loc>/)?.[1];
    return loc && retiredLocs.has(loc);
  });
  if (!target) break;
  xml = xml.replace(target[0], "");
  removed += 1;
}

// 2. Point the remaining legal blocks at the reviewed cluster.
let rewritten = 0;
for (;;) {
  const blocks = [...xml.matchAll(/  <url>[\s\S]*?  <\/url>\r?\n/g)];
  const target = blocks.find((match) => {
    if (!match[0].includes("privacy-and-terms")) return false;
    // Already the reviewed cluster? Then there is nothing to rewrite.
    const links = [...match[0].matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map(
      (link) => `${link[1]}=${link[2]}`,
    );
    const expected = [
      ...LEGAL_LOCALE_CODES.map(
        (code) =>
          `${code}=${
            code === "en"
              ? `${SITE_URL}/privacy-and-terms.html`
              : `${SITE_URL}/${code}/privacy-and-terms.html`
          }`,
      ),
      `x-default=${SITE_URL}/privacy-and-terms.html`,
    ];
    return links.join("|") !== expected.join("|");
  });
  if (!target) break;
  const next = target[0].replace(
    /    <xhtml:link[\s\S]*?\r?\n(  <\/url>)/,
    `${clusterAlternates}\r\n$1`,
  );
  xml = xml.replace(target[0], next);
  rewritten += 1;
}

writeFileSync(SITEMAP, xml, "utf8");
console.log(
  `sitemap: removed ${removed} retired legal block(s), rewrote ${rewritten} legal block(s) to the ${LEGAL_LOCALE_CODES.length}-language reviewed cluster`,
);
