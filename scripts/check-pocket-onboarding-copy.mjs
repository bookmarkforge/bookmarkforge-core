#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const files = {
  guideSource: join(ROOT, "scripts", "translations", "pocket-alternative-en.json"),
  guideHtml: join(ROOT, "public", "pocket-alternative.html"),
  emails: join(ROOT, "docs", "onboarding-emails.md"),
  onboardingEn: join(ROOT, "public", "locales", "en.json"),
};

const SMART_SEARCH = /smart search is included free/i;
const RAINDROP_YEARLY = /raindrop charges yearly for (?:it|this|that feature|smart search)/i;
const NO_DEVICE_CAP = /no device cap/i;
const ANY_DEVICE = /any device/i;

const failures = [];
function read(name) {
  try {
    return readFileSync(files[name], "utf8");
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    return "";
  }
}
function requireCopy(name, text, patterns) {
  for (const [label, pattern] of patterns) {
    if (!pattern.test(text)) failures.push(`${name}: missing ${label}`);
  }
}

const source = read("guideSource");
const guide = read("guideHtml");
const emails = read("emails");
const onboarding = JSON.parse(read("onboardingEn") || "{}");

requireCopy("guide source", source, [
  ["smart-search message", SMART_SEARCH],
  ["Raindrop yearly comparison", RAINDROP_YEARLY],
  ["no-device-cap message", NO_DEVICE_CAP],
  ["any-device wording", ANY_DEVICE],
]);
requireCopy("rendered Pocket guide", guide, [
  ["smart-search message", SMART_SEARCH],
  ["Raindrop yearly comparison", RAINDROP_YEARLY],
  ["no-device-cap message", NO_DEVICE_CAP],
  ["any-device wording", ANY_DEVICE],
]);
requireCopy("onboarding emails", emails, [
  ["smart-search message", SMART_SEARCH],
  ["Raindrop yearly comparison", RAINDROP_YEARLY],
  ["no-device-cap message", NO_DEVICE_CAP],
  ["any-device wording", ANY_DEVICE],
]);
requireCopy("English onboarding welcome", String(onboarding.app_onboardingWelcomeDesc ?? ""), [
  ["smart-search message", SMART_SEARCH],
  ["Raindrop yearly comparison", RAINDROP_YEARLY],
  ["no-device-cap message", NO_DEVICE_CAP],
  ["any-device wording", ANY_DEVICE],
]);

if (failures.length) {
  console.error(`check-pocket-onboarding-copy: ${failures.length} violation(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("check-pocket-onboarding-copy: OK — guide and onboarding copy lead with smart search and no device cap");
