#!/usr/bin/env node
/**
 * scripts/check-e2e-fixture-neutralization.mjs — e2e fidelity gate.
 *
 * ── THE BUG CLASS ──────────────────────────────────────────────────────────
 * The vault e2e fixtures are not neutral bystanders. `setupVault`,
 * `dismissOverlays` and `skipPassword` get a spec to the surface under test by
 * CLICKING app controls and WRITING app state — and when a spec's subject IS
 * one of the surfaces they clear, the fixture destroys the subject before the
 * first assertion. The spec still passes; it just measures nothing.
 *
 *   tests/e2e/dashboard-banner-cls.spec.ts is the canonical case (ADR-055):
 *   the "Got it, remind me later" click writes the 48 h snooze
 *   (BACKUP_BANNER_DISMISSED_UNTIL), so the banner that spec exists to measure
 *   can never reveal and the measured CLS collapses to zero. It is why
 *   `keepBackupNotice` exists at all.
 *
 * A second, quieter form is the COMPENSATING DANCE: a spec notices the fixture
 * ate its subject and works around it locally (`removeItem(snooze key)` +
 * reload) instead of telling the fixture, so the next reader sees neither the
 * defect nor the consent. Both forms are one defect — a silent neutralization —
 * so this gate treats them as one class.
 *
 * ── THE CONTRACT (what a spec must do) ─────────────────────────────────────
 * Per spec block, the gate derives from the CODE ITSELF whether the block
 * depends on a fixture-neutralized surface:
 *
 *   (A) it references the surface's own dismiss control or DOM marker —
 *       you cannot meaningfully exercise a surface you never touch; or
 *   (B) it REVIVES the surface's state keys (`removeItem(...)`, or a falsy
 *       `setItem`) — i.e. it wants the surface ALIVE; or
 *   (C) its own test title claims the surface ("backup reminder banner …").
 *
 * The requirement lands on the fixture call that PRECEDES the reference — the
 * one whose state the block relies on — not on every call in the block: a block
 * may legitimately set up twice (plain setup, then a guarded one for the
 * surface's own wizard phase). That call must PRESERVE the surface through the
 * documenting option — `{ keepBackupNotice: true }`, `{ dismissOnboarding:
 * false }` — or the file must carry an explicit, reasoned waiver:
 *
 *   // fixture-neutralization-waiver: <surfaceIds> — <reason>
 *
 * A waiver with no reason fails: the point is to make this a DECLARED decision,
 * never a default. A waiver nobody needs is reported as a warning, so the
 * escape hatch cannot quietly become permanent.
 *
 * Direction matters and is what keeps the gate accurate. A spec that seeds the
 * tour/tip keys to "true" wants those overlays DEAD — that agrees with the
 * fixture and is not a conflict. Only reviving them (wanting them alive while
 * the fixture kills them) is.
 *
 * ── MAKING NEW SILENT NEUTRALIZATIONS IMPOSSIBLE ───────────────────────────
 *   (R3) every dismissal control and every storage key `vault-helpers.ts`
 *        uses must be registered in FIXTURE_SURFACES. Adding a dismissal to
 *        `dismissOverlays` without describing it here fails the gate, so the
 *        neutralized-surface set cannot grow behind the specs' backs.
 *   (R4) every key registered here must resolve to a symbol in the app's
 *        src/constants/storage-keys.ts — no invented or stale surfaces.
 *
 * ── USAGE ──────────────────────────────────────────────────────────────────
 *   node scripts/check-e2e-fixture-neutralization.mjs
 *   E2E_FIXTURE_ROOT=<dir> node scripts/check-e2e-fixture-neutralization.mjs
 *
 * Exit codes:
 *   0 — no undeclared neutralization ("No undeclared fixture neutralizations")
 *   1 — contract violations (detail lines on stderr)
 *   2 — usage / IO error (missing helper or storage keys: the gate cannot
 *       verify what the fixture neutralizes and refuses to pass silently)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const HELPERS_REL = "tests/e2e/vault-helpers.ts";
const SPEC_DIR_REL = "tests/e2e";
const STORAGE_KEYS_REL = "src/constants/storage-keys.ts";
const WAIVER_RE = /fixture-neutralization-waiver:\s*([^\n]*)/;

/**
 * The surfaces the vault fixture can neutralize, with the evidence that lets
 * the gate recognise a spec that depends on one. Each `neutralizers` entry
 * names a helper call and the argument text that makes that call PRESERVE the
 * surface (null = no option preserves it):
 *   - `dismissOnboarding: false` makes setupVault skip dismissOverlays
 *     entirely, which preserves ALL four surfaces.
 *   - `keepBackupNotice: true` is the banner's dedicated opt-out.
 */
