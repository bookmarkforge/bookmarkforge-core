#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";

export function formatCommand(command, args = []) {
  return [command, ...args].join(" ");
}

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function runCommandOk(command, args = [], options = {}) {
  try {
    return runCommand(command, args, options) === 0;
  } catch {
    return false;
  }
}

export function captureCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${command} exited with ${result.status}`);
  }
  return (result.stdout ?? "").trim();
}

export function captureShell(command, options = {}) {
  return execSync(command, { encoding: "utf8", ...options }).trim();
}

/**
 * Split a shell-style command line into argv (single/double quotes honored).
 * The operator-facing contract (ROLLBACK_CMD / PAGE_CMD env vars) stays a
 * command LINE, but the process is spawned without a shell: values coming
 * from configuration can never be re-interpreted by /bin/sh.
 */
export function splitCommandLine(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed) return [];
  const argv = [];
  let current = "";
  let quote = null;
  let hasToken = false;
  for (const ch of trimmed) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === "\"" || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        argv.push(current);
        current = "";
        hasToken = false;
      }
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) argv.push(current);
  return argv;
}

/**
 * Run a shell-style command LINE without a shell: split into argv, then
 * spawnSync directly. Returns the raw spawnSync result (status may be null
 * when the process could not be spawned). `options` passes through, so
 * `stdio`, `timeout`, `env`, `encoding` behave exactly as with spawnSync.
 */
export function runCommandLine(line, options = {}) {
  const argv = splitCommandLine(line);
  if (argv.length === 0) {
    return { status: -1, error: new Error("empty command line"), stdout: "", stderr: "" };
  }
  const [file, ...args] = argv;
  return spawnSync(file, args, options);
}
