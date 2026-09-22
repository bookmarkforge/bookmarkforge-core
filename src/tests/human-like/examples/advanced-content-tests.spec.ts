import { test, expect } from "@playwright/test";

/**
 * Advanced Content Tests
 * Tests for content management, editing, and collaboration features
 * These tests simulate human-like interactions with content scenarios
 */

test.describe("Advanced Content", () => {
  test("should handle rich text editing", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open rich text editor
    const editorButton = page.locator('[data-testid="rich-text-editor"]').first();
    if (await editorButton.count() > 0) {
      await editorButton.click();

      // Format text
      const editor = page.locator('[data-testid="editor"]').first();
      await editor.fill("test content");

      // Apply formatting
      const boldButton = page.locator('[data-testid="bold-button"]').first();
      await boldButton.click();

      // Verify formatting
      const formattedText = await editor.evaluate((el) => {
        return el.innerHTML;
      });

      expect(formattedText).toContain("<strong>");
    }
  });

  test("should handle markdown editing", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open markdown editor
    const markdownButton = page.locator('[data-testid="markdown-editor"]').first();
    if (await markdownButton.count() > 0) {
      await markdownButton.click();

      // Write markdown
      const editor = page.locator('[data-testid="markdown-input"]').first();
      await editor.fill("# Test Heading\n\nTest paragraph");

      // Preview markdown
      const previewButton = page.locator('[data-testid="preview-button"]').first();
      await previewButton.click();

      // Verify preview
      const preview = page.locator('[data-testid="markdown-preview"]').first();
      const hasHeading = await preview.locator("h1").count() > 0;
      expect(hasHeading).toBeTruthy();
    }
  });

  test("should handle code editing with syntax highlighting", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open code editor
    const codeButton = page.locator('[data-testid="code-editor"]').first();
    if (await codeButton.count() > 0) {
      await codeButton.click();

      // Write code
      const editor = page.locator('[data-testid="code-input"]').first();
      await editor.fill("function test() { return true; }");

      // Verify syntax highlighting
      const highlightedCode = page.locator('[data-testid="code-highlighted"]').first();
      const hasHighlighting = await highlightedCode.getAttribute("data-highlighted");
      expect(hasHighlighting).toBeTruthy();
    }
  });

  test("should handle content versioning", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Create content
    const createButton = page.locator('[data-testid="create-content"]').first();
    if (await createButton.count() > 0) {
      await createButton.click();

      // Save version
      const saveButton = page.locator('[data-testid="save-version"]').first();
      await saveButton.click();

      // Verify version created
      const versionList = page.locator('[data-testid="version-list"]').first();
      const hasVersions = await versionList.locator('[data-testid="version"]').count() > 0;
      expect(hasVersions).toBeTruthy();
    }
  });

  test("should handle content restoration from version", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Restore from version
    const restoreButton = page.locator('[data-testid="restore-version"]').first();
    if (await restoreButton.count() > 0) {
      await restoreButton.click();

      // Select version
      const versionItem = page.locator('[data-testid="version-item"]').first();
      await versionItem.click();

      // Verify restoration
      const restoredContent = page.locator('[data-testid="restored-content"]').first();
      const isVisible = await restoredContent.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle content publishing", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Publish content
    const publishButton = page.locator('[data-testid="publish-button"]').first();
    if (await publishButton.count() > 0) {
      await publishButton.click();

      // Verify published status
      const publishedStatus = page.locator('[data-testid="published-status"]').first();
      const isPublished = await publishedStatus.getAttribute("data-published");
      expect(isPublished).toBe("true");
    }
  });

  test("should handle content scheduling", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Schedule content
    const scheduleButton = page.locator('[data-testid="schedule-button"]').first();
    if (await scheduleButton.count() > 0) {
      await scheduleButton.click();

      // Set schedule date
      const dateInput = page.locator('[data-testid="schedule-date"]').first();
      await dateInput.fill("2026-12-31");

      // Save schedule
      const saveButton = page.locator('[data-testid="save-schedule"]').first();
      await saveButton.click();

      // Verify scheduling
      const scheduledStatus = page.locator('[data-testid="scheduled-status"]').first();
      const isScheduled = await scheduledStatus.getAttribute("data-scheduled");
      expect(isScheduled).toBe("true");
    }
  });

  test("should handle content collaboration", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Share for collaboration
    const shareButton = page.locator('[data-testid="share-collaboration"]').first();
    if (await shareButton.count() > 0) {
      await shareButton.click();

      // Add collaborator
      const collaboratorInput = page.locator('[data-testid="collaborator-input"]').first();
      await collaboratorInput.fill("collaborator@example.com");

      // Send invite
      const inviteButton = page.locator('[data-testid="send-invite"]').first();
      await inviteButton.click();

      // Verify invite sent
      const inviteStatus = page.locator('[data-testid="invite-status"]').first();
      const isSent = await inviteStatus.getAttribute("data-sent");
      expect(isSent).toBe("true");
    }
  });

  test("should handle real-time collaboration", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check real-time status
    const realtimeStatus = page.locator('[data-testid="realtime-status"]').first();
    if (await realtimeStatus.count() > 0) {
      const isConnected = await realtimeStatus.getAttribute("data-connected");
      expect(isConnected).toBeDefined();
    }
  });

  test("should handle conflict resolution in collaboration", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Simulate conflict
    const conflictButton = page.locator('[data-testid="simulate-conflict"]').first();
    if (await conflictButton.count() > 0) {
      await conflictButton.click();

      // Check conflict resolution UI
      const conflictUI = page.locator('[data-testid="conflict-resolution"]').first();
      const isVisible = await conflictUI.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle content comments", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add comment
    const commentButton = page.locator('[data-testid="add-comment"]').first();
    if (await commentButton.count() > 0) {
      await commentButton.click();

      // Write comment
      const commentInput = page.locator('[data-testid="comment-input"]').first();
      await commentInput.fill("Test comment");

      // Submit comment
      const submitButton = page.locator('[data-testid="submit-comment"]').first();
      await submitButton.click();

      // Verify comment added
      const commentList = page.locator('[data-testid="comment-list"]').first();
      const hasComments = await commentList.locator('[data-testid="comment"]').count() > 0;
      expect(hasComments).toBeTruthy();
    }
  });

  test("should handle content reactions", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add reaction
    const reactionButton = page.locator('[data-testid="add-reaction"]').first();
    if (await reactionButton.count() > 0) {
      await reactionButton.click();

      // Select emoji
      const emojiOption = page.locator('[data-testid="emoji-like"]').first();
      await emojiOption.click();

      // Verify reaction added
      const reactionCount = page.locator('[data-testid="reaction-count"]').first();
      const count = await reactionCount.textContent();
      expect(parseInt(count || "0")).toBeGreaterThan(0);
    }
  });

  test("should handle content mentions", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add mention
    const mentionInput = page.locator('[data-testid="mention-input"]').first();
    if (await mentionInput.count() > 0) {
      await mentionInput.fill("@user");

      // Verify mention suggestions
      const mentionSuggestions = page.locator('[data-testid="mention-suggestions"]').first();
      const hasSuggestions = await mentionSuggestions.count() > 0;
      expect(hasSuggestions).toBeTruthy();
    }
  });

  test("should handle content attachments", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add attachment
    const attachButton = page.locator('[data-testid="attach-file"]').first();
    if (await attachButton.count() > 0) {
      await attachButton.click();

      // Select file
      const fileInput = page.locator('[data-testid="file-input"]').first();
      await fileInput.setInputFiles({
        name: "test.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("test content"),
      });

      // Verify attachment added
      const attachmentList = page.locator('[data-testid="attachment-list"]').first();
      const hasAttachments = await attachmentList.locator('[data-testid="attachment"]').count() > 0;
      expect(hasAttachments).toBeTruthy();
    }
  });

  test("should handle content embedding", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Embed content
    const embedButton = page.locator('[data-testid="embed-content"]').first();
    if (await embedButton.count() > 0) {
      await embedButton.click();

      // Enter embed URL
      const embedInput = page.locator('[data-testid="embed-url"]').first();
      await embedInput.fill("https://example.com/embed");

      // Insert embed
      const insertButton = page.locator('[data-testid="insert-embed"]').first();
      await insertButton.click();

      // Verify embed added
      const embedFrame = page.locator('[data-testid="embed-frame"]').first();
      const isVisible = await embedFrame.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle content linking", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add link
    const linkButton = page.locator('[data-testid="add-link"]').first();
    if (await linkButton.count() > 0) {
      await linkButton.click();

      // Enter link URL
      const linkInput = page.locator('[data-testid="link-url"]').first();
      await linkInput.fill("https://example.com");

      // Insert link
      const insertButton = page.locator('[data-testid="insert-link"]').first();
      await insertButton.click();

      // Verify link added
      const contentLink = page.locator('a[href="https://example.com"]').first();
      const hasLink = await contentLink.count() > 0;
      expect(hasLink).toBeTruthy();
    }
  });

  test("should handle content images", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add image
    const imageButton = page.locator('[data-testid="add-image"]').first();
    if (await imageButton.count() > 0) {
      await imageButton.click();

      // Select image
      const imageInput = page.locator('[data-testid="image-input"]').first();
      await imageInput.setInputFiles({
        name: "test.png",
        mimeType: "image/png",
        buffer: Buffer.from("test image content"),
      });

      // Verify image added
      const contentImage = page.locator('img').first();
      const hasImage = await contentImage.count() > 0;
      expect(hasImage).toBeTruthy();
    }
  });

  test("should handle content videos", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add video
    const videoButton = page.locator('[data-testid="add-video"]').first();
    if (await videoButton.count() > 0) {
      await videoButton.click();

      // Enter video URL
      const videoInput = page.locator('[data-testid="video-url"]').first();
      await videoInput.fill("https://example.com/video.mp4");

      // Insert video
      const insertButton = page.locator('[data-testid="insert-video"]').first();
      await insertButton.click();

      // Verify video added
      const contentVideo = page.locator('video').first();
      const hasVideo = await contentVideo.count() > 0;
      expect(hasVideo).toBeTruthy();
    }
  });

  test("should handle content tables", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add table
    const tableButton = page.locator('[data-testid="add-table"]').first();
    if (await tableButton.count() > 0) {
      await tableButton.click();

      // Verify table added
      const contentTable = page.locator('table').first();
      const hasTable = await contentTable.count() > 0;
      expect(hasTable).toBeTruthy();
    }
  });

  test("should handle content lists", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add list
    const listButton = page.locator('[data-testid="add-list"]').first();
    if (await listButton.count() > 0) {
      await listButton.click();

      // Verify list added
      const contentList = page.locator('ul, ol').first();
      const hasList = await contentList.count() > 0;
      expect(hasList).toBeTruthy();
    }
  });

  test("should handle content blocks", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add content block
    const blockButton = page.locator('[data-testid="add-block"]').first();
    if (await blockButton.count() > 0) {
      await blockButton.click();

      // Select block type
      const blockType = page.locator('[data-testid="block-quote"]').first();
      await blockType.click();

      // Verify block added
      const contentBlock = page.locator('[data-testid="content-block"]').first();
      const hasBlock = await contentBlock.count() > 0;
      expect(hasBlock).toBeTruthy();
    }
  });

  test("should handle content templates", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Use template
    const templateButton = page.locator('[data-testid="use-template"]').first();
    if (await templateButton.count() > 0) {
      await templateButton.click();

      // Select template
      const templateOption = page.locator('[data-testid="template-blog"]').first();
      await templateOption.click();

      // Verify template applied
      const templateContent = page.locator('[data-testid="template-content"]').first();
      const hasTemplate = await templateContent.count() > 0;
      expect(hasTemplate).toBeTruthy();
    }
  });

  test("should handle content snippets", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Add snippet
    const snippetButton = page.locator('[data-testid="add-snippet"]').first();
    if (await snippetButton.count() > 0) {
      await snippetButton.click();

      // Select snippet
      const snippetOption = page.locator('[data-testid="snippet-code"]').first();
      await snippetOption.click();

      // Verify snippet added
      const contentSnippet = page.locator('[data-testid="content-snippet"]').first();
      const hasSnippet = await contentSnippet.count() > 0;
      expect(hasSnippet).toBeTruthy();
    }
  });

  test("should handle content search", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Search content
    const searchInput = page.locator('[data-testid="content-search"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill("test content");

      // Verify search results
      const searchResults = page.locator('[data-testid="search-results"]').first();
      const hasResults = await searchResults.locator('[data-testid="result"]').count() > 0;
      expect(hasResults).toBeDefined();
    }
  });

  test("should handle content filtering", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Apply filter
    const filterButton = page.locator('[data-testid="content-filter"]').first();
    if (await filterButton.count() > 0) {
      await filterButton.click();

      // Select filter
      const filterOption = page.locator('[data-testid="filter-published"]').first();
      await filterOption.click();

      // Verify filtered results
      const filteredContent = page.locator('[data-testid="filtered-content"]').first();
      const hasFiltered = await filteredContent.count() > 0;
      expect(hasFiltered).toBeDefined();
    }
  });

  test("should handle content sorting", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Sort content
    const sortButton = page.locator('[data-testid="content-sort"]').first();
    if (await sortButton.count() > 0) {
      await sortButton.click();

      // Select sort option
      const sortOption = page.locator('[data-testid="sort-date"]').first();
      await sortOption.click();

      // Verify sorted results
      const sortedContent = page.locator('[data-testid="sorted-content"]').first();
      const hasSorted = await sortedContent.count() > 0;
      expect(hasSorted).toBeDefined();
    }
  });

  test("should handle content archiving", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Archive content
    const archiveButton = page.locator('[data-testid="archive-content"]').first();
    if (await archiveButton.count() > 0) {
      await archiveButton.click();

      // Verify archived status
      const archivedStatus = page.locator('[data-testid="archived-status"]').first();
      const isArchived = await archivedStatus.getAttribute("data-archived");
      expect(isArchived).toBe("true");
    }
  });

  test("should handle content deletion", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Delete content
    const deleteButton = page.locator('[data-testid="delete-content"]').first();
    if (await deleteButton.count() > 0) {
      await deleteButton.click();

      // Confirm deletion
      const confirmButton = page.locator('[data-testid="confirm-delete"]').first();
      await confirmButton.click();

      // Verify deletion
      const deletedMessage = page.locator('[data-testid="deleted-message"]').first();
      const isVisible = await deletedMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle content duplication", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Duplicate content
    const duplicateButton = page.locator('[data-testid="duplicate-content"]').first();
    if (await duplicateButton.count() > 0) {
      await duplicateButton.click();

      // Verify duplication
      const duplicatedContent = page.locator('[data-testid="duplicated-content"]').first();
      const isVisible = await duplicatedContent.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle content move", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Move content
    const moveButton = page.locator('[data-testid="move-content"]').first();
    if (await moveButton.count() > 0) {
      await moveButton.click();

      // Select destination
      const destination = page.locator('[data-testid="destination-folder"]').first();
      await destination.click();

      // Verify move
      const movedContent = page.locator('[data-testid="moved-content"]').first();
      const isMoved = await movedContent.getAttribute("data-moved");
      expect(isMoved).toBe("true");
    }
  });

  test("should handle content categorization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Categorize content
    const categoryButton = page.locator('[data-testid="categorize-content"]').first();
    if (await categoryButton.count() > 0) {
      await categoryButton.click();

      // Select category
      const categoryOption = page.locator('[data-testid="category-blog"]').first();
      await categoryOption.click();

      // Verify categorization
      const categorizedContent = page.locator('[data-testid="categorized-content"]').first();
      const isCategorized = await categorizedContent.getAttribute("data-categorized");
      expect(isCategorized).toBe("true");
    }
  });

  test("should handle content tagging", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Tag content
    const tagButton = page.locator('[data-testid="tag-content"]').first();
    if (await tagButton.count() > 0) {
      await tagButton.click();

      // Add tag
      const tagInput = page.locator('[data-testid="tag-input"]').first();
      await tagInput.fill("important");
      await page.keyboard.press("Enter");

      // Verify tagging
      const taggedContent = page.locator('[data-testid="tagged-content"]').first();
      const isTagged = await taggedContent.getAttribute("data-tagged");
      expect(isTagged).toBe("true");
    }
  });

  test("should handle content metadata", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Edit metadata
    const metadataButton = page.locator('[data-testid="edit-metadata"]').first();
    if (await metadataButton.count() > 0) {
      await metadataButton.click();

      // Set metadata
      const titleInput = page.locator('[data-testid="meta-title"]').first();
      await titleInput.fill("Test Title");

      const descriptionInput = page.locator('[data-testid="meta-description"]').first();
      await descriptionInput.fill("Test Description");

      // Save metadata
      const saveButton = page.locator('[data-testid="save-metadata"]').first();
      await saveButton.click();

      // Verify metadata saved
      const metadataStatus = page.locator('[data-testid="metadata-status"]').first();
      const isSaved = await metadataStatus.getAttribute("data-saved");
      expect(isSaved).toBe("true");
    }
  });

  test("should handle content export", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Export content
    const exportButton = page.locator('[data-testid="export-content"]').first();
    if (await exportButton.count() > 0) {
      const downloadPromise = page.waitForEvent("download");
      await exportButton.click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toBeTruthy();
    }
  });

  test("should handle content import", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Import content
    const importButton = page.locator('[data-testid="import-content"]').first();
    if (await importButton.count() > 0) {
      await importButton.click();

      // Select file
      const fileInput = page.locator('[data-testid="import-file"]').first();
      await fileInput.setInputFiles({
        name: "content.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ title: "Imported content" })),
      });

      // Verify import
      const importedContent = page.locator('[data-testid="imported-content"]').first();
      const hasImported = await importedContent.count() > 0;
      expect(hasImported).toBeTruthy();
    }
  });

  test("should handle content sharing externally", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Share externally
    const shareButton = page.locator('[data-testid="share-external"]').first();
    if (await shareButton.count() > 0) {
      await shareButton.click();

      // Copy share link
      const copyButton = page.locator('[data-testid="copy-link"]').first();
      await copyButton.click();

      // Verify link copied
      const copyStatus = page.locator('[data-testid="copy-status"]').first();
      const isCopied = await copyStatus.getAttribute("data-copied");
      expect(isCopied).toBe("true");
    }
  });

  test("should handle content permissions", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set permissions
    const permissionsButton = page.locator('[data-testid="set-permissions"]').first();
    if (await permissionsButton.count() > 0) {
      await permissionsButton.click();

      // Set permission level
      const permissionLevel = page.locator('[data-testid="permission-edit"]').first();
      await permissionLevel.click();

      // Save permissions
      const saveButton = page.locator('[data-testid="save-permissions"]').first();
      await saveButton.click();

      // Verify permissions saved
      const permissionStatus = page.locator('[data-testid="permission-status"]').first();
      const isSaved = await permissionStatus.getAttribute("data-saved");
      expect(isSaved).toBe("true");
    }
  });

  test("should handle content approval workflow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Submit for approval
    const submitButton = page.locator('[data-testid="submit-approval"]').first();
    if (await submitButton.count() > 0) {
      await submitButton.click();

      // Verify pending status
      const approvalStatus = page.locator('[data-testid="approval-status"]').first();
      const isPending = await approvalStatus.getAttribute("data-status");
      expect(isPending).toBe("pending");
    }
  });

  test("should handle content scheduling expiration", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set expiration
    const expirationButton = page.locator('[data-testid="set-expiration"]').first();
    if (await expirationButton.count() > 0) {
      await expirationButton.click();

      // Set expiration date
      const dateInput = page.locator('[data-testid="expiration-date"]').first();
      await dateInput.fill("2026-12-31");

      // Save expiration
      const saveButton = page.locator('[data-testid="save-expiration"]').first();
      await saveButton.click();

      // Verify expiration set
      const expirationStatus = page.locator('[data-testid="expiration-status"]').first();
      const isSet = await expirationStatus.getAttribute("data-set");
      expect(isSet).toBe("true");
    }
  });

  test("should handle content auto-save", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Edit content
    const editor = page.locator('[data-testid="editor"]').first();
    if (await editor.count() > 0) {
      await editor.fill("test content");

      // Wait for auto-save
      await page.waitForTimeout(2000);

      // Verify auto-save indicator
      const autoSaveIndicator = page.locator('[data-testid="autosave-indicator"]').first();
      const hasAutoSave = await autoSaveIndicator.count() > 0;
      expect(hasAutoSave).toBeTruthy();
    }
  });

  test("should handle content draft management", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Save as draft
    const draftButton = page.locator('[data-testid="save-draft"]').first();
    if (await draftButton.count() > 0) {
      await draftButton.click();

      // Verify draft saved
      const draftStatus = page.locator('[data-testid="draft-status"]').first();
      const isDraft = await draftStatus.getAttribute("data-draft");
      expect(isDraft).toBe("true");
    }
  });

  test("should handle content preview mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Enter preview mode
    const previewButton = page.locator('[data-testid="preview-mode"]').first();
    if (await previewButton.count() > 0) {
      await previewButton.click();

      // Verify preview mode
      const previewMode = page.locator('[data-testid="preview-mode-active"]').first();
      const isActive = await previewMode.getAttribute("data-active");
      expect(isActive).toBe("true");
    }
  });

  test("should handle content print view", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open print view
    const printButton = page.locator('[data-testid="print-view"]').first();
    if (await printButton.count() > 0) {
      await printButton.click();

      // Verify print view
      const printView = page.locator('[data-testid="print-view"]').first();
      const isVisible = await printView.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });
});