export const FIXTURE_SURFACES = [
  {
    id: "onboarding",
    label: "onboarding wizard",
    storageKeySymbols: ["ONBOARDING_COMPLETE"],
    dynamicKeyPrefixes: [],
    relatedKeySymbols: [],
    controls: ["Skip onboarding"],
    domMarkers: ["onboarding-dialog-title"],
    titlePattern: /\bonboarding\b/i,
    neutralizers: [
      { helper: "dismissOverlays", preservedBy: null },
      { helper: "setupVault", preservedBy: /dismissOnboarding\s*:\s*false/ },
      { helper: "skipPassword", preservedBy: null },
    ],
    fix: "setupVault(page, { dismissOnboarding: false })",
  },
  {
    id: "welcomeTour",
    label: "WelcomeTour guided tour",
    storageKeySymbols: ["WELCOME_TOUR_COMPLETE"],
    dynamicKeyPrefixes: [],
    relatedKeySymbols: [],
    controls: ["Skip tour"],
    domMarkers: [],
    // No option keeps the tour: skipPassword pre-seeds its completion flag and
    // dismissOverlays Escapes out of it. A spec whose subject IS the tour has
    // to seed/open it itself after setup (or waive).
    titlePattern: /welcome\s?tour|guided tour/i,
    neutralizers: [
      { helper: "dismissOverlays", preservedBy: null },
      { helper: "setupVault", preservedBy: /dismissOnboarding\s*:\s*false/ },
      { helper: "skipPassword", preservedBy: null },
    ],
    fix: "no helper option keeps the tour — reopen it in the spec (or waive)",
  },
  {
    id: "backupNotice",
    label: "backup reminder banner",
    storageKeySymbols: ["BACKUP_BANNER_DISMISSED_UNTIL"],
    dynamicKeyPrefixes: [],
    // The banner's own CONDITION key: clearing it revives the banner just as
    // surely as clearing the snooze.
    relatedKeySymbols: ["LAST_MANUAL_BACKUP_DATE"],
    controls: ["Got it, remind me later"],
    // The banner's own content: a spec that clicks its export button depends
    // on the banner existing, whether or not it ever touches the snooze key.
    domMarkers: ["Export Physical Backup File", "backup-reminder"],
    titlePattern: /backup\s+(reminder|banner)|reminder\s+banner/i,
    neutralizers: [
      { helper: "dismissOverlays", preservedBy: /keepBackupNotice\s*:\s*true/ },
      {
        helper: "setupVault",
        preservedBy: /keepBackupNotice\s*:\s*true|dismissOnboarding\s*:\s*false/,
      },
      { helper: "skipPassword", preservedBy: null },
    ],
    fix: "setupVault(page, { keepBackupNotice: true })",
  },
  {
    id: "quickTips",
    label: "dashboard QuickTips",
    storageKeySymbols: ["DISMISSED_TIPS"],
    // The once-per-day "shown today" key is date-templated, so it is matched
    // by prefix.
    dynamicKeyPrefixes: ["forge_tip_shown_"],
    relatedKeySymbols: [],
    controls: ["Dismiss tip"],
    domMarkers: [],
    titlePattern: /quick\s?tips?|dashboard tip/i,
    neutralizers: [
      { helper: "dismissOverlays", preservedBy: null },
      { helper: "setupVault", preservedBy: /dismissOnboarding\s*:\s*false/ },
      { helper: "skipPassword", preservedBy: null },
    ],
    fix: "no helper option keeps the tips — reopen them in the spec (or waive)",
  },
];

const HELPER_FUNCTIONS = ["setupVault", "dismissOverlays", "skipPassword"];

/** Escape a string for embedding in a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse the app's single source of truth for storage keys:
 * `export const STORAGE_KEYS = { SYMBOL: "literal", … }`.
 *
 * @returns {{ keys: Map<string, string>, errors: string[] }}
 */
export function loadAppStorageKeys(source) {
  const errors = [];
  const keys = new Map();
  const body = source.match(/STORAGE_KEYS\s*=\s*\{([\s\S]*?)\n\}/);
  if (!body) {
    errors.push(
      `could not find the STORAGE_KEYS object literal in ${STORAGE_KEYS_REL}`,
    );
    return { keys, errors };
  }
  const entryRe = /([A-Z0-9_]+)\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = entryRe.exec(body[1])) !== null) {
    keys.set(match[1], match[2]);
  }
  if (keys.size === 0) {
    errors.push(`no key entries parsed from ${STORAGE_KEYS_REL}`);
  }
  return { keys, errors };
}

