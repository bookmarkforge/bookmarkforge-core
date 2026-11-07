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
 *
 * This is the ONLY subprocess entry point the repo's operational scripts use
 * for a configured command line: the caller keeps writing a readable line
 * ("node scripts/nginx-render.mjs --write"), and nothing in it is ever
 * re-interpreted by /bin/sh. The single exception is the Windows fallback
 * below, and it exists because the platform, not the caller, forces it.
 */
export function runCommandLine(line, options = {}) {
  const argv = splitCommandLine(line);
  if (argv.length === 0) {
    return { status: -1, error: new Error("empty command line"), stdout: "", stderr: "" };
  }
  const [file, ...args] = argv;
  const result = spawnSync(file, args, options);
  // Windows resolves the CLI shims (npm, vercel, gh, …) to `.cmd` batch files
  // that Node refuses to exec without a shell (ENOENT/EINVAL). The direct argv
  // spawn stays the first — and on POSIX the only — attempt; the shell is a
  // platform fallback for a line the caller wrote literally, never for data.
  if (
    process.platform === "win32" &&
    (result.error?.code === "ENOENT" || result.error?.code === "EINVAL")
  ) {
    return spawnSync(line, { ...options, shell: true });
  }
  return result;
}

/**
 * execSync replacement over runCommandLine: returns the trimmed stdout and
 * throws on a non-zero status. The thrown error carries `status`, `stdout` and
 * `stderr`, exactly like execSync's, so existing catch blocks that log
 * `error.stdout` keep working after the conversion.
 */
export function captureCommandLine(line, options = {}) {
  const result = runCommandLine(line, { encoding: "utf8", ...options });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(stderr.trim() || `${line} exited with ${result.status}`);
    error.status = result.status;
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  }
  return stdout.trim();
}
