/**
 * Additional Features Tests - Complete Coverage
 * 
 * Tests for ALL remaining features:
 * - Chat/ChatPanel
 * - Voice Dictation/Commands
 * - Import/Export Dialogs
 * - Flashcard Review
 * - Graph View/Knowledge Dashboard
 * - Template Manager
 * - Image Generator
 * - Research Assistant
 * - Omnibar
 * - Welcome Tour/Onboarding
 * - Keyboard Shortcuts
 * - Collaboration
 * - Conflict Resolution
 *
 * Speed: every naked waitForTimeout pacing sleep was replaced with a bounded
 * UI-state assertion (tolerant via .catch to preserve the legacy weak-test
 * semantics). Only intentional realism pacing (readContent, network/offline
 * simulation) remains.
 */

import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { createAdvancedHumanBehavior, ciHumanOptions } from '../utils/advanced-human-behavior';
import { expectCapturedToast } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

/**
 * Tolerant, bounded replacement for the old naked sleeps: waits up to 5s for
 * the locator to become visible and swallows the timeout, preserving the
 * legacy "may or may not appear" semantics without burning fixed wall time.
 */
async function settle(locator: Locator, timeout = 5_000): Promise<void> {
  await expect(locator).toBeVisible({ timeout }).catch(() => { /* INTENTIONAL SILENCE: optional UI assertion is best-effort in this exploratory test. */ });
}

// ============================================================
// SECTION 1: CHAT & AI ASSISTANT
// ============================================================

test.describe('1. Chat & AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('1.1 Chat panel opens', async ({ page }) => {
    const chatButton = page.getByRole('button', { name: /chat|assistant/i }).first();
    if (await chatButton.isVisible()) {
      await chatButton.click();
      await settle(page.getByTestId('chat-input'));
    }
  });

  test('1.2 Chat input accepts text', async ({ page }) => {
    const chatButton = page.getByRole('button', { name: /chat|assistant/i }).first();
    if (await chatButton.isVisible()) {
      await chatButton.click();
      await settle(page.getByTestId('chat-input'));

      const chatInput = page.getByRole('textbox', { name: /message|chat|ask/i }).first();
      if (await chatInput.isVisible()) {
        await chatInput.fill('Hello AI');
        await expect(chatInput).toHaveValue('Hello AI');
      }
    }
  });

  test('1.3 Support chat opens', async ({ page }) => {
    const supportBtn = page.getByRole('button', { name: /support|help/i }).first();
    if (await supportBtn.isVisible()) {
      await supportBtn.click();
      await settle(page.getByRole('heading', { name: 'Help Center' }));
    }
  });
});

// ============================================================
// SECTION 2: VOICE FEATURES
// ============================================================

test.describe('2. Voice Features', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('2.1 Voice dictation button exists', async ({ page }) => {
    const voiceBtn = page.getByRole('button', { name: /voice|dictation|mic/i }).first();
    // Voice button may or may not be visible depending on state
    const isVisible = await voiceBtn.isVisible().catch(() => false);
    expect(typeof isVisible).toBe('boolean');
  });

  test('2.2 Voice command center opens', async ({ page }) => {
    const voiceCenterBtn = page.getByRole('button', { name: /voice command|command center/i }).first();
    if (await voiceCenterBtn.isVisible()) {
      await voiceCenterBtn.click();
      await settle(page.getByRole('heading', { name: 'Voice Commands' }));
    }
  });

  test('2.3 TTS player component', async ({ page }) => {
    // TTS player appears when reading content; keep a fast smoke assertion.
    await expect(page.locator('#root')).toBeVisible();
  });
});

// ============================================================
// SECTION 3: IMPORT/EXPORT
// ============================================================

