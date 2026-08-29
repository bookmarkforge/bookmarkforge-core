#!/usr/bin/env node
/**
 * scripts/health-dashboard.mjs — real-time terminal health dashboard.
 *
 * Closes AUDIT-2026-08-29 O-102: monitoring was cron/script-driven with no
 * live view. This wraps the SAME probes as `monitoring-alerts.mjs`
 * (production smoke + health/business latency) in a refresh loop and
 * renders a compact terminal dashboard with the last N check results,
 * current degradation state, and rollback-tag reminder.
 *
 * This is an *observability* wrapper, not a new probe implementation: it
 * delegates to `monitoring-alerts.mjs --json` so alert logic can never
 * drift between the two surfaces. If the monitor script exits non-zero,
 * the dashboard shows the failure banner — it does not re-interpret JSON.
 *
 * Usage:
 *   node scripts/health-dashboard.mjs                     # 30s refresh
 *   PROD_BASE_URL=https://app.example.com node scripts/health-dashboard.mjs --interval=10
 *   node scripts/health-dashboard.mjs --once              # single render (CI)
 *
 * Exit codes (with --once): 0 = all probes OK, 1 = any probe failed.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MONITOR = path.join(HERE, "monitoring-alerts.mjs");

const args = process.argv.slice(2);
const isOnce = args.includes("--once");
const intervalArg = args.find((a) => a.startsWith("--interval="));
const INTERVAL_SEC = Math.max(5, Number(intervalArg?.split("=")[1] ?? 30));
const HISTORY = 12;

// ── Probe invocation (delegates; never re-implements) ───────────────
function runProbes() {
  const started = Date.now();
  const res = spawnSync(process.execPath, [MONITOR, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env },
  });
  const durationMs = Date.now() - started;
  let payload = null;
  if (res.stdout?.trim()) {
    try {
      // The monitor prints non-JSON banner lines before the JSON payload;
      // take the last balanced {...} block defensively.
      const text = res.stdout;
      const start = text.lastIndexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) payload = JSON.parse(text.slice(start, end + 1));
    } catch {
      payload = null;
    }
  }
  return {
    at: new Date(),
    ok: res.status === 0,
    status: res.status,
    payload,
    stderr: (res.stderr ?? "").trim().split("\n").slice(-3).join("\n"),
    stdoutTail: (res.stdout ?? "").trim().split("\n").slice(-3).join("\n"),
    durationMs,
  };
}

// ── Rendering (pure ANSI, no deps) ──────────────────────────────────
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

function bar(ok, width = 8) {
  return ok
    ? `${GREEN}${"█".repeat(width)}${RESET}`
    : `${RED}${"█".repeat(width)}${RESET}`;
}

function render(history, baseUrl) {
  const lines = [];
  const last = history[history.length - 1];
  const consecutiveFailures = (() => {
    let n = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].ok) break;
      n++;
    }
    return n;
  })();

  lines.push("");
  lines.push(`${BOLD}BookmarkForge — Health Dashboard${RESET}  ${DIM}${baseUrl ?? "(PROD_BASE_URL unset)"}${RESET}`);
  lines.push("═".repeat(64));

  // Status banner
  if (!last) {
    lines.push(`${YELLOW}  … collecting first sample${RESET}`);
  } else if (last.ok && consecutiveFailures === 0) {
    lines.push(`  ${GREEN}${BOLD}● ALL PROBES OK${RESET}  ${DIM}(last check ${last.durationMs}ms)${RESET}`);
  } else {
    lines.push(`  ${RED}${BOLD}● FAILING${RESET} — ${consecutiveFailures} consecutive failure(s)`);
    if (consecutiveFailures >= 2) {
      lines.push(`  ${RED}${BOLD}  ⚠ ON-CALL: 2nd consecutive failure → ROLLBACK (see docs/ON-CALL-CHEATSHEET.md)${RESET}`);
    }
  }

  lines.push("");
  lines.push(`  ${BOLD}Last ${history.length} checks (oldest → newest):${RESET}`);
  for (const h of history) {
    const t = h.at.toTimeString().slice(0, 8);
    const verdict = h.ok ? `${GREEN}OK${RESET}` : `${RED}FAIL${RESET}`;
    lines.push(`    ${DIM}${t}${RESET}  ${verdict}  ${bar(h.ok, 24)}  ${h.durationMs}ms`);
    if (!h.ok && h.stdoutTail) {
      for (const line of h.stdoutTail.split("\n").slice(-2)) {
        lines.push(`      ${RED}│${RESET} ${DIM}${line.slice(0, 76)}${RESET}`);
      }
    }
  }

  // Probe detail from the last JSON payload
  if (last?.payload) {
    const p = last.payload;
    const probes = p.probes ?? p.results ?? p.checks;
    if (Array.isArray(probes) && probes.length > 0) {
      lines.push("");
      lines.push(`  ${BOLD}Probe detail:${RESET}`);
      for (const probe of probes) {
        const name = String(probe.name ?? probe.id ?? "?").padEnd(20);
        const ok = probe.ok ?? probe.passed ?? probe.healthy;
        const verdict = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
        const detail = String(probe.detail ?? probe.message ?? "").slice(0, 60);
        lines.push(`    ${verdict} ${name} ${DIM}${detail}${RESET}`);
      }
    } else if (typeof p === "object") {
      lines.push("");
      lines.push(`  ${DIM}monitor payload keys: ${Object.keys(p).slice(0, 8).join(", ")}${RESET}`);
    }
  } else if (last && !last.ok && last.stderr) {
    lines.push("");
    lines.push(`  ${RED}monitor stderr (tail):${RESET}`);
    for (const line of last.stderr.split("\n")) lines.push(`    ${DIM}${line.slice(0, 78)}${RESET}`);
  }

  lines.push("");
  lines.push(`${DIM}  refresh: ${INTERVAL_SEC}s · exit: Ctrl+C · alert logic: monitoring-alerts.mjs (single source)${RESET}`);
  lines.push("");
  return lines.join("\n");
}

// ── Rollback tag reminder (ops hygiene from the cheatsheet) ─────────
async function lastRollbackTag() {
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match=prod-*"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

// ── Main loop ───────────────────────────────────────────────────────
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const history = [];
  const baseUrl = process.env.PROD_BASE_URL ?? "http://127.0.0.1:8080";

  const tick = async () => {
    const result = runProbes();
    history.push(result);
    while (history.length > HISTORY) history.shift();

    const tag = await lastRollbackTag();
    let frame = render(history, baseUrl);
    if (tag) frame += `${DIM}  last prod-* tag: ${tag}${RESET}\n`;

    if (isOnce) {
      console.log(frame);
      process.exit(result.ok ? 0 : 1);
    }
    console.clear();
    console.log(frame);
  };

  await tick();
  if (!isOnce) {
    const timer = setInterval(() => void tick(), INTERVAL_SEC * 1000);
    const stop = () => {
      clearInterval(timer);
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
}
