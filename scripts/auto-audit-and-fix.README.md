# 🚀 Audit and Auto-Fix Script

**Script**: `scripts/auto-audit-and-fix.mjs`
**Purpose**: Execute all checks locally, automatically fix errors, and make a single commit
**Benefit**: Save GitHub Actions quotas by running everything locally

---

## 🎯 Why Use This Script

### Problem
- GitHub Actions has limited free quotas
- Individual commits consume CI/CD quota
- Each push executes all workflows

### Solution
- Execute all checks locally
- Automatically fix errors
- Make a single commit with all changes
- Only one push to GitHub → only one CI/CD execution

---

## 🚀 How to Use

### Basic Execution

```bash
node scripts/auto-audit-and-fix.mjs
```

### What the Script Does

1. **Executes typecheck** (`npm run typecheck:prod`)
2. **Executes lint** (`npm run lint`)
3. **Attempts auto-fix for lint errors**:
   - Fixes unused imports
   - Fixes catch errors without prefix
   - Fixes assigned but unused variables
4. **Re-executes lint** after fixes
5. **Shows result summary**
6. **Shows git status** with pending changes
7. **Suggests commands for commit and push**

---

## 📋 Script Output

```
🚀 Starting audit and auto-fix...
📦 Running all checks locally to save GitHub Actions quotas

🔧 TypeScript typecheck...
✅ TypeScript typecheck completed

🔧 ESLint...
❌ ESLint failed

🔧 Attempting auto-fix for lint errors...
  📝 Fixed 1 unused import(s) in scripts/namecheap-dns-config.mjs
  📝 Fixed 2 catch error(s) in scripts/vercel-configure-domain.mjs

🔧 Re-executing lint after fixes...
✅ ESLint (after fixes) completed

============================================================
📊 AUDIT SUMMARY
============================================================

TypeScript: ✅ PASSED
ESLint: ✅ PASSED

📝 Automatically fixed files: 3
  - scripts/namecheap-dns-config.mjs
  - scripts/vercel-configure-domain.mjs
  - scripts/whop-config.mjs

🔍 Checking git changes...
📝 Changes detected:
 M scripts/namecheap-dns-config.mjs
 M scripts/vercel-configure-domain.mjs
 M scripts/whop-config.mjs

💡 Suggestion:
  git add .
  git commit -m "fix: auto-fix of lint and typecheck errors"
  git push

============================================================
💡 RECOMMENDATIONS
============================================================

✅ All checks passed. You can commit and push.

📚 To run tests manually:
  npm run test:fast

📚 To run the complete pipeline:
  npm run ci:local

✅ Audit completed
```

---

## 🔧 Available Auto-Fixes

The script can automatically fix:

### 1. Unused Imports
```javascript
// Before
import { existsSync, readFileSync } from "node:fs";

// After
import { readFileSync } from "node:fs";
```

### 2. Catch Errors Without Prefix
```javascript
// Before
} catch (e) {

// After
} catch (_e) {
```

### 3. Assigned But Unused Variables
```javascript
// Before
const currentDNS = await getDNSConfig();

// After
// (removed)
```

---

## ⚠️ Limitations

### What It CAN Fix
- ✅ Unused imports in scripts
- ✅ Catch errors without prefix
- ✅ Simple unused variables

### What It CANNOT Fix
- ❌ Complex logic errors
- ❌ Application code errors (src/)
- ❌ TypeScript errors requiring type changes
- ❌ Test errors requiring manual correction

---

## 📊 Comparison: Workflow vs Script

| Aspect | Individual Workflow | Auto-Fix Script |
|--------|---------------------|-----------------|
| CI/CD executions | Multiple (one per commit) | One (only at the end) |
| Quota consumed | High | Low |
| Total time | Higher (wait for CI each time) | Lower (local execution) |
| Feedback | Slower (wait for CI) | Faster (local) |
| Corrections | Manual | Automatic |

---

## 🎯 When to Use

### Before Important Commits
- Before a release
- Before merge to main
- Before large changes

### After Significant Changes
- After refactoring
- After adding new features
- After bug fixes

### To Save Quotas
- When you have many pending changes
- When you want to make a single large commit
- When you're near quota limit

---

## 🚨 Important Notes

### 1. Manual Review Required
The script makes auto-fixes, but **always review changes before committing**.

### 2. Tests Not Executed by Default
Tests can take several minutes. The script doesn't execute them by default.
To run them manually:
```bash
npm run test:fast
```

### 3. Doesn't Replace CI/CD
The script is for **local development**. CI/CD on GitHub is still necessary for:
- Verify in clean environment
- Execute tests in multiple configurations
- Execute checks that can't be done locally

---

## 🔧 Related Commands

### Execute Complete Pipeline Locally
```bash
npm run ci:local
```

This executes:
- typecheck:prod
- lint
- test:fast
- build:ci
- check

### Execute Only Typecheck
```bash
npm run typecheck:prod
```

### Execute Only Lint
```bash
npm run lint
```

### Execute Only Tests
```bash
npm run test:fast
```

---

## 📚 References

- `AGENTS.md` - Development conventions
- `package.json` - Available npm scripts
- GitHub Actions documentation: https://docs.github.com/en/actions

---

## ✅ Checklist Before Using

- [ ] You have updated code (`git pull`)
- [ ] You don't have important uncommitted changes
- [ ] You will review changes after auto-fix
- [ ] You have time to review changes

---

## 🎯 Recommended Workflow

1. **Make changes** in code
2. **Execute script**: `node scripts/auto-audit-and-fix.mjs`
3. **Review changes** with `git diff`
4. **Add changes**: `git add .`
5. **Commit**: `git commit -m "fix: auto-fix"`
6. **Push**: `git push`
7. **Verify CI/CD** on GitHub

---

**Last updated**: October 2, 2026
**Version**: 1.0.0
