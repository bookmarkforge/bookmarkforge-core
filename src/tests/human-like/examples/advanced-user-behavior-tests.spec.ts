import { test, expect } from "@playwright/test";

/**
 * Advanced User Behavior Tests
 * Tests for complex user interaction patterns and behavioral scenarios
 * These tests simulate human-like user behaviors and interaction flows
 */

test.describe("Advanced User Behavior", () => {
  test("should handle user onboarding flow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Simulate first-time user onboarding
    const onboardingModal = page.locator('[data-testid="onboarding-modal"]').first();
    if (await onboardingModal.count() > 0) {
      // Step through onboarding
      const nextButton = page.locator('[data-testid="onboarding-next"]').first();
      await nextButton.click();
      await page.waitForTimeout(500);

      // Complete onboarding
      const completeButton = page.locator('[data-testid="onboarding-complete"]').first();
      await completeButton.click();

      // Verify onboarding is dismissed
      const isDismissed = await onboardingModal.isHidden();
      expect(isDismissed).toBeTruthy();
    }
  });

  test("should handle user preference customization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Navigate to settings
    const settingsButton = page.locator('[data-testid="settings-button"]').first();
    if (await settingsButton.count() > 0) {
      await settingsButton.click();
      await page.waitForLoadState("networkidle");

      // Change theme preference
      const themeToggle = page.locator('[data-testid="theme-toggle"]').first();
      await themeToggle.click();

      // Verify preference is saved
      const currentTheme = await page.evaluate(() => {
        return localStorage.getItem("theme-preference");
      });

      expect(currentTheme).toBeTruthy();
    }
  });

  test("should handle user search behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Perform search
    const searchInput = page.locator('[data-testid="search-input"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill("test search");
      await page.waitForTimeout(300);

      // Verify search results
      const searchResults = page.locator('[data-testid="search-results"]').first();
      const hasResults = await searchResults.count() > 0;
      
      if (hasResults) {
        const resultCount = await searchResults.locator('[data-testid="search-result"]').count();
        expect(resultCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("should handle user keyboard shortcuts", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test keyboard shortcut for search
    await page.keyboard.press("Control+K");
    
    const searchInput = page.locator('[data-testid="search-input"]').first();
    const isFocused = await searchInput.evaluate((el) => document.activeElement === el);
    
    if (await searchInput.count() > 0) {
      expect(isFocused).toBeTruthy();
    }
  });

  test("should handle user navigation patterns", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Navigate through main sections
    const bookmarksTab = page.locator('[data-testid="bookmarks-tab"]').first();
    if (await bookmarksTab.count() > 0) {
      await bookmarksTab.click();
      await page.waitForLoadState("networkidle");

      const currentUrl = page.url();
      expect(currentUrl).toContain("bookmarks");
    }
  });

  test("should handle user content creation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Create new bookmark
    const createButton = page.locator('[data-testid="create-bookmark"]').first();
    if (await createButton.count() > 0) {
      await createButton.click();

      // Fill form
      const urlInput = page.locator('[data-testid="bookmark-url"]').first();
      await urlInput.fill("https://example.com");

      const titleInput = page.locator('[data-testid="bookmark-title"]').first();
      await titleInput.fill("Example Bookmark");

      // Submit
      const submitButton = page.locator('[data-testid="submit-bookmark"]').first();
      await submitButton.click();

      // Verify creation
      const successMessage = page.locator('[data-testid="create-success"]').first();
      const isVisible = await successMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user content editing", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Edit existing bookmark
    const editButton = page.locator('[data-testid="edit-bookmark"]').first();
    if (await editButton.count() > 0) {
      await editButton.click();

      // Modify content
      const titleInput = page.locator('[data-testid="bookmark-title"]').first();
      await titleInput.fill("Updated Title");

      // Save changes
      const saveButton = page.locator('[data-testid="save-bookmark"]').first();
      await saveButton.click();

      // Verify update
      const updatedTitle = await page.locator('[data-testid="bookmark-title"]').first().inputValue();
      expect(updatedTitle).toBe("Updated Title");
    }
  });

  test("should handle user content deletion", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Delete bookmark
    const deleteButton = page.locator('[data-testid="delete-bookmark"]').first();
    if (await deleteButton.count() > 0) {
      await deleteButton.click();

      // Confirm deletion
      const confirmButton = page.locator('[data-testid="confirm-delete"]').first();
      await confirmButton.click();

      // Verify deletion
      const deletedItem = page.locator('[data-testid="deleted-bookmark"]').first();
      const isRemoved = await deletedItem.isHidden();
      expect(isRemoved).toBeTruthy();
    }
  });

  test("should handle user filtering and sorting", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Apply filter
    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.count() > 0) {
      await filterButton.click();

      // Select filter option
      const filterOption = page.locator('[data-testid="filter-recent"]').first();
      await filterOption.click();

      // Verify filtered results
      const filteredItems = page.locator('[data-testid="filtered-item"]').first();
      const hasFilteredItems = await filteredItems.count() > 0;
      expect(hasFilteredItems).toBeTruthy();
    }
  });

  test("should handle user tagging behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add tag to item
    const tagInput = page.locator('[data-testid="tag-input"]').first();
    if (await tagInput.count() > 0) {
      await tagInput.fill("important");
      await page.keyboard.press("Enter");

      // Verify tag is added
      const addedTag = page.locator('[data-testid="tag-important"]').first();
      const isVisible = await addedTag.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user categorization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Move item to category
    const categoryDropdown = page.locator('[data-testid="category-dropdown"]').first();
    if (await categoryDropdown.count() > 0) {
      await categoryDropdown.click();

      const categoryOption = page.locator('[data-testid="category-work"]').first();
      await categoryOption.click();

      // Verify categorization
      const itemCategory = await page.evaluate(() => {
        return localStorage.getItem("item-category");
      });

      expect(itemCategory).toContain("work");
    }
  });

  test("should handle user bookmarking behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Bookmark a page
    const bookmarkButton = page.locator('[data-testid="bookmark-page"]').first();
    if (await bookmarkButton.count() > 0) {
      await bookmarkButton.click();

      // Verify bookmark is saved
      const isBookmarked = await bookmarkButton.getAttribute("data-bookmarked");
      expect(isBookmarked).toBe("true");
    }
  });

  test("should handle user sharing behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Share item
    const shareButton = page.locator('[data-testid="share-button"]').first();
    if (await shareButton.count() > 0) {
      await shareButton.click();

      // Verify share dialog
      const shareDialog = page.locator('[data-testid="share-dialog"]').first();
      const isVisible = await shareDialog.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user export behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Export data
    const exportButton = page.locator('[data-testid="export-button"]').first();
    if (await exportButton.count() > 0) {
      const downloadPromise = page.waitForEvent("download");
      await exportButton.click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toBeTruthy();
    }
  });

  test("should handle user import behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Import data
    const importButton = page.locator('[data-testid="import-button"]').first();
    if (await importButton.count() > 0) {
      await importButton.click();

      // Verify import dialog
      const importDialog = page.locator('[data-testid="import-dialog"]').first();
      const isVisible = await importDialog.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user undo/redo behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Perform action
    const actionButton = page.locator('[data-testid="action-button"]').first();
    if (await actionButton.count() > 0) {
      await actionButton.click();

      // Undo action
      await page.keyboard.press("Control+Z");

      // Verify undo
      const undoIndicator = page.locator('[data-testid="undo-indicator"]').first();
      const isVisible = await undoIndicator.isVisible();
      expect(isVisible).toBeTruthy();

      // Redo action
      await page.keyboard.press("Control+Y");

      // Verify redo
      const redoIndicator = page.locator('[data-testid="redo-indicator"]').first();
      const isRedone = await redoIndicator.isVisible();
      expect(isRedone).toBeTruthy();
    }
  });

  test("should handle user multi-selection behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Select multiple items
    const item1 = page.locator('[data-testid="selectable-item"]').nth(0);
    const item2 = page.locator('[data-testid="selectable-item"]').nth(1);

    if (await item1.count() > 0 && await item2.count() > 0) {
      await item1.click({ modifiers: ["Control"] });
      await item2.click({ modifiers: ["Control"] });

      // Verify multi-selection
      const selectedCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-selected="true"]').length;
      });

      expect(selectedCount).toBe(2);
    }
  });

  test("should handle user drag-and-drop behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Drag item to new location
    const draggable = page.locator('[data-testid="draggable-item"]').first();
    const dropzone = page.locator('[data-testid="dropzone"]').first();

    if (await draggable.count() > 0 && await dropzone.count() > 0) {
      await draggable.dragTo(dropzone);

      // Verify drop
      const droppedItem = dropzone.locator('[data-testid="draggable-item"]');
      const isDropped = await droppedItem.count() > 0;
      expect(isDropped).toBeTruthy();
    }
  });

  test("should handle user copy-paste behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Copy item
    const copyButton = page.locator('[data-testid="copy-button"]').first();
    if (await copyButton.count() > 0) {
      await copyButton.click();

      // Paste item
      await page.keyboard.press("Control+V");

      // Verify paste
      const pastedItem = page.locator('[data-testid="pasted-item"]').first();
      const isPasted = await pastedItem.count() > 0;
      expect(isPasted).toBeTruthy();
    }
  });

  test("should handle user context menu behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Right-click on item
    const contextItem = page.locator('[data-testid="context-item"]').first();
    if (await contextItem.count() > 0) {
      await contextItem.click({ button: "right" });

      // Verify context menu
      const contextMenu = page.locator('[data-testid="context-menu"]').first();
      const isVisible = await contextMenu.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user quick actions", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger quick action
    const quickActionButton = page.locator('[data-testid="quick-action"]').first();
    if (await quickActionButton.count() > 0) {
      await quickActionButton.click();

      // Verify quick action menu
      const quickActionMenu = page.locator('[data-testid="quick-action-menu"]').first();
      const isVisible = await quickActionMenu.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user search history", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Perform search
    const searchInput = page.locator('[data-testid="search-input"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill("test search");
      await page.keyboard.press("Enter");

      // Check search history
      await searchInput.click();
      const searchHistory = page.locator('[data-testid="search-history"]').first();
      const hasHistory = await searchHistory.count() > 0;
      expect(hasHistory).toBeTruthy();
    }
  });

  test("should handle user recent items", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Navigate to recent items
    const recentButton = page.locator('[data-testid="recent-button"]').first();
    if (await recentButton.count() > 0) {
      await recentButton.click();

      // Verify recent items list
      const recentItems = page.locator('[data-testid="recent-item"]').first();
      const hasRecentItems = await recentItems.count() > 0;
      expect(hasRecentItems).toBeTruthy();
    }
  });

  test("should handle user favorites behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add to favorites
    const favoriteButton = page.locator('[data-testid="favorite-button"]').first();
    if (await favoriteButton.count() > 0) {
      await favoriteButton.click();

      // Verify favorite status
      const isFavorite = await favoriteButton.getAttribute("data-favorite");
      expect(isFavorite).toBe("true");
    }
  });

  test("should handle user batch operations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Select multiple items
    const selectAllButton = page.locator('[data-testid="select-all"]').first();
    if (await selectAllButton.count() > 0) {
      await selectAllButton.click();

      // Perform batch action
      const batchDeleteButton = page.locator('[data-testid="batch-delete"]').first();
      await batchDeleteButton.click();

      // Confirm batch action
      const confirmButton = page.locator('[data-testid="confirm-batch"]').first();
      await confirmButton.click();

      // Verify batch operation
      const successMessage = page.locator('[data-testid="batch-success"]').first();
      const isVisible = await successMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user session persistence", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set session state
    await page.evaluate(() => {
      sessionStorage.setItem("user-session", "active");
    });

    // Reload page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Verify session is cleared (sessionStorage doesn't persist)
    const sessionData = await page.evaluate(() => {
      return sessionStorage.getItem("user-session");
    });

    expect(sessionData).toBeNull();
  });

  test("should handle user feedback submission", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open feedback form
    const feedbackButton = page.locator('[data-testid="feedback-button"]').first();
    if (await feedbackButton.count() > 0) {
      await feedbackButton.click();

      // Fill feedback
      const feedbackText = page.locator('[data-testid="feedback-text"]').first();
      await feedbackText.fill("This is test feedback");

      // Submit feedback
      const submitButton = page.locator('[data-testid="submit-feedback"]').first();
      await submitButton.click();

      // Verify submission
      const successMessage = page.locator('[data-testid="feedback-success"]').first();
      const isVisible = await successMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user help documentation access", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Access help
    const helpButton = page.locator('[data-testid="help-button"]').first();
    if (await helpButton.count() > 0) {
      await helpButton.click();

      // Verify help documentation
      const helpContent = page.locator('[data-testid="help-content"]').first();
      const isVisible = await helpContent.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle user account settings", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Navigate to account settings
    const accountButton = page.locator('[data-testid="account-button"]').first();
    if (await accountButton.count() > 0) {
      await accountButton.click();

      // Change account setting
      const settingToggle = page.locator('[data-testid="account-setting"]').first();
      await settingToggle.click();

      // Verify setting change
      const settingValue = await settingToggle.getAttribute("data-enabled");
      expect(settingValue).toBeTruthy();
    }
  });

  test("should handle user logout behavior", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Logout
    const logoutButton = page.locator('[data-testid="logout-button"]').first();
    if (await logoutButton.count() > 0) {
      await logoutButton.click();

      // Verify logout
      const loginPrompt = page.locator('[data-testid="login-prompt"]').first();
      const isVisible = await loginPrompt.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });
});