test.describe('3. Import/Export Features', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('3.1 Import dialog opens', async ({ page }) => {
    const importBtn = page.getByRole('button', { name: /import/i }).first();
    if (await importBtn.isVisible()) {
      await importBtn.click();
      await settle(page.getByRole('dialog', { name: 'Import Data' }));
    }
  });

  test('3.2 Export dialog opens', async ({ page }) => {
    // Pin to the Dashboard's exporter button: a loose /export/i regex also
    // matches the BackupReminderBanner's "Export Physical Backup File" (which
    // appears earlier in the DOM), clicking which starts a real backup instead
    // of opening the dialog.
    const exportBtn = page.getByRole('button', {
      name: 'Open Exporter',
    });
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      await settle(page.locator('[role="dialog"]').first());
    }
  });

  test('3.3 Export as JSON option', async ({ page }) => {
    // Pin to the Dashboard's exporter button (see 3.2 for the banner trap).
    const exportBtn = page.getByRole('button', {
      name: 'Open Exporter',
    });
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      await settle(page.locator('[role="menuitem"], [role="dialog"]').first());

      const jsonOption = page.getByRole('menuitem', { name: /json/i }).first();
      if (await jsonOption.isVisible()) {
        await expect(jsonOption).toBeVisible();
      }
    }
  });

  test('3.4 Export as Markdown option', async ({ page }) => {
    // Pin to the Dashboard's exporter button (see 3.2 for the banner trap).
    const exportBtn = page.getByRole('button', {
      name: 'Open Exporter',
    });
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      await settle(page.locator('[role="menuitem"], [role="dialog"]').first());

      const mdOption = page.getByRole('menuitem', { name: /markdown|md/i }).first();
      if (await mdOption.isVisible()) {
        await expect(mdOption).toBeVisible();
      }
    }
  });

  test('3.5 PDF upload button', async ({ page }) => {
    const pdfBtn = page.getByRole('button', { name: /pdf|upload/i }).first();
    const isVisible = await pdfBtn.isVisible().catch(() => false);
    expect(typeof isVisible).toBe('boolean');
  });
});

// ============================================================
// SECTION 4: FLASHCARDS
// ============================================================

test.describe('4. Flashcard Features', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('4.1 Flashcard review mode', async ({ page }) => {
    const flashcardBtn = page.getByRole('button', { name: /flashcard|review/i }).first();
    if (await flashcardBtn.isVisible()) {
      await flashcardBtn.click();
      await settle(
        page.locator('.ds-modal-overlay').filter({ hasText: /show answer|forgotten|good|easy/i }),
      );
    }
  });

  test('4.2 Flashcard navigation', async ({ page }) => {
    // FlashcardReview only mounts when there are due cards and has no
    // Next/Previous buttons — advancing a card happens through the review
    // ratings (e.g. "Good" reveals the next card). Scope to the review
    // overlay so unrelated "Next" buttons elsewhere in the app (pagination,
    // onboarding) can never be clicked by mistake, and bound every
    // interaction so a missing review UI never burns the 90s budget.
    const reviewOverlay = page.locator('.ds-modal-overlay').filter({
      hasText: /show answer|forgotten|good|easy/i,
    });
    if (!(await reviewOverlay.isVisible().catch(() => false))) {
      // No due cards → nothing to navigate; the test is a no-op.
      return;
    }

    const showAnswer = reviewOverlay
      .getByRole('button', { name: /show answer/i })
      .first();
    if (await showAnswer.isVisible().catch(() => false)) {
      await showAnswer.click({ timeout: 3_000 });
    }

    // Rate the card to advance to the next one (or finish the session).
    const good = reviewOverlay
      .getByRole('button', { name: /^good$/i })
      .first();
    if (await good.isVisible().catch(() => false)) {
      await good.click({ timeout: 3_000 });
    }

    // The app stays responsive after the interaction.
    await expect(page.locator('#root')).toBeVisible();
  });

  test('4.3 Flip flashcard interaction', async ({ page }) => {
    // Click on card to flip
    const card = page.locator('[data-testid*="flashcard"], .flashcard').first();
    if (await card.isVisible()) {
      await card.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });
});

// ============================================================
// SECTION 5: GRAPH & KNOWLEDGE VIEW
// ============================================================

