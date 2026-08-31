#!/usr/bin/env node
import { validateStagingUrl } from "./staging-target-policy.mjs";

const baseUrl = (process.env.STAGING_URL ?? '').replace(/\/+$/, '');
if (!validateStagingUrl(baseUrl)) {
  console.error('[staging-http-checks] STAGING_URL must be an HTTPS URL');
  process.exit(1);
}

const paths = ['/', '/health'];
const secretPatterns = [
  /(?:api[_-]?key|secret|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:sk|pk)[-_][a-z0-9]{16,}/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
];
const checks = [];

for (const path of paths) {
  let response;
  let body = '';
  try {
    response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    body = await response.text();
  } catch (error) {
    checks.push({ ok: false, label: `${path} reachable`, detail: String(error) });
    continue;
  }

  checks.push({ ok: response.status >= 200 && response.status < 400, label: `${path} HTTP status`, detail: String(response.status) });
  checks.push({ ok: !secretPatterns.some((pattern) => pattern.test(body)), label: `${path} contains no secret material`, detail: 'response body inspected' });

  if (path === '/') {
    const csp = response.headers.get('content-security-policy') ?? '';
    const hsts = response.headers.get('strict-transport-security') ?? '';
    checks.push({ ok: csp.length > 0, label: 'CSP header present', detail: csp.slice(0, 100) });
    checks.push({ ok: /\bdefault-src\b/i.test(csp), label: 'CSP default-src directive present', detail: 'default-src checked' });
    checks.push({ ok: /max-age=\d+/i.test(hsts), label: 'HSTS max-age present', detail: hsts || 'missing' });
    checks.push({ ok: /includeSubDomains/i.test(hsts), label: 'HSTS includeSubDomains present', detail: hsts || 'missing' });
  }

  if (path === '/health') {
    let health;
    try { health = JSON.parse(body); } catch { health = null; }
    checks.push({ ok: health?.status === 'ok', label: 'health status is ok', detail: `HTTP ${response.status}` });
  }
}

for (const result of checks) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label} — ${result.detail}`);
if (checks.some(({ ok }) => !ok)) process.exit(1);
console.log(`[staging-http-checks] ${checks.length} checks passed`);
