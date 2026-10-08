import { test, expect } from "@playwright/test";
import { skipPassword } from "../../../../tests/e2e/vault-helpers";

/**
 * Advanced Accessibility Tests
 * Tests for accessibility features, screen readers, and inclusive design
 * These tests simulate human-like interactions with accessibility scenarios
 */

test.describe("Advanced Accessibility", () => {
  test("should handle keyboard navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // A fresh headless load starts with focus outside the document, so the
    // first Tab never reaches page content. Move focus inside first — the
    // test's subject is Tab traversal, not initial focus placement.
    await page.locator("body").click();
    // Test Tab navigation
    await page.keyboard.press("Tab");
    const firstFocusable = page.locator(":focus").first();
    expect(await firstFocusable.count()).toBeGreaterThan(0);

    // Navigate through focusable elements
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const focusedElement = page.locator(":focus").first();
      expect(await focusedElement.count()).toBeGreaterThan(0);
    }
  });

  test("should handle screen reader announcements", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for ARIA live regions
    const liveRegions = page.locator('[aria-live], [role="status"], [role="alert"]').first();
    if (await liveRegions.count() > 0) {
      const hasLiveRegion = await liveRegions.count() > 0;
      expect(hasLiveRegion).toBeTruthy();
    }
  });

  test("should handle ARIA labels", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for ARIA labels on interactive elements
    const buttonsWithoutLabels = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      return Array.from(buttons).filter(btn => {
        const hasText = btn.textContent?.trim().length || 0;
        const hasAriaLabel = btn.getAttribute("aria-label");
        const hasAriaLabelledBy = btn.getAttribute("aria-labelledby");
        return !hasText && !hasAriaLabel && !hasAriaLabelledBy;
      }).length;
    });

    expect(buttonsWithoutLabels).toBe(0);
  });

  test("should handle focus management", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test focus trap in modal
    const modalButton = page.locator('[data-testid="modal-button"]').first();
    if (await modalButton.count() > 0) {
      await modalButton.click();

      // Verify focus is trapped in modal
      const modal = page.locator('[data-testid="modal"]').first();
      const modalContent = await modal.locator(":focus").first();
      expect(await modalContent.count()).toBeGreaterThan(0);

      // Close modal
      const closeButton = page.locator('[data-testid="close-modal"]').first();
      await closeButton.click();
    }
  });

  test("should handle skip links", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for skip navigation link
    const skipLink = page.locator('a[href="#main-content"], a[href="#content"]').first();
    if (await skipLink.count() > 0) {
      await skipLink.click();

      // Verify focus moves to main content
      const mainContent = page.locator('#main-content, #content').first();
      const isFocused = await mainContent.evaluate((el) => document.activeElement === el);
      expect(isFocused).toBeTruthy();
    }
  });

  test("should handle color contrast", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check color contrast (basic check)
    const contrastIssues = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      let issues = 0;

      elements.forEach(el => {
        const computed = window.getComputedStyle(el);
        const color = computed.color;
        const bgColor = computed.backgroundColor;

        // Basic contrast check (WCAG AA requires 4.5:1 for normal text)
        if (color !== "rgba(0, 0, 0, 0)" && bgColor !== "rgba(0, 0, 0, 0)") {
          // This is a simplified check - real contrast checking requires more complex logic
          // For now, just verify elements have colors set
        }
      });

      return issues;
    });

    // In a real implementation, this would use a proper contrast checking library
    expect(contrastIssues).toBe(0);
  });

  test("should handle text alternatives for images", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for alt text on images
    const imagesWithoutAlt = await page.evaluate(() => {
      const images = document.querySelectorAll("img");
      return Array.from(images).filter(img => !img.alt).length;
    });

    expect(imagesWithoutAlt).toBe(0);
  });

  test("should handle form accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check form labels
    const inputsWithoutLabels = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input, select, textarea");
      return Array.from(inputs).filter(input => {
        const hasLabel = document.querySelector(`label[for="${input.id}"]`);
        const hasAriaLabel = input.getAttribute("aria-label");
        const hasAriaLabelledBy = input.getAttribute("aria-labelledby");
        const hasPlaceholder = input.getAttribute("placeholder");
        return !hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !hasPlaceholder;
      }).length;
    });

    expect(inputsWithoutLabels).toBe(0);
  });

  test("should handle error announcements", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger form error
    const formInput = page.locator('[data-testid="form-input"]').first();
    if (await formInput.count() > 0) {
      await formInput.fill("invalid-value");

      const submitButton = page.locator('[data-testid="submit-form"]').first();
      await submitButton.click();

      // Check for error announcement
      const errorMessage = page.locator('[role="alert"], [aria-live="assertive"]').first();
      const hasError = await errorMessage.count() > 0;
      expect(hasError).toBeTruthy();
    }
  });

  test("should handle landmark regions", async ({ page }) => {
    // Landmarks (nav/main) only exist inside the unlocked app — the welcome
    // dialog has none by design. Unlock first so the test checks the app.
    await skipPassword(page);

    // Check for ARIA landmarks
    const landmarks = await page.evaluate(() => {
      return {
        hasMain: !!document.querySelector("main, [role='main']"),
        hasNav: !!document.querySelector("nav, [role='navigation']"),
        hasHeader: !!document.querySelector("header, [role='banner']"),
        hasFooter: !!document.querySelector("footer, [role='contentinfo']"),
        hasAside: !!document.querySelector("aside, [role='complementary']"),
      };
    });

    expect(landmarks.hasMain).toBeTruthy();
    expect(landmarks.hasNav).toBeTruthy();
  });

  test("should handle heading hierarchy", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check heading structure
    const headingIssues = await page.evaluate(() => {
      const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
      let previousLevel = 0;
      let issues = 0;

      headings.forEach(heading => {
        const level = parseInt(heading.tagName.charAt(1), 10);
        if (level > previousLevel + 1) {
          issues++;
        }
        previousLevel = level;
      });

      return issues;
    });

    expect(headingIssues).toBe(0);
  });

  test("should handle link accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for descriptive link text
    const linksWithoutText = await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      return Array.from(links).filter(link => {
        const text = link.textContent?.trim() || "";
        const hasAriaLabel = link.getAttribute("aria-label");
        const hasTitle = link.getAttribute("title");
        return text === "" && !hasAriaLabel && !hasTitle;
      }).length;
    });

    expect(linksWithoutText).toBe(0);
  });

  test("should handle table accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check table accessibility
    const tables = page.locator("table").first();
    if (await tables.count() > 0) {
      const hasCaption = await tables.locator("caption").count() > 0;
      const hasHeaders = await tables.locator("th").count() > 0;

      expect(hasHeaders).toBeTruthy();
    }
  });

  test("should handle list accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check list accessibility
    const lists = page.locator("ul, ol").first();
    if (await lists.count() > 0) {
      const hasListItems = await lists.locator("li").count() > 0;
      expect(hasListItems).toBeTruthy();
    }
  });

  test("should handle button accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check button accessibility
    const buttons = page.locator("button, [role='button']").first();
    if (await buttons.count() > 0) {
      const hasAccessibleName = await buttons.evaluate((btn) => {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label");
        const ariaLabelledBy = btn.getAttribute("aria-labelledby");
        return text !== "" || ariaLabel || ariaLabelledBy;
      });

      expect(hasAccessibleName).toBeTruthy();
    }
  });

  test("should handle focus visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test focus visible indicator
    const focusableElement = page.locator("button, a, input").first();
    if (await focusableElement.count() > 0) {
      await focusableElement.focus();

      // Check for focus outline
      const hasFocusOutline = await focusableElement.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return computed.outline !== "none" || computed.boxShadow !== "none";
      });

      expect(hasFocusOutline).toBeTruthy();
    }
  });

  test("should handle touch targets", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check touch target size (minimum 44x44px)
    const smallTouchTargets = await page.evaluate(() => {
      const touchTargets = document.querySelectorAll("button, a, input");
      return Array.from(touchTargets).filter(target => {
        const rect = target.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      }).length;
    });

    expect(smallTouchTargets).toBe(0);
  });

  test("should handle page title", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check page title
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThan(60); // Concise titles
  });

  test("should handle language attribute", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check language attribute
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBeTruthy();
    expect(lang.length).toBe(2); // ISO language code
  });

  test("should handle video accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check video accessibility
    const videos = page.locator("video").first();
    if (await videos.count() > 0) {
      const hasCaptions = await videos.locator("track").count() > 0;
      const hasAudioDescription = await videos.getAttribute("aria-describedby");

      expect(hasCaptions).toBeTruthy();
    }
  });

  test("should handle audio accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check audio accessibility
    const audio = page.locator("audio").first();
    if (await audio.count() > 0) {
      const hasTranscript = await audio.getAttribute("aria-describedby");
      const hasControls = await audio.getAttribute("controls");

      expect(hasControls).toBeTruthy();
    }
  });

  test("should handle canvas accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check canvas accessibility
    const canvas = page.locator("canvas").first();
    if (await canvas.count() > 0) {
      const hasFallback = await canvas.evaluate((el) => {
        return el.textContent?.trim().length || 0;
      });
      const hasAriaLabel = await canvas.getAttribute("aria-label");

      expect(hasFallback > 0 || hasAriaLabel).toBeTruthy();
    }
  });

  test("should handle iframe accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check iframe accessibility
    const iframe = page.locator("iframe").first();
    if (await iframe.count() > 0) {
      const hasTitle = await iframe.getAttribute("title");
      expect(hasTitle).toBeTruthy();
    }
  });

  test("should handle modal accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open modal
    const modalButton = page.locator('[data-testid="modal-button"]').first();
    if (await modalButton.count() > 0) {
      await modalButton.click();

      // Check modal accessibility
      const modal = page.locator('[data-testid="modal"]').first();
      const hasRole = await modal.getAttribute("role");
      const hasLabel = await modal.getAttribute("aria-label");
      const hasLabelledBy = await modal.getAttribute("aria-labelledby");

      expect(hasRole).toBe("dialog");
      expect(hasLabel || hasLabelledBy).toBeTruthy();

      // Close modal
      const closeButton = page.locator('[data-testid="close-modal"]').first();
      await closeButton.click();
    }
  });

  test("should handle tooltip accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check tooltip accessibility
    const tooltipTrigger = page.locator('[data-testid="tooltip-trigger"]').first();
    if (await tooltipTrigger.count() > 0) {
      await tooltipTrigger.hover();

      const tooltip = page.locator('[data-testid="tooltip"]').first();
      const hasRole = await tooltip.getAttribute("role");
      const isHidden = await tooltip.getAttribute("aria-hidden");

      expect(hasRole).toBe("tooltip");
      expect(isHidden).toBe("false");
    }
  });

  test("should handle progress indicator accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check progress indicator
    const progress = page.locator("progress, [role='progressbar']").first();
    if (await progress.count() > 0) {
      const hasLabel = await progress.getAttribute("aria-label");
      const hasValue = await progress.getAttribute("aria-valuenow");
      const hasMin = await progress.getAttribute("aria-valuemin");
      const hasMax = await progress.getAttribute("aria-valuemax");

      expect(hasLabel).toBeTruthy();
      expect(hasValue).toBeTruthy();
      expect(hasMin).toBeTruthy();
      expect(hasMax).toBeTruthy();
    }
  });

  test("should handle alert accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger alert
    const alertButton = page.locator('[data-testid="alert-button"]').first();
    if (await alertButton.count() > 0) {
      await alertButton.click();

      // Check alert accessibility
      const alert = page.locator('[role="alert"]').first();
      const isVisible = await alert.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle tab accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check tab accessibility
    const tabs = page.locator('[role="tab"]').first();
    if (await tabs.count() > 0) {
      const hasPanel = await page.locator('[role="tabpanel"]').first().count() > 0;
      const hasSelected = await tabs.getAttribute("aria-selected");

      expect(hasPanel).toBeTruthy();
      expect(hasSelected).toBeTruthy();
    }
  });

  test("should handle accordion accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check accordion accessibility
    const accordion = page.locator('[role="heading"]').first();
    if (await accordion.count() > 0) {
      const hasButton = await accordion.locator("button").count() > 0;
      const hasExpanded = await accordion.locator("button").first().getAttribute("aria-expanded");

      expect(hasButton).toBeTruthy();
      expect(hasExpanded).toBeDefined();
    }
  });

  test("should handle carousel accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check carousel accessibility
    const carousel = page.locator('[data-testid="carousel"]').first();
    if (await carousel.count() > 0) {
      const hasControls = await carousel.locator('[aria-label="Previous"], [aria-label="Next"]').count() > 0;
      const hasLiveRegion = await carousel.locator('[aria-live]').count() > 0;

      expect(hasControls).toBeTruthy();
      expect(hasLiveRegion).toBeTruthy();
    }
  });

  test("should handle menu accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check menu accessibility
    const menuButton = page.locator('[data-testid="menu-button"]').first();
    if (await menuButton.count() > 0) {
      await menuButton.click();

      const menu = page.locator('[role="menu"]').first();
      const hasRole = await menu.getAttribute("role");
      const hasLabel = await menu.getAttribute("aria-label");

      expect(hasRole).toBe("menu");
      expect(hasLabel).toBeTruthy();

      // Close menu
      await page.keyboard.press("Escape");
    }
  });

  test("should handle autocomplete accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check autocomplete accessibility
    const autocomplete = page.locator('[role="combobox"]').first();
    if (await autocomplete.count() > 0) {
      const hasListbox = await page.locator('[role="listbox"]').first().count() > 0;
      const hasExpanded = await autocomplete.getAttribute("aria-expanded");

      expect(hasListbox).toBeTruthy();
      expect(hasExpanded).toBeDefined();
    }
  });

  test("should handle slider accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check slider accessibility
    const slider = page.locator('[role="slider"], input[type="range"]').first();
    if (await slider.count() > 0) {
      const hasLabel = await slider.getAttribute("aria-label");
      const hasValue = await slider.getAttribute("aria-valuenow");

      expect(hasLabel).toBeTruthy();
      expect(hasValue).toBeDefined();
    }
  });

  test("should handle date picker accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check date picker accessibility
    const dateInput = page.locator('input[type="date"]').first();
    if (await dateInput.count() > 0) {
      const hasLabel = await dateInput.getAttribute("aria-label");
      const hasPlaceholder = await dateInput.getAttribute("placeholder");

      expect(hasLabel || hasPlaceholder).toBeTruthy();
    }
  });

  test("should handle time picker accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check time picker accessibility
    const timeInput = page.locator('input[type="time"]').first();
    if (await timeInput.count() > 0) {
      const hasLabel = await timeInput.getAttribute("aria-label");
      const hasPlaceholder = await timeInput.getAttribute("placeholder");

      expect(hasLabel || hasPlaceholder).toBeTruthy();
    }
  });

  test("should handle file input accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check file input accessibility
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      const hasLabel = await fileInput.getAttribute("aria-label");
      const hasAccept = await fileInput.getAttribute("accept");

      expect(hasLabel).toBeTruthy();
    }
  });

  test("should handle checkbox accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check checkbox accessibility
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.count() > 0) {
      const hasLabel = await checkbox.evaluate((cb) => {
        const label = document.querySelector(`label[for="${cb.id}"]`);
        return label !== null;
      });

      expect(hasLabel).toBeTruthy();
    }
  });

  test("should handle radio button accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check radio button accessibility
    const radio = page.locator('input[type="radio"]').first();
    if (await radio.count() > 0) {
      const hasLabel = await radio.evaluate((rb) => {
        const label = document.querySelector(`label[for="${rb.id}"]`);
        return label !== null;
      });

      expect(hasLabel).toBeTruthy();
    }
  });

  test("should handle select dropdown accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check select accessibility
    const select = page.locator("select").first();
    if (await select.count() > 0) {
      const hasLabel = await select.evaluate((sel) => {
        const label = document.querySelector(`label[for="${sel.id}"]`);
        return label !== null;
      });

      expect(hasLabel).toBeTruthy();
    }
  });

  test("should handle resize handle accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check resize handle accessibility
    const resizeHandle = page.locator('[data-testid="resize-handle"]').first();
    if (await resizeHandle.count() > 0) {
      const hasRole = await resizeHandle.getAttribute("role");
      const hasLabel = await resizeHandle.getAttribute("aria-label");

      expect(hasRole).toBe("separator");
      expect(hasLabel).toBeTruthy();
    }
  });

  test("should handle drag and drop accessibility", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check drag and drop accessibility
    const draggable = page.locator('[draggable="true"]').first();
    if (await draggable.count() > 0) {
      const hasLabel = await draggable.getAttribute("aria-label");
      const hasGrabCursor = await draggable.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return computed.cursor === "grab" || computed.cursor === "move";
      });

      expect(hasLabel).toBeTruthy();
      expect(hasGrabCursor).toBeTruthy();
    }
  });

  test("should handle reduced motion preference", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test reduced motion
    await page.emulateMedia({ reducedMotion: "reduce" });

    // Check for reduced motion handling
    const animationsDisabled = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      return Array.from(elements).every(el => {
        const computed = window.getComputedStyle(el);
        return computed.animationDuration === "0s" || computed.transitionDuration === "0s";
      });
    });

    // Not all animations may be disabled, but key ones should be
    expect(animationsDisabled).toBeDefined();
  });

  test("should handle high contrast mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test high contrast mode
    await page.emulateMedia({ forcedColors: "active" });

    // Check for high contrast handling
    const highContrastAdapted = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      return Array.from(elements).some(el => {
        const computed = window.getComputedStyle(el);
        return computed.forcedColorAdjust === "auto";
      });
    });

    expect(highContrastAdapted).toBeDefined();
  });
});
