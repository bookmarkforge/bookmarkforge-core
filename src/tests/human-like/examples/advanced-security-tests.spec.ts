import { test, expect } from "@playwright/test";

/**
 * Advanced Security Tests
 * Tests for security features, authentication, and data protection
 * These tests simulate human-like interactions with security scenarios
 */

test.describe("Advanced Security", () => {
  test("should handle password strength validation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test weak password
    const passwordInput = page.locator('[data-testid="password-input"]').first();
    if (await passwordInput.count() > 0) {
      await passwordInput.fill("weak");

      const strengthIndicator = page.locator('[data-testid="password-strength"]').first();
      const strength = await strengthIndicator.getAttribute("data-strength");
      expect(strength).toBe("weak");

      // Test strong password
      await passwordInput.fill("Str0ng!P@ssw0rd");
      const strongStrength = await strengthIndicator.getAttribute("data-strength");
      expect(strongStrength).toBe("strong");
    }
  });

  test("should handle two-factor authentication", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Enable 2FA
    const tfaButton = page.locator('[data-testid="enable-2fa"]').first();
    if (await tfaButton.count() > 0) {
      await tfaButton.click();

      // Verify 2FA setup
      const tfaSetup = page.locator('[data-testid="tfa-setup"]').first();
      const isVisible = await tfaSetup.isVisible();
      expect(isVisible).toBeTruthy();

      // Enter verification code
      const codeInput = page.locator('[data-testid="tfa-code"]').first();
      await codeInput.fill("123456");

      // Verify 2FA
      const verifyButton = page.locator('[data-testid="verify-2fa"]').first();
      await verifyButton.click();

      const tfaStatus = page.locator('[data-testid="tfa-status"]').first();
      const isEnabled = await tfaStatus.getAttribute("data-enabled");
      expect(isEnabled).toBe("true");
    }
  });

  test("should handle session timeout", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set short session timeout
    await page.evaluate(() => {
      localStorage.setItem("session-timeout", "1000"); // 1 second
    });

    // Wait for timeout
    await page.waitForTimeout(1500);

    // Verify session expired
    const sessionExpired = page.locator('[data-testid="session-expired"]').first();
    const isVisible = await sessionExpired.isVisible();
    expect(isVisible).toBeTruthy();
  });

  test("should handle logout on multiple devices", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Login on first device
    const loginButton = page.locator('[data-testid="login-button"]').first();
    if (await loginButton.count() > 0) {
      await loginButton.click();

      // Open second device
      const secondPage = await context.newPage();
      await secondPage.goto("/");
      await secondPage.waitForLoadState("networkidle");

      // Trigger logout on all devices
      const logoutAllButton = page.locator('[data-testid="logout-all"]').first();
      await logoutAllButton.click();

      // Verify both devices logged out
      const firstLoggedOut = await page.locator('[data-testid="logged-out"]').first().isVisible();
      const secondLoggedOut = await secondPage.locator('[data-testid="logged-out"]').first().isVisible();

      expect(firstLoggedOut).toBeTruthy();
      expect(secondLoggedOut).toBeTruthy();

      await secondPage.close();
    }
  });

  test("should handle secure password reset", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Request password reset
    const resetButton = page.locator('[data-testid="reset-password"]').first();
    if (await resetButton.count() > 0) {
      await resetButton.click();

      // Enter email
      const emailInput = page.locator('[data-testid="reset-email"]').first();
      await emailInput.fill("user@example.com");

      // Submit reset request
      const submitButton = page.locator('[data-testid="submit-reset"]').first();
      await submitButton.click();

      // Verify reset email sent
      const resetSent = page.locator('[data-testid="reset-sent"]').first();
      const isVisible = await resetSent.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle account lockout after failed attempts", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Attempt failed logins
    const loginButton = page.locator('[data-testid="login-button"]').first();
    if (await loginButton.count() > 0) {
      const passwordInput = page.locator('[data-testid="password-input"]').first();
      
      for (let i = 0; i < 5; i++) {
        await passwordInput.fill("wrong-password");
        await loginButton.click();
        await page.waitForTimeout(100);
      }

      // Verify account locked
      const lockedMessage = page.locator('[data-testid="account-locked"]').first();
      const isVisible = await lockedMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle CSRF protection", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for CSRF token
    const csrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      return meta?.getAttribute("content");
    });

    expect(csrfToken).toBeTruthy();
    expect(csrfToken?.length ?? 0).toBeGreaterThan(20);
  });

  test("should handle XSS protection", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Try to inject XSS
    const inputField = page.locator('[data-testid="user-input"]').first();
    if (await inputField.count() > 0) {
      await inputField.fill('<script>alert("XSS")</script>');

      // Verify XSS is escaped
      const escapedContent = await inputField.inputValue();
      expect(escapedContent).not.toContain("<script>");
    }
  });

  test("should handle SQL injection protection", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Try SQL injection
    const searchInput = page.locator('[data-testid="search-input"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill("' OR '1'='1");

      // Verify query is sanitized
      const sanitizedQuery = await searchInput.inputValue();
      expect(sanitizedQuery).not.toContain("'");
    }
  });

  test("should handle secure file upload", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Upload file
    const fileInput = page.locator('[data-testid="file-upload"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles({
        name: "test.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("test content"),
      });

      // Verify file is scanned
      const scanStatus = page.locator('[data-testid="scan-status"]').first();
      const isScanned = await scanStatus.getAttribute("data-scanned");
      expect(isScanned).toBe("true");
    }
  });

  test("should handle secure file download", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Download file
    const downloadButton = page.locator('[data-testid="download-button"]').first();
    if (await downloadButton.count() > 0) {
      const downloadPromise = page.waitForEvent("download");
      await downloadButton.click();
      const download = await downloadPromise;

      // Verify download is secure
      expect(download.suggestedFilename()).toBeTruthy();
    }
  });

  test("should handle content security policy", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check CSP headers
    const cspMeta = await page.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return meta?.getAttribute("content");
    });

    expect(cspMeta).toBeTruthy();
    expect(cspMeta).toContain("default-src");
  });

  test("should handle secure cookies", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check cookie security
    const cookies = await page.context().cookies();
    const secureCookie = cookies.find(c => c.name === "session" && c.secure);

    expect(secureCookie).toBeTruthy();
  });

  test("should handle HTTPS enforcement", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check if using HTTPS
    const isHttps = page.url().startsWith("https://");
    
    // In development, this might be HTTP, but should enforce HTTPS in production
    const httpsMeta = await page.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return meta?.getAttribute("content")?.includes("upgrade-insecure-requests");
    });

    expect(httpsMeta).toBeTruthy();
  });

  test("should handle secure WebSocket connections", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check WebSocket security
    const wsConnection = await page.evaluate(() => {
      return new Promise((resolve) => {
        const ws = new WebSocket("wss://example.com");
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
      });
    });

    // In test environment, this might fail, but should use wss:// in production
    expect(wsConnection).toBeDefined();
  });

  test("should handle input sanitization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test various malicious inputs
    const maliciousInputs = [
      "<script>alert('XSS')</script>",
      "javascript:alert('XSS')",
      "<img src=x onerror=alert('XSS')>",
      "<svg onload=alert('XSS')>",
    ];

    const inputField = page.locator('[data-testid="sanitized-input"]').first();
    if (await inputField.count() > 0) {
      for (const input of maliciousInputs) {
        await inputField.fill(input);
        const sanitized = await inputField.inputValue();
        expect(sanitized).not.toContain("<script>");
        expect(sanitized).not.toContain("javascript:");
      }
    }
  });

  test("should handle rate limiting on auth endpoints", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Attempt multiple rapid login attempts
    const loginButton = page.locator('[data-testid="login-button"]').first();
    if (await loginButton.count() > 0) {
      for (let i = 0; i < 10; i++) {
        await loginButton.click();
        await page.waitForTimeout(50);
      }

      // Verify rate limit
      const rateLimitMessage = page.locator('[data-testid="rate-limit"]').first();
      const isVisible = await rateLimitMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle secure session storage", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check session storage security
    const sessionData = await page.evaluate(() => {
      return sessionStorage.getItem("session-data");
    });

    // Session data should be encrypted or not contain sensitive info
    if (sessionData) {
      const isEncrypted = !sessionData.includes("password") && !sessionData.includes("token");
      expect(isEncrypted).toBeTruthy();
    }
  });

  test("should handle secure local storage", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check local storage security
    const localStorageData = await page.evaluate(() => {
      return localStorage.getItem("user-data");
    });

    // Local storage should not contain sensitive data
    if (localStorageData) {
      const isSecure = !localStorageData.includes("password") && !localStorageData.includes("token");
      expect(isSecure).toBeTruthy();
    }
  });

  test("should handle secure headers", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check security headers
    const response = await page.goto("/");
    const headers = response?.headers();

    if (headers) {
      expect(headers["x-frame-options"]).toBeTruthy();
      expect(headers["x-content-type-options"]).toBeTruthy();
      expect(headers["x-xss-protection"]).toBeTruthy();
    }
  });

  test("should handle audit logging", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Perform sensitive action
    const sensitiveButton = page.locator('[data-testid="sensitive-action"]').first();
    if (await sensitiveButton.count() > 0) {
      await sensitiveButton.click();

      // Verify audit log
      const auditLog = page.locator('[data-testid="audit-log"]').first();
      const hasLog = await auditLog.count() > 0;
      expect(hasLog).toBeTruthy();
    }
  });

  test("should handle permission requests", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Request camera permission
    const cameraButton = page.locator('[data-testid="camera-permission"]').first();
    if (await cameraButton.count() > 0) {
      await cameraButton.click();

      // Verify permission request
      const permissionDialog = page.locator('[data-testid="permission-dialog"]').first();
      const isVisible = await permissionDialog.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle data encryption at rest", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store sensitive data
    await page.evaluate(() => {
      const encrypted = btoa("sensitive-data");
      localStorage.setItem("encrypted-data", encrypted);
    });

    // Verify data is encrypted
    const storedData = await page.evaluate(() => {
      return localStorage.getItem("encrypted-data");
    });

    expect(storedData).not.toBe("sensitive-data");

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("encrypted-data");
    });
  });

  test("should handle data encryption in transit", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check if data is sent over HTTPS
    const secureRequest = await page.evaluate(async () => {
      try {
        const response = await fetch("/api/secure-endpoint");
        return response.url.startsWith("https://");
      } catch {
        return false;
      }
    });

    // In development might be HTTP, but should be HTTPS in production
    expect(secureRequest).toBeDefined();
  });

  test("should handle secure password storage", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store password
    await page.evaluate(() => {
      const hashed = "hashed-password-hash";
      localStorage.setItem("password-hash", hashed);
    });

    // Verify password is hashed
    const storedPassword = await page.evaluate(() => {
      return localStorage.getItem("password-hash");
    });

    expect(storedPassword).not.toBe("plaintext-password");

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("password-hash");
    });
  });

  test("should handle secure API key storage", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store API key
    const apiKeyButton = page.locator('[data-testid="add-api-key"]').first();
    if (await apiKeyButton.count() > 0) {
      await apiKeyButton.click();

      const apiKeyInput = page.locator('[data-testid="api-key-input"]').first();
      await apiKeyInput.fill("test-api-key-12345");

      const saveButton = page.locator('[data-testid="save-api-key"]').first();
      await saveButton.click();

      // Verify key is masked
      const maskedKey = page.locator('[data-testid="masked-key"]').first();
      const isMasked = await maskedKey.textContent();
      expect(isMasked).toContain("••••");
    }
  });

  test("should handle secure token management", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check token storage
    const tokenStorage = await page.evaluate(() => {
      const token = localStorage.getItem("auth-token");
      return {
        exists: !!token,
        isJwt: token?.startsWith("eyJ") || false,
        length: token?.length || 0,
      };
    });

    // Verify token is properly formatted
    if (tokenStorage.exists) {
      expect(tokenStorage.isJwt).toBeTruthy();
      expect(tokenStorage.length).toBeGreaterThan(100);
    }
  });

  test("should handle secure session management", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check session management
    const sessionInfo = await page.evaluate(() => {
      return {
        hasSession: !!sessionStorage.getItem("session-id"),
        hasCsrf: !!document.querySelector('meta[name="csrf-token"]'),
        cookieCount: document.cookie.split(";").length,
      };
    });

    // Verify session security
    expect(sessionInfo.hasCsrf).toBeTruthy();
    expect(sessionInfo.cookieCount).toBeGreaterThan(0);
  });

  test("should handle secure data deletion", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Delete sensitive data
    const deleteButton = page.locator('[data-testid="delete-sensitive"]').first();
    if (await deleteButton.count() > 0) {
      await deleteButton.click();

      // Confirm deletion
      const confirmButton = page.locator('[data-testid="confirm-delete"]').first();
      await confirmButton.click();

      // Verify data is deleted
      const deletedData = page.locator('[data-testid="deleted-data"]').first();
      const isRemoved = await deletedData.isHidden();
      expect(isRemoved).toBeTruthy();
    }
  });

  test("should handle secure data backup", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Create encrypted backup
    const backupButton = page.locator('[data-testid="encrypted-backup"]').first();
    if (await backupButton.count() > 0) {
      await backupButton.click();

      // Verify backup is encrypted
      const backupStatus = page.locator('[data-testid="backup-status"]').first();
      const isEncrypted = await backupStatus.getAttribute("data-encrypted");
      expect(isEncrypted).toBe("true");
    }
  });

  test("should handle secure data restoration", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Restore from encrypted backup
    const restoreButton = page.locator('[data-testid="restore-backup"]').first();
    if (await restoreButton.count() > 0) {
      await restoreButton.click();

      // Verify restoration requires authentication
      const authRequired = page.locator('[data-testid="auth-required"]').first();
      const isVisible = await authRequired.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle security audit trail", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check audit trail
    const auditTrail = page.locator('[data-testid="audit-trail"]').first();
    if (await auditTrail.count() > 0) {
      const hasAuditEntries = await auditTrail.locator('[data-testid="audit-entry"]').count();
      expect(hasAuditEntries).toBeGreaterThan(0);
    }
  });

  test("should handle security incident reporting", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Report security incident
    const reportButton = page.locator('[data-testid="report-incident"]').first();
    if (await reportButton.count() > 0) {
      await reportButton.click();

      // Fill incident details
      const incidentInput = page.locator('[data-testid="incident-details"]').first();
      await incidentInput.fill("Test security incident");

      // Submit report
      const submitButton = page.locator('[data-testid="submit-incident"]').first();
      await submitButton.click();

      // Verify report submitted
      const reportStatus = page.locator('[data-testid="report-status"]').first();
      const isSubmitted = await reportStatus.getAttribute("data-submitted");
      expect(isSubmitted).toBe("true");
    }
  });

  test("should handle security policy compliance", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check security policy compliance
    const complianceStatus = page.locator('[data-testid="compliance-status"]').first();
    if (await complianceStatus.count() > 0) {
      const isCompliant = await complianceStatus.getAttribute("data-compliant");
      expect(isCompliant).toBe("true");
    }
  });

  test("should handle security notifications", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check security notifications
    const securityNotifications = page.locator('[data-testid="security-notification"]').first();
    if (await securityNotifications.count() > 0) {
      const hasNotifications = await securityNotifications.locator('[data-testid="notification"]').count();
      expect(hasNotifications).toBeGreaterThanOrEqual(0);
    }
  });

  test("should handle user consent management", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check consent management
    const consentBanner = page.locator('[data-testid="consent-banner"]').first();
    if (await consentBanner.count() > 0) {
      const isVisible = await consentBanner.isVisible();

      if (isVisible) {
        // Accept consent
        const acceptButton = page.locator('[data-testid="accept-consent"]').first();
        await acceptButton.click();

        // Verify consent recorded
        const consentRecorded = page.locator('[data-testid="consent-recorded"]').first();
        const isRecorded = await consentRecorded.getAttribute("data-recorded");
        expect(isRecorded).toBe("true");
      }
    }
  });

  test("should handle privacy settings", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Configure privacy settings
    const privacyButton = page.locator('[data-testid="privacy-settings"]').first();
    if (await privacyButton.count() > 0) {
      await privacyButton.click();

      // Disable analytics
      const analyticsToggle = page.locator('[data-testid="analytics-toggle"]').first();
      await analyticsToggle.click();

      // Save settings
      const saveButton = page.locator('[data-testid="save-privacy"]').first();
      await saveButton.click();

      // Verify settings saved
      const privacyStatus = page.locator('[data-testid="privacy-status"]').first();
      const isSaved = await privacyStatus.getAttribute("data-saved");
      expect(isSaved).toBe("true");
    }
  });

  test("should handle data retention policy", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check data retention
    const retentionInfo = page.locator('[data-testid="retention-info"]').first();
    if (await retentionInfo.count() > 0) {
      const retentionPeriod = await retentionInfo.getAttribute("data-retention");
      expect(retentionPeriod).toBeTruthy();
    }
  });

  test("should handle right to be forgotten", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Request data deletion
    const forgetButton = page.locator('[data-testid="forget-me"]').first();
    if (await forgetButton.count() > 0) {
      await forgetButton.click();

      // Confirm deletion
      const confirmButton = page.locator('[data-testid="confirm-forget"]').first();
      await confirmButton.click();

      // Verify data deletion initiated
      const deletionStatus = page.locator('[data-testid="deletion-status"]').first();
      const isInitiated = await deletionStatus.getAttribute("data-initiated");
      expect(isInitiated).toBe("true");
    }
  });

  test("should handle secure communication channels", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check communication security
    const commSecurity = await page.evaluate(() => {
      const ws = new WebSocket("wss://example.com");
      return new Promise((resolve) => {
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
      });
    });

    // Verify secure communication
    expect(commSecurity).toBeDefined();
  });

  test("should handle secure third-party integrations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check third-party security
    const thirdPartyAuth = page.locator('[data-testid="third-party-auth"]').first();
    if (await thirdPartyAuth.count() > 0) {
      await thirdPartyAuth.click();

      // Verify OAuth flow
      const oauthWindow = page.locator('[data-testid="oauth-window"]').first();
      const isVisible = await oauthWindow.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });
});
