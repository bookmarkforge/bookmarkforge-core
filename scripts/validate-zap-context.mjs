import fs from 'node:fs';

export function validateZapContextText(xml, configuredHost = process.env.ZAP_STAGING_HOST?.trim()) {
  const errors = [];
  if (!xml.includes('<context')) errors.push('file is not a ZAP context');
  const match = xml.match(/<name>\s*([^<]+)\s*<\/name>/i);
  if (!match?.[1]?.trim()) errors.push('context must have a name');

  const forbidden = [
    /Authorization\s*[:=]/i,
    /Bearer\s+[A-Za-z0-9._~-]+/i,
    /Basic\s+[A-Za-z0-9+/=]+/i,
    /password\s*=\s*['"][^$][^'"]+['"]/i,
    /<sessionToken>\s*[^$<]+\s*<\/sessionToken>/i,
  ];
  for (const pattern of forbidden) if (pattern.test(xml)) errors.push(`forbidden inline credential pattern: ${pattern}`);
  if (!/<authentication\b/i.test(xml)) errors.push('authenticated context must define authentication');

  const urls = [...xml.matchAll(/<\/?(?:loginurl|loginpageurl|url)>\s*([^<]+)\s*<\//gi)].map((entry) => entry[1].trim());
  if (urls.some((url) => !url.startsWith('https://'))) errors.push('every context URL must use HTTPS');
  const allowedHostPattern = /(^|\.)staging\.[a-z0-9-]+\.[a-z]{2,}(?::\d+)?(?:\/|\.\*|$)|(^|\.)[a-z0-9-]+-stage\.[a-z]{2,}(?::\d+)?(?:\/|\.\*|$)|(^|\.)[a-z0-9-]+\.test\.[a-z]{2,}(?::\d+)?(?:\/|\.\*|$)/i;
  const escapedHost = configuredHost?.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
  const hostPattern = escapedHost ? new RegExp(`^https://${escapedHost}(?:/|\\.\\*|$)`, 'i') : allowedHostPattern;
  const matchesHost = (url) => {
    const normalized = url.replace(/\.\*$/, '');
    if (escapedHost) return hostPattern.test(url) || hostPattern.test(normalized);
    try {
      const parsed = new URL(normalized);
      return allowedHostPattern.test(`${parsed.host}/`);
    } catch {
      return false;
    }
  };
  if (urls.some((url) => !matchesHost(url))) errors.push('context URLs must identify a non-placeholder staging host');
  return { errors, name: match?.[1]?.trim() };
}

const path = process.argv[2] ?? '.zap/authenticated.context';
if (!fs.existsSync(path)) {
  console.error(`[validate-zap-context] missing context: ${path}`);
  process.exitCode = 1;
} else {
  const result = validateZapContextText(fs.readFileSync(path, 'utf8'));
  if (result.errors.length) {
    console.error('[validate-zap-context] FAIL');
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`[validate-zap-context] valid context: ${result.name}`);
  }
}
