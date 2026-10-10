# GitHub Branch Protection Configuration Script

This script automates branch protection configuration for GitHub repositories.

## Features

- ✅ Blocks force push
- ✅ Blocks branch deletion
- ✅ Requires linear history
- ✅ Enforces rules on admins
- ✅ Requires conversation resolution
- ✅ Optional: Require pull request before merging
- ✅ Optional: Require status checks before merging

## Prerequisites

1. **GitHub Personal Access Token**
   - Go to https://github.com/settings/tokens
   - Create a new token
   - Select permissions: `repo` (full control)
   - Copy the token

2. **Repository Access**
   - Ensure you have admin access to the repository
   - Repository must have the branch you want to protect

## Setup

1. Copy the example environment file:
   ```bash
   cp scripts/github-branch-protection.example.env .env.local
   ```

2. Edit `.env.local` and fill in your values:
   ```bash
   GITHUB_TOKEN=your_github_token_here
   GITHUB_REPO_OWNER=bookmarkforge
   GITHUB_REPO_NAME=bookmarkforge
   BRANCH_NAME=release/v1.0.0
   REQUIRE_PR=false
   REQUIRE_STATUS_CHECKS=false
   ```

## Usage

### Basic usage (uses defaults from .env.local)
```bash
node scripts/github-branch-protection.mjs
```

### Custom branch
```bash
BRANCH_NAME=main node scripts/github-branch-protection.mjs
```

### Require pull request
```bash
REQUIRE_PR=true node scripts/github-branch-protection.mjs
```

### Require status checks
```bash
REQUIRE_STATUS_CHECKS=true node scripts/github-branch-protection.mjs
```

### Full custom configuration
```bash
GITHUB_TOKEN=your_token GITHUB_REPO_OWNER=bookmarkforge GITHUB_REPO_NAME=bookmarkforge BRANCH_NAME=release/v1.0.0 REQUIRE_PR=false REQUIRE_STATUS_CHECKS=false node scripts/github-branch-protection.mjs
```

## What the script does

1. **Checks if branch exists** in the repository
2. **Fetches current protection rules** (if any)
3. **Configures branch protection** with:
   - Block force push
   - Block branch deletion
   - Require linear history
   - Enforce on admins
   - Require conversation resolution
   - Optional: Require PR
   - Optional: Require status checks

## Protection Rules

### Always Enabled
- **Block force push** - History cannot be overwritten
- **Block branch deletion** - Cannot be deleted by accident
- **Require linear history** - No merge commits allowed
- **Enforce on admins** - Even repository admins must follow rules
- **Require conversation resolution** - All comments must be resolved

### Optional Rules
- **Require pull request** - Changes must go through PR
- **Require status checks** - CI/CD must pass before merge

## Example Output

```
🔧 Configuring branch protection for bookmarkforge/bookmarkforge:release/v1.0.0
📦 Repository: bookmarkforge/bookmarkforge
🌿 Branch: release/v1.0.0
🔒 Require PR: false
✅ Require Status Checks: false

🔍 Checking if branch release/v1.0.0 exists...
✅ Branch release/v1.0.0 exists
📋 Fetching current branch protection rules...
ℹ️  No existing protection rules found
🔒 Configuring branch protection...
✅ Branch protection configured successfully

═══════════════════════════════════════════════════════════════
              BRANCH PROTECTION SUMMARY
═══════════════════════════════════════════════════════════════

Repository:
  Owner: bookmarkforge
  Name: bookmarkforge
  Branch: release/v1.0.0

Protection Rules:
  ✅ Block force push: true
  ✅ Block branch deletion: true
  ✅ Require linear history: true
  ✅ Enforce on admins: true
  ✅ Require conversation resolution: true
  🔒 Require PR: false
  ✅ Require status checks: false

What this means:
  • Force push is blocked - history cannot be overwritten
  • Branch deletion is blocked - cannot be deleted by accident
  • Linear history is required - no merge commits allowed
  • Admins must follow rules - even repository admins
  • Conversation resolution required - all comments must be resolved

═══════════════════════════════════════════════════════════════

✅ Branch protection configuration completed successfully!

🌐 View at: https://github.com/bookmarkforge/bookmarkforge/settings/branches
```

## Troubleshooting

### Authentication Error
- Verify your GitHub token has `repo` (full control) permissions
- Ensure the token is not expired
- Regenerate the token if necessary

### Branch Not Found
- Verify the branch name is correct
- Check that the branch exists in the repository
- Ensure you have access to the repository

### Permission Denied
- Ensure you have admin access to the repository
- Verify the token has sufficient permissions
- Check that you are a member of the organization (if applicable)

### Overwrite Warning
- If the branch already has protection rules, the script will overwrite them
- Review the current rules before running the script
- You can manually remove protection rules in GitHub settings first

## Security

- Never commit `.env.local` to version control
- Use environment-specific `.env` files
- Rotate GitHub tokens regularly
- Use separate tokens for different repositories
- Revoke tokens that are no longer needed

## API Documentation

GitHub API documentation:
- https://docs.github.com/en/rest/branches/branch-protection
- https://docs.github.com/en/rest/branches

## License

MIT