/**
 * Extract the dismiss controls a helper's dismissal code uses, plus every
 * storage key it touches anywhere in the file.
 *
 * Controls are read from the `dismissOverlays` body only: that body contains
 * ordinary UI labels for unrelated screens too, so a wider scope would mean
 * registering half the app. The body is bounded by the function's column-0
 * closing brace.
 */
export function collectHelperNeutralizations(source) {
  const controls = new Set();
  const keyLiterals = new Set();

  const start = source.indexOf("export async function dismissOverlays(");
  if (start === -1) {
    return { controls, keyLiterals, dismissalRegionFound: false };
  }
  const closeAt = source.indexOf("\n}", start);
  const region = source.slice(start, closeAt === -1 ? source.length : closeAt);

  // `getByRole("button", { name: "…" })` and the regex form `/…/i`.
  const nameStringRe = /name:\s*"([^"]+)"/g;
  const nameRegexRe = /name:\s*\/((?:[^/\\]|\\.)+)\/\w*/g;
  let match;
  while ((match = nameStringRe.exec(region)) !== null) {
    controls.add(match[1].trim());
  }
  while ((match = nameRegexRe.exec(region)) !== null) {
    controls.add(match[1].replace(/\\(.)/g, "$1").trim());
  }

  // Every key-shaped literal anywhere in the helper: the skipPassword init
  // script seeds keys far from any dismissal click.
  const literalRe = /["'`]((?:forge|bmf)_[A-Za-z0-9_]+)["'`]/g;
  while ((match = literalRe.exec(source)) !== null) {
    keyLiterals.add(match[1]);
  }
  const symbolRe = /STORAGE_KEYS\.([A-Z0-9_]+)/g;
  while ((match = symbolRe.exec(source)) !== null) {
    keyLiterals.add(`STORAGE_KEYS.${match[1]}`);
  }

  return { controls, keyLiterals, dismissalRegionFound: true };
}

/** Resolve every literal key a surface owns (symbols + related keys). */
export function surfaceKeyLiterals(surface, storageKeys) {
  const literals = [];
  for (const symbol of [
    ...surface.storageKeySymbols,
    ...surface.relatedKeySymbols,
  ]) {
    const literal = storageKeys.get(symbol);
    if (literal) {
      literals.push(literal);
    }
  }
  return literals;
}

/**
 * (R3) Every dismissal control and key the helper uses must be registered.
 * This is what stops a NEW neutralization from appearing without the specs ever
 * being able to consent to it.
 */
export function evaluateManifestCoverage(
  helperNeutralizations,
  surfaces,
  storageKeys,
) {
  const failures = [];
  if (!helperNeutralizations.dismissalRegionFound) {
    failures.push(
      `could not locate dismissOverlays() in ${HELPERS_REL} — the gate cannot ` +
        "verify which surfaces the fixture neutralizes (refusing to pass " +
        "silently)",
    );
    return failures;
  }

  const registeredControls = new Set(
    surfaces.flatMap((surface) => surface.controls.map((c) => c.toLowerCase())),
  );
  for (const control of helperNeutralizations.controls) {
    if (!registeredControls.has(control.toLowerCase())) {
      failures.push(
        `${HELPERS_REL} dismisses a control that no entry in ` +
          `FIXTURE_SURFACES describes: "${control}". Register the surface ` +
          "(id, storage keys, controls, preserving option) in " +
          "scripts/check-e2e-fixture-neutralization.mjs, or specs cannot " +
          "consent to it.",
      );
    }
  }

  const registeredKeys = new Set();
  for (const surface of surfaces) {
    for (const literal of surfaceKeyLiterals(surface, storageKeys)) {
      registeredKeys.add(literal);
    }
  }
  for (const key of helperNeutralizations.keyLiterals) {
    const symbol = key.startsWith("STORAGE_KEYS.") ? key.split(".")[1] : null;
    const covered = symbol
      ? surfaces.some((surface) =>
          [...surface.storageKeySymbols, ...surface.relatedKeySymbols].includes(
            symbol,
          ),
        )
      : registeredKeys.has(key) ||
        surfaces.some((surface) =>
          surface.dynamicKeyPrefixes.some((prefix) => key.startsWith(prefix)),
        );
    if (!covered) {
      failures.push(
        `${HELPERS_REL} writes storage key ${key} that no entry in ` +
          "FIXTURE_SURFACES describes. Register the surface it neutralizes.",
      );
    }
  }
  return failures;
}

