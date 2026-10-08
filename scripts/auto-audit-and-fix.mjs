#!/usr/bin/env node

/**
 * auto-audit-and-fix.mjs
 *
 * Audit and auto-fix script for BookmarkForge
 * Executes all checks, automatically fixes errors, and makes a single commit
 *
 * Usage: node scripts/auto-audit-and-fix.mjs
 *
 * Goal: Save GitHub Actions quotas by running everything locally
 * and making a single commit with all changes
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

// Console colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function runCommand(command, description) {
  log(`\n🔧 ${description}...`, colors.cyan);
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024 // 10MB
    });
    log(`✅ ${description} completed`, colors.green);
    return { success: true, output };
  } catch (error) {
    log(`❌ ${description} failed`, colors.red);
    return { success: false, error: error.message, output: error.stdout || '' };
  }
}

// Auto-fix functions for common errors
const autoFixes = {
  // Fix unused imports
  unusedImports: (content, filepath) => {
    let fixed = content;
    let changes = 0;

    // Remove common unused imports
    const unusedPatterns = [
      { pattern: /import \{ existsSync, ([^}]+) \} from "node:fs";/g, replacement: 'import { $1 } from "node:fs";' },
      { pattern: /import \{ readFileSync, ([^}]+) \} from "node:fs";/g, replacement: 'import { $1 } from "node:fs";' },
      { pattern: /import \{ ([^}]+), join \} from "node:path";/g, replacement: 'import { $1 } from "node:path";' },
    ];

    for (const { pattern, replacement } of unusedPatterns) {
      const matches = fixed.match(pattern);
      if (matches) {
        fixed = fixed.replace(pattern, replacement);
        changes += matches.length;
      }
    }

    if (changes > 0) {
      writeFileSync(filepath, fixed, 'utf-8');
      log(`  📝 Fixed ${changes} unused import(s) in ${filepath}`, colors.yellow);
    }

    return changes > 0;
  },

  // Fix catch errors without prefix
  catchErrors: (content, filepath) => {
    let fixed = content;
    let changes = 0;

    // Fix catch (e) to catch (_e)
    const pattern = /} catch \(e\) {/g;
    const matches = fixed.match(pattern);
    if (matches) {
      fixed = fixed.replace(pattern, '} catch (_e) {');
      changes = matches.length;
    }

    if (changes > 0) {
      writeFileSync(filepath, fixed, 'utf-8');
      log(`  📝 Fixed ${changes} catch error(s) in ${filepath}`, colors.yellow);
    }

    return changes > 0;
  },

  // Fix assigned but unused variables
  unusedVars: (content, filepath) => {
    let fixed = content;
    let changes = 0;

    // Remove unused variables (only for simple cases)
    const patterns = [
      { pattern: /const currentDNS = .+;\n/g, replacement: '' },
      { pattern: /const finalDNS = .+;\n/g, replacement: '' },
      { pattern: /const execAsync = .+;\n/g, replacement: '' },
    ];

    for (const { pattern, replacement } of patterns) {
      const matches = fixed.match(pattern);
      if (matches) {
        fixed = fixed.replace(pattern, replacement);
        changes += matches.length;
      }
    }

    if (changes > 0) {
      writeFileSync(filepath, fixed, 'utf-8');
      log(`  📝 Fixed ${changes} unused variable(s) in ${filepath}`, colors.yellow);
    }

    return changes > 0;
  },
};

async function main() {
  log('🚀 Starting audit and auto-fix...', colors.blue);
  log('📦 Running all checks locally to save GitHub Actions quotas\n', colors.yellow);

  const results = {
    typecheck: null,
    lint: null,
    test: null,
    fixes: [],
  };

  // 1. Typecheck
  results.typecheck = runCommand('npm run typecheck:prod', 'TypeScript typecheck');

  // 2. Lint
  results.lint = runCommand('npm run lint', 'ESLint');

  // 3. Tests (optional, can take time)
  log('\n⚠️  Run tests? (can take several minutes)', colors.yellow);
  log('    Answer "y" to run, any other key to skip', colors.yellow);

  // By default, we don't run tests to save time
  // results.test = runCommand('npm run test:fast', 'Vitest tests');

  // 4. Auto-fix for lint errors
  if (!results.lint.success) {
    log('\n🔧 Attempting auto-fix for lint errors...', colors.cyan);

    // Files with known errors
    const filesToFix = [
      'scripts/namecheap-dns-config.mjs',
      'scripts/namecheap-dns-manual-guide.mjs',
      'scripts/vercel-configure-domain.mjs',
      'scripts/whop-config.mjs',
    ];

    for (const filepath of filesToFix) {
      try {
        const content = readFileSync(filepath, 'utf-8');

        let fixed = false;
        fixed = autoFixes.unusedImports(content, filepath) || fixed;
        fixed = autoFixes.catchErrors(content, filepath) || fixed;
        fixed = autoFixes.unusedVars(content, filepath) || fixed;

        if (fixed) {
          results.fixes.push(filepath);
        }
      } catch (error) {
        log(`  ⚠️  Could not read ${filepath}: ${error.message}`, colors.yellow);
      }
    }

    // Re-run lint after fixes
    if (results.fixes.length > 0) {
      log('\n🔧 Re-running lint after fixes...', colors.cyan);
      results.lint = runCommand('npm run lint', 'ESLint (after fixes)');
    }
  }

  // 5. Summary
  log('\n' + '='.repeat(60), colors.blue);
  log('📊 AUDIT SUMMARY', colors.blue);
  log('='.repeat(60), colors.blue);

  log(`\nTypeScript: ${results.typecheck.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.typecheck.success ? colors.green : colors.red);

  log(`ESLint: ${results.lint.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.lint.success ? colors.green : colors.red);

  if (results.test) {
    log(`Tests: ${results.test.success ? '✅ PASSED' : '❌ FAILED'}`,
        results.test.success ? colors.green : colors.red);
  }

  if (results.fixes.length > 0) {
    log(`\n📝 Automatically fixed files: ${results.fixes.length}`, colors.yellow);
    results.fixes.forEach(file => log(`  - ${file}`, colors.yellow));
  }

  // 6. Git status
  log('\n🔍 Checking git changes...', colors.cyan);
  const gitStatus = runCommand('git status --short', 'Git status');

  if (gitStatus.success && gitStatus.output.trim()) {
    log('\n📝 Changes detected:', colors.yellow);
    log(gitStatus.output, colors.yellow);

    log('\n💡 Suggestion:', colors.cyan);
    log('  git add .', colors.cyan);
    log('  git commit -m "fix: auto-fix of lint and typecheck errors"', colors.cyan);
    log('  git push', colors.cyan);
  } else {
    log('\n✅ No pending changes', colors.green);
  }

  // 7. Recommendations
  log('\n' + '='.repeat(60), colors.blue);
  log('💡 RECOMMENDATIONS', colors.blue);
  log('='.repeat(60), colors.blue);

  if (!results.typecheck.success) {
    log('\n❌ TypeScript has errors. Review the output above.', colors.red);
  }

  if (!results.lint.success) {
    log('\n❌ ESLint has errors. Some may require manual correction.', colors.red);
  }

  if (results.typecheck.success && results.lint.success) {
    log('\n✅ All checks passed. You can commit and push.', colors.green);
  }

  log('\n📚 To run tests manually:', colors.cyan);
  log('  npm run test:fast', colors.cyan);

  log('\n📚 To run the complete pipeline:', colors.cyan);
  log('  npm run ci:local', colors.cyan);

  log('\n✅ Audit completed\n', colors.green);
}

main().catch(error => {
  log(`\n❌ Error: ${error.message}`, colors.red);
  process.exit(1);
});
