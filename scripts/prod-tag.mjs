#!/usr/bin/env node
/**
 * scripts/prod-tag.mjs — generate and validate the next `prod-*` release tag.
 *
 * The deploy tag is the only handle `scripts/rollback.mjs` and
 * `scripts/check-blindeo.mjs` have on a previous build, and both parse it the
 * same way: a `prod-` prefix and a trailing 7-12 hex short SHA
 * (`rollback.mjs` `extractSha` / `selectAutoTarget`). A name that drifts — an
 * extra suffix after the SHA (`-dirty`), a 40-char SHA, a malformed timestamp —
 * turns that build into a tag the selector cannot dedupe by commit, which is
 * the bb21664 regression: two tags over one commit made `--auto` "roll back"
 * to the same image.
 *
 * Generation mirrors `scripts/deploy-prod.mjs` (`prod-${localStamp()}-${sha}`,
 * local time) so a preflight run and the deploy that follows agree on the name
 * for the same minute.
 *
 * Usage:
 *   node scripts/prod-tag.mjs                      # print + validate HEAD
 *   node scripts/prod-tag.mjs --sha <7-12 hex>     # validate another SHA
 *   node scripts/prod-tag.mjs --json               # machine-readable result
 *   node scripts/prod-tag.mjs --create             # create the annotated tag
 *   node scripts/prod-tag.mjs --create --allow-dirty
 *
 * `--create` never pushes: `git push origin <tag>` is printed and stays a
 * separate, explicit release step. Every git call uses argv (execFileSync),
 * never a shell glob — the same Windows-safe choice as check-blindeo.mjs.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractSha } from "./rollback.mjs";

/** The shape both consumers accept: `prod-<YYYYMMDD>-<HHMM>-<7-12 hex>`. */
export const PROD_TAG_PATTERN = /^prod-(\d{8})-(\d{4})-([0-9a-f]{7,12})$/i;
const SHORT_SHA_PATTERN = /^[0-9a-f]{7,12}$/i;

/**
 * Local-time `YYYYMMDD-HHMM`, byte-identical to deploy-prod.mjs `localStamp`.
 * Two identical builds deployed in the same minute collide on the name, which
 * is why the deploy refuses an existing tag instead of retagging.
 */
export function localStamp(now = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

/** Tag name for a short SHA, or "" when the SHA cannot name a build. */
export function buildProdTagName({ sha, now = new Date() } = {}) {
  const candidate = String(sha ?? "").trim();
  if (!SHORT_SHA_PATTERN.test(candidate)) return "";
  return `prod-${localStamp(now)}-${candidate.toLowerCase()}`;
}

/**
 * Validates a candidate name against what the rollback selector parses, plus
 * the calendar fields a hand-typed timestamp gets wrong. Returns every reason
 * so a caller can print all of them instead of the first.
 */
export function validateProdTagName(name) {
  if (typeof name !== "string") {
    return { ok: false, reasons: ["name must be a string"], sha: "" };
  }
  const reasons = [];
  const value = name.trim();
  if (value !== name) reasons.push("name has surrounding whitespace");
  const match = PROD_TAG_PATTERN.exec(value);
  if (!match) {
    if (!value.startsWith("prod-")) reasons.push("must start with `prod-`");
    if (!SHORT_SHA_PATTERN.test(value.split("-").pop() ?? "")) {
      reasons.push(
        "must end with the 7-12 character short SHA — rollback.mjs reads it as " +
          "the build identity, so anything after it (or a longer SHA) breaks dedup",
      );
    }
    if (reasons.length === 0) reasons.push("expected `prod-YYYYMMDD-HHMM-<short sha>`");
    return { ok: false, reasons, sha: "" };
  }
  const [, datePart, timePart, sha] = match;
  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6));
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  if (month < 1 || month > 12) {
    reasons.push(`month ${month} is outside 01-12`);
  } else {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > daysInMonth) {
      reasons.push(`day ${day} does not exist in ${datePart.slice(0, 4)}-${datePart.slice(4, 6)}`);
    }
  }
  if (hour > 23) reasons.push(`hour ${hour} is outside 00-23`);
  if (minute > 59) reasons.push(`minute ${minute} is outside 00-59`);
  return { ok: reasons.length === 0, reasons, sha: sha.toLowerCase() };
}

/**
 * Existing `prod-*` tags that name the same build. The selector dedupes by SHA,
 * so a second tag over one commit adds no rollback target — worth warning
 * before creating it.
 */