/**
 * (R4) Registered symbols must exist in the app's STORAGE_KEYS: a surface
 * naming a key the app does not have is a stale description, and a stale
 * description is how this gate would rot into a no-op.
 */
export function evaluateCatalogAgainstApp(surfaces, storageKeys) {
  const failures = [];
  const ids = new Set();
  for (const surface of surfaces) {
    if (ids.has(surface.id)) {
      failures.push(`FIXTURE_SURFACES has a duplicate id: "${surface.id}"`);
    }
    ids.add(surface.id);
    for (const symbol of [
      ...surface.storageKeySymbols,
      ...surface.relatedKeySymbols,
    ]) {
      if (!storageKeys.has(symbol)) {
        failures.push(
          `FIXTURE_SURFACES["${surface.id}"] names STORAGE_KEYS.${symbol}, ` +
            `which does not exist in ${STORAGE_KEYS_REL}`,
        );
      }
    }
    if (
      surface.storageKeySymbols.length === 0 &&
      surface.dynamicKeyPrefixes.length === 0 &&
      surface.domMarkers.length === 0 &&
      surface.controls.length === 0
    ) {
      failures.push(
        `FIXTURE_SURFACES["${surface.id}"] has no keys, prefixes, controls or ` +
          "DOM markers — it could never be detected",
      );
    }
  }
  return failures;
}

/**
 * Split a source into blocks: everything before the first top-level
 * `test(`/`test.describe(`, then one block per top-level call. The subject of a
 * block is its own text plus the title it declares.
 */
export function splitSpecBlocks(source) {
  const lines = source.split("\n");
  const blocks = [];
  let current = { title: null, text: [], startLine: 1 };
  const titleRe =
    /^\s*(?:test|test\.describe)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/;

  lines.forEach((line, index) => {
    if (/^(?:test|test\.describe)\(/.test(line)) {
      blocks.push(current);
      const titleMatch = line.match(titleRe);
      current = {
        title: titleMatch
          ? titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] ?? null
          : null,
        text: [line],
        startLine: index + 1,
      };
      return;
    }
    current.text.push(line);
  });
  blocks.push(current);

  return blocks.map((block) => ({
    title: block.title,
    startLine: block.startLine,
    text: block.text.join("\n"),
  }));
}

/** Every fixture call in a block, with its raw argument list and position. */
export function fixtureCalls(text) {
  const calls = [];
  for (const helper of HELPER_FUNCTIONS) {
    const re = new RegExp(`\\b${helper}\\s*\\(`, "g");
    let match;
    while ((match = re.exec(text)) !== null) {
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let end = text.length;
      for (let i = open; i < text.length; i += 1) {
        const character = text[i];
        if (character === "(") {
          depth += 1;
        } else if (character === ")") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      calls.push({
        helper,
        args: text.slice(open + 1, end),
        index: match.index,
      });
    }
  }
  return calls.sort((a, b) => a.index - b.index);
}

/** Every index where a needle appears in the text. */
function occurrencesOf(text, needle) {
  const indices = [];
  if (!needle) {
    return indices;
  }
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) {
      return indices;
    }
    indices.push(at);
    from = at + needle.length;
  }
}

/**
 * (rule A) Positions where the block references the surface's own UI.
 * Positions matter — see the header: the requirement lands on the fixture call
 * that PRECEDES the reference, not on every call in the block.
 */
export function surfaceUiReferences(text, surface) {
  const references = [];
  for (const needle of [...surface.controls, ...surface.domMarkers]) {
    for (const index of occurrencesOf(text, needle)) {
      references.push({ index, evidence: `references "${needle}"` });
    }
  }
  return references.sort((a, b) => a.index - b.index);
}

/**
 * (rule B) Positions where the block REVIVES the surface's state: removing a
 * key, or setting it to a falsy literal. Seeding a completion key to "true" is
 * suppression, which AGREES with the fixture — not a conflict — and is why the
 * direction has to be part of the rule.
 */
