import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateZapContextText } from '../validate-zap-context.mjs';

describe('ZAP context validation', () => {
  it('accepts the repository context wildcard for a staging host', () => {
    const result = validateZapContextText(readFileSync('.zap/authenticated.context', 'utf8'));
    expect(result.errors).toEqual([]);
  });

  it('rejects a non-HTTPS or production context', () => {
    const result = validateZapContextText(
      '<context><name>x</name><authentication/><url>http://bookmarkforge.com.*</url></context>',
    );
    expect(result.errors).toContain('every context URL must use HTTPS');
    expect(result.errors).toContain('context URLs must identify a non-placeholder staging host');
  });
});