export function sameBuildTags(tags, sha) {
  const target = String(sha ?? "").toLowerCase();
  if (!target) return [];
  return (Array.isArray(tags) ? tags : []).filter(
    (tag) => extractSha(tag).toLowerCase() === target,
  );
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isMain =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const has = (flag) => argv.includes(flag);
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? (argv[index + 1] ?? "") : "";
  };

  if (has("--help") || has("-h")) {
    console.log(`prod-tag — generate and validate a prod-* release tag

  (no flag)        print the tag for HEAD and validate its format
  --sha <sha>      use this 7-12 hex short SHA instead of HEAD
  --json           machine-readable result
  --create         create the annotated tag (never pushes)
  --allow-dirty    allow --create on a dirty working tree
  --help           this help

Tag format: prod-YYYYMMDD-HHMM-<short sha>, local time, same clock as
scripts/deploy-prod.mjs. Publishes nothing: \`git push origin <tag>\` is a
separate, explicit release step.`);
    process.exit(0);
  }

  const CREATE = has("--create");
  const ALLOW_DIRTY = has("--allow-dirty");
  const AS_JSON = has("--json");
  const fail = (message) => {
    console.error(`[prod-tag] FAIL ${message}`);
    process.exit(1);
  };
  const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

  try {
    git(["rev-parse", "--show-toplevel"]);
  } catch {
    fail("not a git repository — a deploy tag must name this checkout's commit");
  }

  let sha = valueOf("--sha").trim();
  if (!sha) {
    try {
      sha = git(["rev-parse", "--short", "HEAD"]);
    } catch {
      fail("cannot resolve HEAD");
    }
  }
  if (!SHORT_SHA_PATTERN.test(sha)) {
    fail(`invalid SHA "${sha}" — expected 7-12 hex characters`);
  }

  const now = new Date();
  const stamp = localStamp(now);
  const name = buildProdTagName({ sha, now });
  const validation = validateProdTagName(name);

  let existing = [];
  try {
    existing = git(["tag", "--list", "prod-*"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    fail("cannot list git tags");
  }
  const taken = existing.includes(name);
  const duplicates = sameBuildTags(existing, sha);

  const warnings = [];
  if (duplicates.length > 0) {
    warnings.push(
      `an existing tag already names this build (${duplicates.join(", ")}); ` +
        "rollback.mjs dedupes by SHA, so this tag adds no rollback target",
    );
  }
  if (taken) warnings.push(`the local tag ${name} already exists`);

  let created = false;
  if (CREATE) {
    if (!validation.ok) {
      fail(`refusing to create an invalid tag: ${validation.reasons.join("; ")}`);
    }
    if (taken) {
      fail(`${name} already exists — this commit already has this minute's tag`);
    }
    if (!ALLOW_DIRTY && git(["status", "--porcelain"])) {
      fail(
        "dirty working tree — the tag would not point at the deployed code " +
          "(commit first, or pass --allow-dirty)",
      );
    }
    try {
      git(["rev-parse", "--verify", `${sha}^{commit}`]);
    } catch {
      fail(`${sha} does not resolve to a commit in this repository`);
    }
    execFileSync("git", ["tag", "-a", name, "-m", `Deploy prod ${stamp} — ${sha}`], {
      stdio: "inherit",
    });
    created = true;
  }

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          tag: name,
          sha,
          stamp,
          valid: validation.ok,
          reasons: validation.reasons,
          warnings,
          existingBuildTags: duplicates,
          created,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`[prod-tag] candidate: ${name}`);
    console.log(`[prod-tag] sha ${sha} — stamp ${stamp} (local time, same clock as deploy-prod.mjs)`);
    if (validation.ok) {
      console.log("[prod-tag] format ok: prod-YYYYMMDD-HHMM-<7-12 hex short sha>");
    } else {
      for (const reason of validation.reasons) console.error(`[prod-tag] FAIL ${reason}`);
    }
    for (const warning of warnings) console.log(`[prod-tag] WARN ${warning}`);
    if (created) {
      console.log(`[prod-tag] annotated tag created: ${name}`);
      console.log(`[prod-tag] publish it with: git push origin ${name}`);
    } else {
      console.log("[prod-tag] nothing created — pass --create once the build is deployed and verified");
    }
  }

  process.exitCode = validation.ok ? 0 : 1;
}