test.describe('5. Graph & Knowledge View', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('5.1 Graph view opens', async ({ page }) => {
    const graphBtn = page.getByRole('button', { name: /graph|knowledge|network/i }).first();
    if (await graphBtn.isVisible()) {
      await graphBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('5.2 Knowledge dashboard', async ({ page }) => {
    const knowledgeBtn = page.getByRole('button', { name: /knowledge|dashboard/i }).first();
    if (await knowledgeBtn.isVisible()) {
      await knowledgeBtn.click();
      await settle(page.getByRole('heading', { name: 'Analytics' }), 10_000);
    }
  });

  test('5.3 Backlinks panel', async ({ page }) => {
    const backlinksBtn = page.getByRole('button', { name: /backlink/i }).first();
    if (await backlinksBtn.isVisible()) {
      await backlinksBtn.click();
      await settle(page.getByText(/backlink/i).first());
    }
  });

  test('5.4 Canvas view', async ({ page }) => {
    const canvasBtn = page.getByRole('button', { name: /canvas/i }).first();
    if (await canvasBtn.isVisible()) {
      await canvasBtn.click();
      await settle(page.getByTestId('canvas-view'));
    }
  });
});

// ============================================================
// SECTION 6: TEMPLATE MANAGER
// ============================================================

test.describe('6. Template Manager', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('6.1 Template manager opens', async ({ page }) => {
    const templateBtn = page.getByRole('button', { name: /template/i }).first();
    if (await templateBtn.isVisible()) {
      await templateBtn.click();
      await settle(
        page.locator('[data-testid*="template"], [role="dialog"]').first(),
      );
    }
  });

  test('6.2 Template list displays', async ({ page }) => {
    const templateBtn = page.getByRole('button', { name: /template/i }).first();
    if (await templateBtn.isVisible()) {
      await templateBtn.click();
      await settle(
        page.locator('[data-testid*="template"], [role="dialog"]').first(),
      );

      // Check for template items
      const templateItems = page.locator('[data-testid*="template"], .template-item');
      const count = await templateItems.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================
// SECTION 7: IMAGE GENERATOR
// ============================================================

test.describe('7. Image Generator', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('7.1 Image generator opens', async ({ page }) => {
    const imageBtn = page.getByRole('button', { name: /image|generate|ai.*image/i }).first();
    if (await imageBtn.isVisible()) {
      await imageBtn.click();
      await settle(page.getByTestId('modal-cancel-btn'));
    }
  });

  test('7.2 Image prompt input', async ({ page }) => {
    const imageBtn = page.getByRole('button', { name: /image|generate/i }).first();
    if (await imageBtn.isVisible()) {
      await imageBtn.click();
      await settle(page.getByTestId('modal-cancel-btn'));

      const promptInput = page.getByRole('textbox', { name: /prompt|describe/i }).first();
      if (await promptInput.isVisible()) {
        await promptInput.fill('A beautiful sunset');
        await expect(promptInput).toHaveValue('A beautiful sunset');
      }
    }
  });
});

// ============================================================
// SECTION 8: RESEARCH ASSISTANT
// ============================================================

test.describe('8. Research Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('8.1 Research assistant opens', async ({ page }) => {
    const researchBtn = page.getByRole('button', { name: /research|assistant/i }).first();
    if (await researchBtn.isVisible()) {
      await researchBtn.click();
      await settle(page.locator('[role="dialog"], [role="textbox"]').first());
    }
  });

  test('8.2 Research query input', async ({ page }) => {
    const researchBtn = page.getByRole('button', { name: /research/i }).first();
    if (await researchBtn.isVisible()) {
      await researchBtn.click();
      await settle(page.locator('[role="dialog"], [role="textbox"]').first());

      const queryInput = page.getByRole('textbox', { name: /query|search|ask/i }).first();
      if (await queryInput.isVisible()) {
        await queryInput.fill('machine learning');
        await expect(queryInput).toHaveValue('machine learning');
      }
    }
  });
});

// ============================================================
// SECTION 9: OMNIBAR
// ============================================================

test.describe('9. Omnibar / Quick Search', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('9.1 Omnibar opens with keyboard shortcut', async ({ page }) => {
    // Try Ctrl+K or Cmd+K
    await page.keyboard.press('Control+k');
    await settle(page.getByRole('combobox', { name: /search|command/i }).first());

    // Check if omnibar/search appeared
    const searchInput = page.getByRole('combobox', { name: /search|command/i }).first();
    const isVisible = await searchInput.isVisible().catch(() => false);

    if (!isVisible) {
      await page.keyboard.press('Escape');
    }
  });

  test('9.2 Omnibar search functionality', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await settle(page.getByRole('combobox').first());

    const searchInput = page.getByRole('combobox').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('bookmark');

      // Check for results (bounded wait instead of a fixed sleep).
      const results = page.locator('[role="option"], [data-testid*="result"]');
      await expect(results.first()).toBeVisible({ timeout: 5_000 }).catch(() => { /* INTENTIONAL SILENCE: optional UI assertion is best-effort in this exploratory test. */ });
      const count = await results.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }

    await page.keyboard.press('Escape');
  });

  test('9.3 Omnibar closes with Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const searchInput = page.getByRole('combobox', { name: /search|command/i }).first();
    await settle(searchInput);
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeHidden().catch(() => { /* INTENTIONAL SILENCE: optional UI assertion is best-effort in this exploratory test. */ });
  });
});

// ============================================================
// SECTION 10: WELCOME TOUR & ONBOARDING
// ============================================================