export function surfaceReviveReferences(text, surface, storageKeys) {
  const references = [];
  const needles = [
    ...surfaceKeyLiterals(surface, storageKeys),
    ...surface.dynamicKeyPrefixes,
  ];
  const writeRe =
    /\b(removeItem|setItem)\s*\(\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = writeRe.exec(text)) !== null) {
    const method = match[1];
    const key = match[2] ?? match[3] ?? "";
    const needle = needles.find((candidate) => key.startsWith(candidate));
    if (!needle) {
      continue;
    }
    if (method === "removeItem") {
      references.push({
        index: match.index,
        evidence: `removes ${key}`,
      });
      continue;
    }
    // setItem: only a falsy value revives the surface.
    const valueRe = new RegExp(
      `${escapeRegExp(match[0])}\\s*,\\s*(?:"([^"]*)"|'([^']*)')`,
    );
    const value = text
      .slice(match.index)
      .match(valueRe);
    if (value && /^(?:|false|0)$/i.test((value[1] ?? value[2] ?? "").trim())) {
      references.push({
        index: match.index,
        evidence: `sets ${key} to a falsy value`,
      });
    }
  }
  return references.sort((a, b) => a.index - b.index);
}

/** (rule C) Does the block's own title claim the surface? */
export function titleClaimsSurface(title, surface) {
  return Boolean(title) && surface.titlePattern.test(title);
}

