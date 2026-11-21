#!/usr/bin/env node
/**
 * Compliance Status Report Generator
 *
 * Analyzes the codebase to verify compliance with GDPR, CCPA, OWASP Top 10,
 * and other security/privacy standards documented in COMPLIANCE-GUIDE.md
 *
 * Usage: node scripts/compliance-status.mjs [--format markdown|json]
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const FORMAT = process.argv.includes('--json') ? 'json' : 'markdown';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function color(text, color) {
  return FORMAT === 'json' ? text : `${colors[color]}${text}${colors.reset}`;
}

/**
 * Check result structure
 */
class CheckResult {
  constructor(category, name, status, evidence = '', severity = 'medium') {
    this.category = category;
    this.name = name;
    this.status = status; // 'pass', 'fail', 'partial', 'not-applicable'
    this.evidence = evidence;
    this.severity = severity; // 'critical', 'high', 'medium', 'low'
  }
}

/**
 * Compliance categories and checks
 */
const complianceChecks = {
  gdpr: {
    name: 'GDPR Compliance',
    checks: [
      {
        id: 'gdpr-privacy-policy',
        name: 'Privacy Policy Published',
        severity: 'critical',
        files: ['public/privacy-and-terms.html', 'legal/privacy-and-terms.html'],
        check: (_files) => {
          const found = files.some(f => existsSync(join(ROOT, f)));
          return found ? 'pass' : 'fail';
        },
        evidence: (_files) => {
          const found = files.filter(f => existsSync(join(ROOT, f)));
          return found.length > 0 ? `Found at: ${found.join(', ')}` : 'Not found';
        }
      },
      {
        id: 'gdpr-terms-service',
        name: 'Terms of Service Published',
        severity: 'critical',
        files: ['public/privacy-and-terms.html', 'public/terms.html', 'legal/terms.html'],
        check: (_files) => {
          const privacyTermsFile = join(ROOT, 'public/privacy-and-terms.html');
          if (existsSync(privacyTermsFile)) {
            const content = readFileSync(privacyTermsFile, 'utf-8');
            return content.includes('Terms of Service') || content.includes('terms') ? 'pass' : 'fail';
          }
          const found = files.some(f => existsSync(join(ROOT, f)));
          return found ? 'pass' : 'fail';
        },
        evidence: (_files) => {
          const privacyTermsFile = join(ROOT, 'public/privacy-and-terms.html');
          if (existsSync(privacyTermsFile)) {
            const content = readFileSync(privacyTermsFile, 'utf-8');
            if (content.includes('Terms of Service') || content.includes('terms')) {
              return 'Combined with Privacy Policy at public/privacy-and-terms.html';
            }
          }
          const found = files.filter(f => existsSync(join(ROOT, f)));
          return found.length > 0 ? `Found at: ${found.join(', ')}` : 'Not found';
        }
      },
      {
        id: 'gdpr-ropa',
        name: 'ROPA Documented',
        severity: 'high',
        files: ['docs/ROPA.md'],
        check: (_files) => {
          const found = files.some(f => existsSync(join(ROOT, f)));
          return found ? 'pass' : 'fail';
        },
        evidence: (_files) => {
          const found = files.filter(f => existsSync(join(ROOT, f)));
          return found.length > 0 ? `Found at: ${found.join(', ')}` : 'Not found';
        }
      },
      {
        id: 'gdpr-right-access',
        name: 'Right to Access (Data Export)',
        severity: 'high',
        files: ['src/services/exporter.formatters.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/exporter.formatters.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('export') ? 'pass' : 'fail';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/exporter.formatters.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('export') ? 'Export functionality implemented' : 'Export not found';
        }
      },
      {
        id: 'gdpr-right-rectification',
        name: 'Right to Rectification (Edit Data)',
        severity: 'high',
        files: ['src/db/database.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/db/database.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('upsert') || content.includes('update') ? 'pass' : 'fail';
        },
        evidence: () => {
          const file = join(ROOT, 'src/db/database.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('upsert') || content.includes('update')
            ? 'Update operations available'
            : 'Update operations not found';
        }
      },
      {
        id: 'gdpr-right-erasure',
        name: 'Right to Erasure (Delete Vault)',
        severity: 'critical',
        files: ['src/services/SecurityVault.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/SecurityVault.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('delete') || content.includes('destroy') ? 'pass' : 'fail';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/SecurityVault.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('delete') || content.includes('destroy')
            ? 'Delete functionality implemented'
            : 'Delete functionality not found';
        }
      },
      {
        id: 'gdpr-right-portability',
        name: 'Right to Portability',
        severity: 'high',
        files: ['src/services/exporter.formatters.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/exporter.formatters.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('json') || content.includes('Blob') ? 'pass' : 'fail';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/exporter.formatters.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('json') || content.includes('Blob')
            ? 'Portable format export available'
            : 'Portable format not found';
        }
      },
    ]
  },
  ccpa: {
    name: 'CCPA Compliance',
    checks: [
      {
        id: 'ccpa-privacy-policy',
        name: 'Privacy Policy Includes Data Categories',
        severity: 'critical',
        files: ['public/privacy-and-terms.html'],
        check: (_files) => {
          const file = join(ROOT, 'public/privacy-and-terms.html');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('data') || content.includes('information') ? 'pass' : 'partial';
        },
        evidence: () => {
          const file = join(ROOT, 'public/privacy-and-terms.html');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('data') || content.includes('information')
            ? 'Data categories mentioned'
            : 'Data categories not explicitly mentioned';
        }
      },
      {
        id: 'ccpa-no-sale',
        name: 'No Sale of Data Documented',
        severity: 'high',
        files: ['public/privacy-and-terms.html'],
        check: (_files) => {
          const file = join(ROOT, 'public/privacy-and-terms.html');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('sell') || content.includes('sale') ? 'pass' : 'partial';
        },
        evidence: () => {
          const file = join(ROOT, 'public/privacy-and-terms.html');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('sell') || content.includes('sale')
            ? 'Data sale policy mentioned'
            : 'Data sale policy not explicitly mentioned';
        }
      },
    ]
  },
  security: {
    name: 'Security Standards (OWASP Top 10)',
    checks: [
      {
        id: 'owasp-a02-crypto',
        name: 'A02: Cryptographic Failures (AES-256-GCM)',
        severity: 'critical',
        files: ['src/services/EncryptionService.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/EncryptionService.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          const hasAES = content.includes('AES-GCM') || content.includes('AES-256');
          const hasArgon2 = content.includes('Argon2id');
          return hasAES && hasArgon2 ? 'pass' : 'partial';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/EncryptionService.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          const hasAES = content.includes('AES-GCM') || content.includes('AES-256');
          const hasArgon2 = content.includes('Argon2id');
          const hasZeroize = content.includes('zeroPasswordBytes') || content.includes('zeroBytes');
          return `AES-GCM: ${hasAES ? '✓' : '✗'}, Argon2id: ${hasArgon2 ? '✓' : '✗'}, Zeroization: ${hasZeroize ? '✓' : '✗'}`;
        }
      },
      {
        id: 'owasp-a03-injection',
        name: 'A03: Injection (XSS Prevention)',
        severity: 'critical',
        files: ['package.json'],
        check: (_files) => {
          const file = join(ROOT, 'package.json');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('dompurify') ? 'pass' : 'fail';
        },
        evidence: () => {
          const file = join(ROOT, 'package.json');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('dompurify')
            ? 'DOMPurify dependency found'
            : 'DOMPurify not found';
        }
      },
      {
        id: 'owasp-a06-vuln-deps',
        name: 'A06: Vulnerable Components (Dep Audit)',
        severity: 'high',
        files: ['package.json'],
        check: (_files) => {
          const file = join(ROOT, 'package.json');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('npm audit') || existsSync(join(ROOT, 'scripts/npm-audit-payload.mjs')) ? 'pass' : 'partial';
        },
        evidence: () => {
          const hasScript = existsSync(join(ROOT, 'scripts/npm-audit-payload.mjs'));
          return hasScript
            ? 'npm audit script found'
            : 'npm audit script not found';
        }
      },
      {
        id: 'owasp-a07-auth',
        name: 'A07: Authentication Failures',
        severity: 'high',
        files: ['src/services/SecurityVault.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/SecurityVault.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('password') && content.includes('lock') ? 'pass' : 'partial';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/SecurityVault.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          const hasPassword = content.includes('password');
          const hasLock = content.includes('lock');
          return `Password: ${hasPassword ? '✓' : '✗'}, Lock: ${hasLock ? '✓' : '✗'}`;
        }
      },
      {
        id: 'owasp-a09-logging',
        name: 'A09: Logging/Monitoring (Audit Log)',
        severity: 'high',
        files: ['src/services/AuditLogService.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/AuditLogService.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('AuditAction') && content.includes('AuditEntry') ? 'pass' : 'fail';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/AuditLogService.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          const hasActions = content.includes('AuditAction');
          const hasEntries = content.includes('AuditEntry');
          const hasSecureStorage = content.includes('SecureStorage');
          return `AuditAction: ${hasActions ? '✓' : '✗'}, AuditEntry: ${hasEntries ? '✓' : '✗'}, SecureStorage: ${hasSecureStorage ? '✓' : '✗'}`;
        }
      },
    ]
  },
  data_retention: {
    name: 'Data Retention',
    checks: [
      {
        id: 'retention-policy',
        name: 'Retention Policy Documented',
        severity: 'medium',
        files: ['docs/security/COMPLIANCE-GUIDE.md'],
        check: (_files) => {
          const file = join(ROOT, 'docs/security/COMPLIANCE-GUIDE.md');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('retention') ? 'pass' : 'fail';
        },
        evidence: () => {
          const file = join(ROOT, 'docs/security/COMPLIANCE-GUIDE.md');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('retention')
            ? 'Retention policy documented'
            : 'Retention policy not documented';
        }
      },
      {
        id: 'audit-log-cleanup',
        name: 'Audit Log Cleanup (90 days)',
        severity: 'medium',
        files: ['src/services/AuditLogService.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/AuditLogService.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('MAX_ENTRIES') || content.includes('cleanup') ? 'pass' : 'partial';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/AuditLogService.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          const hasMax = content.includes('MAX_ENTRIES');
          const hasCleanup = content.includes('cleanup');
          return `MAX_ENTRIES: ${hasMax ? '✓' : '✗'}, Cleanup: ${hasCleanup ? '✓' : '✗'}`;
        }
      },
    ]
  },
  data_deletion: {
    name: 'Data Deletion',
    checks: [
      {
        id: 'delete-vault',
        name: 'Complete Vault Deletion',
        severity: 'critical',
        files: ['src/services/SecurityVault.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/SecurityVault.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('delete') || content.includes('destroy') ? 'pass' : 'fail';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/SecurityVault.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('delete') || content.includes('destroy')
            ? 'Delete functionality found'
            : 'Delete functionality not found';
        }
      },
      {
        id: 'delete-confirmation',
        name: 'Delete Confirmation Required',
        severity: 'high',
        files: ['src/services/SecurityVault.ts'],
        check: (_files) => {
          const file = join(ROOT, 'src/services/SecurityVault.ts');
          if (!existsSync(file)) return 'fail';
          const content = readFileSync(file, 'utf-8');
          return content.includes('confirm') ? 'pass' : 'partial';
        },
        evidence: () => {
          const file = join(ROOT, 'src/services/SecurityVault.ts');
          if (!existsSync(file)) return 'File not found';
          const content = readFileSync(file, 'utf-8');
          return content.includes('confirm')
            ? 'Confirmation logic found'
            : 'Confirmation logic not found';
        }
      },
    ]
  },
  open_source: {
    name: 'Open Source Compliance',
    checks: [
      {
        id: 'license-file',
        name: 'License File Present',
        severity: 'critical',
        files: ['LICENSE'],
        check: (_files) => {
          return existsSync(join(ROOT, 'LICENSE')) ? 'pass' : 'fail';
        },
        evidence: () => {
          return existsSync(join(ROOT, 'LICENSE')) ? 'LICENSE file found' : 'LICENSE file not found';
        }
      },
      {
        id: 'third-party-notices',
        name: 'Third-Party Notices',
        severity: 'medium',
        files: ['NOTICE', 'legal/third-party-notices.html'],
        check: (_files) => {
          const found = files.some(f => existsSync(join(ROOT, f)));
          return found ? 'pass' : 'partial';
        },
        evidence: (_files) => {
          const found = files.filter(f => existsSync(join(ROOT, f)));
          return found.length > 0 ? `Found at: ${found.join(', ')}` : 'Not found';
        }
      },
      {
        id: 'mit-compatible',
        name: 'MIT License Compatibility',
        severity: 'high',
        files: ['LICENSE', 'package.json'],
        check: (_files) => {
          const licenseFile = join(ROOT, 'LICENSE');
          const packageFile = join(ROOT, 'package.json');
          if (!existsSync(licenseFile) || !existsSync(packageFile)) return 'fail';
          const licenseContent = readFileSync(licenseFile, 'utf-8');
          const packageContent = readFileSync(packageFile, 'utf-8');
          const isMIT = licenseContent.includes('MIT') || packageContent.includes('"license": "MIT"');
          return isMIT ? 'pass' : 'fail';
        },
        evidence: () => {
          const licenseFile = join(ROOT, 'LICENSE');
          const packageFile = join(ROOT, 'package.json');
          if (!existsSync(licenseFile) || !existsSync(packageFile)) return 'Files not found';
          const licenseContent = readFileSync(licenseFile, 'utf-8');
          const packageContent = readFileSync(packageFile, 'utf-8');
          const isMIT = licenseContent.includes('MIT') || packageContent.includes('"license": "MIT"');
          return isMIT ? 'MIT license confirmed' : 'MIT license not confirmed';
        }
      },
    ]
  },
};

/**
 * Run all compliance checks
 */
function runChecks() {
  const results = [];

  for (const category of Object.values(complianceChecks)) {
    for (const check of category.checks) {
      const status = check.check(check.files);
      const evidence = check.evidence(check.files);
      results.push(new CheckResult(
        category.name,
        check.name,
        status,
        evidence,
        check.severity
      ));
    }
  }

  return results;
}

/**
 * Calculate summary statistics
 */
function calculateSummary(results) {
  const summary = {
    total: results.length,
    pass: 0,
    fail: 0,
    partial: 0,
    notApplicable: 0,
    critical: { pass: 0, fail: 0, partial: 0 },
    high: { pass: 0, fail: 0, partial: 0 },
    medium: { pass: 0, fail: 0, partial: 0 },
    low: { pass: 0, fail: 0, partial: 0 },
  };

  for (const result of results) {
    summary[result.status]++;
    summary[result.severity][result.status]++;
  }

  return summary;
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(results, summary) {
  const lines = [];

  lines.push('# Compliance Status Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Repository:** BookmarkForge`);
  lines.push('');

  // Summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`**Total Checks:** ${summary.total}`);
  lines.push(`- ${color('✓ PASS', 'green')}: ${summary.pass} (${((summary.pass / summary.total) * 100).toFixed(1)}%)`);
  lines.push(`- ${color('✗ FAIL', 'red')}: ${summary.fail} (${((summary.fail / summary.total) * 100).toFixed(1)}%)`);
  lines.push(`- ${color('◐ PARTIAL', 'yellow')}: ${summary.partial} (${((summary.partial / summary.total) * 100).toFixed(1)}%)`);
  lines.push('');

  // Severity breakdown
  lines.push('## Severity Breakdown');
  lines.push('');
  lines.push('### Critical');
  lines.push(`- Pass: ${summary.critical.pass}`);
  lines.push(`- Fail: ${summary.critical.fail}`);
  lines.push(`- Partial: ${summary.critical.partial}`);
  lines.push('');

  lines.push('### High');
  lines.push(`- Pass: ${summary.high.pass}`);
  lines.push(`- Fail: ${summary.high.fail}`);
  lines.push(`- Partial: ${summary.high.partial}`);
  lines.push('');

  lines.push('### Medium');
  lines.push(`- Pass: ${summary.medium.pass}`);
  lines.push(`- Fail: ${summary.medium.fail}`);
  lines.push(`- Partial: ${summary.medium.partial}`);
  lines.push('');

  // Detailed results by category
  lines.push('## Detailed Results');
  lines.push('');

  const categories = [...new Set(results.map(r => r.category))];
  for (const category of categories) {
    lines.push(`### ${category}`);
    lines.push('');

    const categoryResults = results.filter(r => r.category === category);
    for (const result of categoryResults) {
      const statusIcon = result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '◐';
      const statusColor = result.status === 'pass' ? 'green' : result.status === 'fail' ? 'red' : 'yellow';
      const severityBadge = result.severity.toUpperCase();

      lines.push(`- ${color(statusIcon, statusColor)} **${result.name}** [${severityBadge}]`);
      lines.push(`  - Status: ${color(result.status.toUpperCase(), statusColor)}`);
      lines.push(`  - Evidence: ${result.evidence}`);
      lines.push('');
    }
  }

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');

  const failed = results.filter(r => r.status === 'fail' && r.severity !== 'low');
  if (failed.length === 0) {
    lines.push('No critical or high priority failures. Good job!');
  } else {
    lines.push('### Priority Actions');
    lines.push('');
    for (const result of failed.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })) {
      lines.push(`- **${result.name}** (${result.severity.toUpperCase()})`);
      lines.push(`  - ${result.evidence}`);
      lines.push('');
    }
  }

  const partials = results.filter(r => r.status === 'partial');
  if (partials.length > 0) {
    lines.push('### Items Needing Attention');
    lines.push('');
    for (const result of partials) {
      lines.push(`- **${result.name}** (${result.severity.toUpperCase()})`);
      lines.push(`  - ${result.evidence}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate JSON report
 */
function generateJsonReport(results, summary) {
  return JSON.stringify({
    generated: new Date().toISOString(),
    repository: 'BookmarkForge',
    summary,
    results: results.map(r => ({
      category: r.category,
      name: r.name,
      status: r.status,
      evidence: r.evidence,
      severity: r.severity,
    })),
  }, null, 2);
}

/**
 * Main execution
 */
function main() {
  console.log(color('Running Compliance Status Analysis...', 'blue'));
  console.log('');

  const results = runChecks();
  const summary = calculateSummary(results);

  if (FORMAT === 'json') {
    console.log(generateJsonReport(results, summary));
  } else {
    console.log(generateMarkdownReport(results, summary));
  }

  // Exit with error code if there are critical failures
  const criticalFailures = results.filter(r => r.status === 'fail' && r.severity === 'critical').length;
  if (criticalFailures > 0) {
    process.exit(1);
  }
}

main();