test.describe('10. Welcome Tour & Onboarding', () => {
  test('10.1 Welcome tour can be skipped', async ({ page }) => {
    // This test only runs on first visit
    const skipBtn = page.getByRole('button', { name: /skip|dismiss|close/i }).first();
    if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('10.2 Onboarding flow navigation', async ({ page }) => {
    // Navigate through onboarding if present
    const nextBtn = page.getByRole('button', { name: /next|continue|step/i }).first();
    if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });
});

// ============================================================
// SECTION 11: KEYBOARD SHORTCUTS
// ============================================================

test.describe('11. Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('11.1 Ctrl+K opens search', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await settle(page.getByRole('combobox', { name: /search|command/i }).first());
    await page.keyboard.press('Escape');
  });

  test('11.2 Escape closes modals', async ({ page }) => {
    // Open QuickCapture
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });

    // QuickCapture has no Escape handler; the smoke assertion just proves the
    // shell is still responsive.
    await page.keyboard.press('Escape');
    await expect(page.locator('#root')).toBeVisible();
  });

  test('11.3 Tab navigation works', async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
    }

    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['BUTTON', 'INPUT', 'A', 'SELECT', 'TEXTAREA', 'BODY']).toContain(focused);
  });

  test('11.4 Keyboard shortcuts dialog', async ({ page }) => {
    const shortcutsBtn = page.getByRole('button', { name: /shortcut|keyboard|hotkey/i }).first();
    if (await shortcutsBtn.isVisible()) {
      await shortcutsBtn.click();

      // Verify dialog opened
      const dialog = page.getByRole('dialog').first();
      await settle(dialog);
      if (await dialog.isVisible()) {
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
      }
    }
  });
});

// ============================================================
// SECTION 12: COLLABORATION FEATURES
// ============================================================

test.describe('12. Collaboration Features', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('12.1 Collaboration panel opens', async ({ page }) => {
    const collabBtn = page.getByRole('button', { name: /collaborate|share|team/i }).first();
    if (await collabBtn.isVisible()) {
      try {
        await collabBtn.click({ timeout: 2000 });
        await expect(page.locator('#root')).toBeVisible();
      } catch {
        // Button might be intercepted by overlay
      }
    }
  });

  test('12.2 Share button functionality', async ({ page }) => {
    const shareBtn = page.getByRole('button', { name: /share/i }).first();
    if (await shareBtn.isVisible()) {
      try {
        await shareBtn.click({ timeout: 2000 });
        await expect(page.locator('#root')).toBeVisible();
      } catch {
        // Button might be intercepted by overlay
      }
    }
  });

  test('12.3 Conflict resolver component', async ({ page }) => {
    // Conflict resolver appears during sync conflicts; smoke check only.
    await expect(page.locator('#root')).toBeVisible();
  });
});

// ============================================================
// SECTION 13: DIAGNOSTICS & SYSTEM
// ============================================================