/** Parse a `fixture-neutralization-waiver:` comment, if present. */
export function parseWaiver(source) {
  const match = source.match(WAIVER_RE);
  if (!match) {
    return null;
  }
  const body = match[1].trim();
  const emDashAt = body.indexOf("—");
  const hyphenAt = body.indexOf(" - ");
  const dashAt = emDashAt === -1 ? hyphenAt : emDashAt;
  if (dashAt === -1) {
    return {
      surfaces: body.split(",").map((entry) => entry.trim()).filter(Boolean),
      reason: "",
    };
  }
  const reasonAt = emDashAt === -1 ? dashAt + 3 : dashAt + 1;
  return {
    surfaces: body
      .slice(0, dashAt)
      .replace(/[—-]+$/, "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    reason: body.slice(reasonAt).trim(),
  };
}

/**
 * The whole contract over one source file.
 *
 * @returns {{ failures: string[], waived: Array, warnings: string[] }}
 */
export function evaluateSourceContract(source, { file, storageKeys, surfaces }) {
  const failures = [];
  const waived = [];
  const warnings = [];
  const violated = new Set();
  const waiver = parseWaiver(source);

  for (const block of splitSpecBlocks(source)) {
    const calls = fixtureCalls(block.text);
    for (const surface of surfaces) {
      const rules = new Map(
        surface.neutralizers.map((rule) => [rule.helper, rule]),
      );
      const neutralizes = (call) => rules.has(call.helper);
      const preserves = (call) => {
        const rule = rules.get(call.helper);
        return Boolean(
          rule && rule.preservedBy && rule.preservedBy.test(call.args),
        );
      };

      const references = [
        ...surfaceUiReferences(block.text, surface).map((reference) => ({
          ...reference,
          why: "references its own UI",
        })),
        ...surfaceReviveReferences(block.text, surface, storageKeys).map(
          (reference) => ({ ...reference, why: "revives its storage state" }),
        ),
      ].sort((a, b) => a.index - b.index);

      const violations = [];
      for (const reference of references) {
        // The fixture call whose state this reference relies on: the LAST one
        // before it. A later call cannot have cleared it.
        const preceding = calls
          .filter((call) => call.index < reference.index && neutralizes(call))
          .pop();
        if (preceding && !preserves(preceding)) {
          violations.push({ reference, call: preceding });
        }
      }
      if (titleClaimsSurface(block.title, surface)) {
        const first = calls.find(neutralizes);
        if (first && !preserves(first)) {
          violations.push({
            reference: { evidence: "its title claims it" },
            call: first,
          });
        }
      }
      if (violations.length === 0) {
        continue;
      }
      const { reference, call } = violations[0];

      if (waiver && waiver.surfaces.includes(surface.id)) {
        if (waiver.reason.length < 12) {
          failures.push(
            `${file}: the fixture-neutralization-waiver for "${surface.id}" ` +
              "has no reason. A waiver must say WHY the fixture may neutralize " +
              "this subject.",
          );
        } else {
          waived.push({ id: surface.id, reason: waiver.reason });
        }
        continue;
      }

      violated.add(surface.id);
      const where = block.title
        ? `test "${block.title}" (line ${block.startLine})`
        : `file scope (line ${block.startLine})`;
      const args = call.args.split("\n")[0].trim();
      failures.push(
        `${file}: ${where} ${reference.why} (${reference.evidence}) — the ` +
          `${surface.label} — but ${call.helper}(${args}…) neutralizes it ` +
          "first.\n" +
          `    fix: ${surface.fix}\n` +
          "    or declare it: // fixture-neutralization-waiver: " +
          `${surface.id} — <why the fixture may clear this subject>`,
      );
    }
  }

  if (waiver) {
    for (const id of waiver.surfaces) {
      if (!violated.has(id) && surfaces.some((surface) => surface.id === id)) {
        warnings.push(
          `${file}: fixture-neutralization-waiver names "${id}", but no ` +
            "violation was detected — remove it, or the waiver is hiding " +
            "nothing today and a real conflict tomorrow.",
        );
      }
    }
  }

  return { failures, waived, warnings };
}

/**
 * Run the contract over a tree.
 *
 * @returns {{ failures: string[], waived: Array, warnings: string[],
 *            scanned: number, summaryLine: string }}
 */
export function evaluateNeutralizationContract(root) {
  const failures = [];
  const waived = [];
  const warnings = [];
  const helperPath = join(root, HELPERS_REL);
  const storageKeysPath = join(root, STORAGE_KEYS_REL);

  for (const [label, path] of [
    ["vault helpers", helperPath],
    ["storage keys", storageKeysPath],
  ]) {
    if (!existsSync(path)) {
      failures.push(
        `missing ${label}: ${path} — the gate cannot verify what the fixture ` +
          "neutralizes (refusing to pass silently)",
      );
    }
  }
  if (failures.length > 0) {
    return { failures, waived, warnings, scanned: 0, summaryLine: "" };
  }

  const { keys: storageKeys, errors } = loadAppStorageKeys(
    readFileSync(storageKeysPath, "utf8"),
  );
  failures.push(...errors);
  if (failures.length > 0) {
    return { failures, waived, warnings, scanned: 0, summaryLine: "" };
  }

  failures.push(...evaluateCatalogAgainstApp(FIXTURE_SURFACES, storageKeys));
  failures.push(
    ...evaluateManifestCoverage(
      collectHelperNeutralizations(readFileSync(helperPath, "utf8")),
      FIXTURE_SURFACES,
      storageKeys,
    ),
  );

  // Every TS file in tests/e2e: a compensating dance does not stop being one by
  // moving into a shared helper module.
  const specDir = join(root, SPEC_DIR_REL);
  const files = readdirSync(specDir)
    .filter((name) => name.endsWith(".ts"))
    .sort();
  for (const name of files) {
    if (name === "vault-helpers.ts") {
      // The fixture itself: it is the neutralizer, never a subject.
      continue;
    }
    const result = evaluateSourceContract(
      readFileSync(join(specDir, name), "utf8"),
      {
        file: `${SPEC_DIR_REL}/${name}`,
        storageKeys,
        surfaces: FIXTURE_SURFACES,
      },
    );
    failures.push(...result.failures);
    warnings.push(...result.warnings);
    waived.push(...result.waived.map((entry) => ({ ...entry, file: `${SPEC_DIR_REL}/${name}` })));
  }

  return {
    failures,
    waived,
    warnings,
    scanned: files.length,
    summaryLine:
      `[check-e2e-fixture-neutralization] ${files.length} files, ` +
      `${FIXTURE_SURFACES.length} registered surfaces, ` +
      `${waived.length} declared waiver(s)`,
  };
}

function main() {
  const root = process.env.E2E_FIXTURE_ROOT || process.cwd();
  let result;
  try {
    result = evaluateNeutralizationContract(root);
  } catch (error) {
    console.error(
      `[check-e2e-fixture-neutralization] IO error: ${error.message}`,
    );
    process.exit(2);
  }

  for (const warning of result.warnings) {
    console.warn(`[check-e2e-fixture-neutralization] WARN ${warning}`);
  }

  if (result.failures.length > 0) {
    console.error("Undeclared fixture neutralization found:");
    console.error(result.failures.join("\n\n"));
    process.exit(1);
  }

  console.log(result.summaryLine);
  for (const waiver of result.waived) {
    console.log(
      `[check-e2e-fixture-neutralization] waived ${waiver.id} in ` +
        `${waiver.file}: ${waiver.reason}`,
    );
  }
  console.log("No undeclared fixture neutralizations");
  process.exit(0);
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("check-e2e-fixture-neutralization.mjs")
) {
  main();
}
