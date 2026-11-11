#!/usr/bin/env node
/**
 * Companion to fix-copy-2026-11-11.mjs: check:landing-i18n requires index
 * parity across all 30 landing locales. The six primaries gained the BYOK
 * Free-card line (now 15 features); the 24 secondaries already carried BYOK
 * but lacked the "Works on any device — each keeps its own vault" line the
 * primaries have. Insert that line before the knowledge-graph item, reusing
 * each locale's own priceFreeDesc phrasing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TDIR = join(ROOT, "scripts", "translations");

const DEVICE_LINE = {
  ar: "يعمل على أي جهاز — لكل جهاز خزنته الخاصة",
  bg: "Работи на всяко устройство — всяко със собствен трезор",
  cs: "Funguje na jakémkoli zařízení — každé má svůj trezor",
  da: "Virker på enhver enhed — hver har sit eget valv",
  el: "Λειτουργεί σε κάθε συσκευή — κάθε συσκευή έχει το δικό της θησαυροφυλάκιο",
  fi: "Toimii millä tahansa laitteella — jokaisella on oma holvinsa",
  he: "עובד בכל מכשיר — לכל מכשיר הכספת שלו",
  hi: "किसी भी डिवाइस पर काम करता है — हर डिवाइस का अपना वॉल्ट",
  hr: "Radi na bilo kojem uređaju — svaki ima svoj sef",
  hu: "Bármely eszközön működik — mindegyiknek saját széfje van",
  id: "Berfungsi di perangkat apa pun — masing-masing punya vault sendiri",
  ja: "どのデバイスでも動作 — 各デバイスが独自のボルトを持つ",
  ko: "어떤 기기에서든 작동 — 기기마다 자체 볼트 보유",
  nl: "Werkt op elk apparaat — elk met zijn eigen kluis",
  no: "Fungerer på enhver enhet — hver med sitt eget hvelv",
  pl: "Działa na dowolnym urządzeniu — każde ma własny sejf",
  ro: "Funcționează pe orice dispozitiv — fiecare are propriul seif",
  ru: "Работает на любом устройстве — у каждого свой сейф",
  sv: "Fungerar på vilken enhet som helst — varje enhet har sitt eget valv",
  th: "ใช้ได้บนอุปกรณ์ใดก็ได้ — แต่ละเครื่องมีห้องนิรภัยของตัวเอง",
  tr: "Her cihazda çalışır — her cihazın kendi kasası vardır",
  uk: "Працює на будь-якому пристрої — кожен має власний сейф",
  vi: "Hoạt động trên mọi thiết bị — mỗi thiết bị có kho riêng",
  zh: "可在任何设备上使用 — 每台设备拥有独立保险库",
};

const changed = [];

for (const [lang, text] of Object.entries(DEVICE_LINE)) {
  const p = join(TDIR, `${lang}.json`);
  const d = JSON.parse(readFileSync(p, "utf8"));
  const feats = d.pricing?.plans?.[0]?.features;
  if (!Array.isArray(feats)) throw new Error(`${lang}: no free features`);
  const has = feats.some((f) => /any device|takéhok|-any|-gal device|laitteella|מכשיר|डिवाइस|uređaju|eszközön|perangkat|デバイス|기기에서|apparaat|enhet|urządzeniu|dispozitiv|устройстве|enhet som helst|อุปกรณ์|cihazda|пристрої|thiết bị|设备/i.test(f?.text ?? ""));
  if (has) {
    console.log(`${lang}: already has a device line — skipped`);
    continue;
  }
  // Verified 2026-11-11: features[3] is the knowledge-graph item in all 24
  // secondary locales (the gate checks index parity, not ordering).
  if (feats.length !== 14 || !feats[3]?.text) {
    throw new Error(`${lang}: unexpected free-features shape (${feats.length} items)`);
  }
  feats.splice(3, 0, { included: true, text });
  writeFileSync(p, JSON.stringify(d, null, 2) + "\n", "utf8");
  changed.push(lang);
}

// Keep the legacy secondary source structurally similar: insert the same
// line before the first ❌ item (end of the included block).
const lp = join(ROOT, "scripts", "landing-translations.json");
const T = JSON.parse(readFileSync(lp, "utf8"));
for (const [lang, text] of Object.entries(DEVICE_LINE)) {
  const t = T[lang];
  if (!t || !Array.isArray(t.priceFreeItems)) continue;
  const already = t.priceFreeItems.some((s) => typeof s === "string" && s === text);
  if (already) continue;
  const firstNo = t.priceFreeItems.findIndex((s) => typeof s === "string" && s.includes("❌"));
  const at = firstNo > 0 ? firstNo : t.priceFreeItems.length - 1;
  t.priceFreeItems.splice(at, 0, text);
}
writeFileSync(lp, JSON.stringify(T, null, 2) + "\n", "utf8");

console.log("changed:", changed.join(", "));
console.log("legacy landing-translations.json updated");