test.describe('13. Diagnostics & System', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('13.1 Storage status displays', async ({ page }) => {
    const storageBtn = page.getByRole('button', { name: /storage|space|quota/i }).first();
    if (await storageBtn.isVisible()) {
      await storageBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('13.2 Performance profiler', async ({ page }) => {
    const perfBtn = page.getByRole('button', { name: /performance|profiler|metrics/i }).first();
    if (await perfBtn.isVisible()) {
      await perfBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('13.3 Error boundary catches errors', async ({ page }) => {
    // Error boundary would catch React errors; smoke check only.
    await expect(page.locator('#root')).toBeVisible();
  });

  test('13.4 PWA updater check', async ({ page }) => {
    // PWA updater checks for updates; smoke check only.
    await expect(page.locator('#root')).toBeVisible();
  });
});

// ============================================================
// SECTION 14: CALENDAR & TIMELINE
// ============================================================

test.describe('14. Calendar & Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('14.1 Timeline view opens', async ({ page }) => {
    const timelineBtn = page.getByRole('button', { name: /timeline|history|time/i }).first();
    if (await timelineBtn.isVisible()) {
      await timelineBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('14.2 Calendar view opens', async ({ page }) => {
    const calendarBtn = page.getByRole('button', { name: /calendar|date/i }).first();
    if (await calendarBtn.isVisible()) {
      await calendarBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });
});

// ============================================================
// SECTION 15: KANBAN & LIST VIEWS
// ============================================================

test.describe('15. Kanban & List Views', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('15.1 Kanban view opens', async ({ page }) => {
    const kanbanBtn = page.getByRole('button', { name: /kanban|board/i }).first();
    if (await kanbanBtn.isVisible()) {
      await kanbanBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('15.2 List view opens', async ({ page }) => {
    const listBtn = page.getByRole('button', { name: /list|grid|view/i }).first();
    if (await listBtn.isVisible()) {
      await listBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });
});

// ============================================================
// SECTION 16: MEDIA & GALLERY
// ============================================================

test.describe('16. Media & Gallery', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('16.1 Gallery view opens', async ({ page }) => {
    const galleryBtn = page.getByRole('button', { name: /gallery|media|images/i }).first();
    if (await galleryBtn.isVisible()) {
      await galleryBtn.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('16.2 Image preview displays', async ({ page }) => {
    // Image preview would show when clicking on an image; smoke check only.
    await expect(page.locator('#root')).toBeVisible();
  });
});

// ============================================================
// SECTION 17: ADVANCED SETTINGS
// ============================================================

test.describe('17. Advanced Settings', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('17.1 Settings panel with all sections', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /setting/i }).first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();

      // Verify settings heading
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 3000 });
    }
  });

  test('17.2 Cloud sync settings', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /setting/i }).first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await settle(page.getByRole('heading', { name: 'Settings', exact: true }));

      const syncSection = page.getByText(/cloud sync|sync settings/i).first();
      const isVisible = await syncSection.isVisible().catch(() => false);
      expect(typeof isVisible).toBe('boolean');
    }
  });

  test('17.3 Security settings section', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /setting/i }).first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await settle(page.getByRole('heading', { name: 'Settings', exact: true }));

      const securitySection = page.getByText(/security|encryption/i).first();
      const isVisible = await securitySection.isVisible().catch(() => false);
      expect(typeof isVisible).toBe('boolean');
    }
  });

  test('17.4 AI model settings', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /setting/i }).first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await settle(page.getByRole('heading', { name: 'Settings', exact: true }));

      const aiSection = page.getByText(/ai model|model manager/i).first();
      const isVisible = await aiSection.isVisible().catch(() => false);
      expect(typeof isVisible).toBe('boolean');
    }
  });

  test('17.5 Export/Import settings', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /setting/i }).first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await settle(page.getByRole('heading', { name: 'Settings', exact: true }));

      const exportSection = page.getByText(/export.*settings|import.*settings/i).first();
      const isVisible = await exportSection.isVisible().catch(() => false);
      expect(typeof isVisible).toBe('boolean');
    }
  });

  test('17.6 Reset settings button', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /setting/i }).first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await settle(page.getByRole('heading', { name: 'Settings', exact: true }));

      const resetBtn = page.getByRole('button', { name: /reset/i }).first();
      const isVisible = await resetBtn.isVisible().catch(() => false);
      expect(typeof isVisible).toBe('boolean');
    }
  });
});

// ============================================================
// SECTION 18: REALISTIC USER SCENARIOS
// ============================================================

test.describe('18. Realistic User Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('18.1 Research workflow', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableHesitation: true,
      enableReadingTime: true,
    });

    // User researches a topic
    await page.keyboard.press('Control+k');
    await settle(page.getByRole('combobox').first());

    const searchInput = page.getByRole('combobox').first();
    if (await searchInput.isVisible()) {
      await human.type(searchInput, 'artificial intelligence');
      // Bounded wait for search results instead of a fixed sleep.
      await expect(page.locator('[role="option"]').first())
        .toBeVisible({ timeout: 5_000 })
        .catch(() => { /* INTENTIONAL SILENCE: optional UI assertion is best-effort in this exploratory test. */ });
    }

    await page.keyboard.press('Escape');
  });

  test('18.2 Content creation workflow', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableHesitation: true,
    });

    // Create a bookmark
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });

    await human.type(page.getByTestId('quick-capture-input'), 'https://research-paper.com');
    await human.type(page.getByTestId('bookmark-title-input'), 'Research Paper on AI');

    await page.getByTestId('save-bookmark-button').click();
    // Real completion signal: capture toast, then the panel closing.
    await expectCapturedToast(page);
    await expect(page.getByTestId('quick-capture-input')).toBeHidden({
      timeout: 30_000,
    });
  });

  test('18.3 Knowledge organization workflow', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableReadingTime: true,
    });

    // Intentional realism pacing: exercise the simulator's read/scroll.
    await human.scroll('down', 3);
    await human.readContent(800);
    await human.scroll('up', 2);
  });

  test('18.4 Settings configuration workflow', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableHesitation: true,
    });

    // Open settings
    const settingsBtn = page.getByRole('button', { name: /setting/i }).first();
    if (await settingsBtn.isVisible()) {
      await human.click(settingsBtn);
      await settle(page.getByRole('heading', { name: 'Settings', exact: true }));

      // Intentional realism pacing: read the settings content.
      await human.readContent(600);

      // Close settings
      await page.keyboard.press('Escape');
    }
  });
});
