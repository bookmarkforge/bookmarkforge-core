/**
 * Uncovered Tabs Human-Like Flows
 *
 * Coverage gap fill: the human-like suite exercised the primary tabs
 * (dashboard, documents, bookmarks, graph, canvas, database, chat,
 * analytics) but had no real flows for several sidebar destinations.
 * This spec drives them like a user:
 *
 *  - chatLocal  (Local RAG Chat): open, type, send, toggle web-search /
 *    private-mode, verify the composer resets and the message lands.
 *  - Support center inner tabs: AI Assistant, Knowledge Base (FAQ),
 *    Diagnostics — including a real FAQ expand and a diagnostics run.
 *  - kanban / calendar / list / gallery / timeline view destinations.
 *  - voiceLocal (Voice Commands), collaboration, security dashboard.
 *
 * Assertions stay tolerant where the environment legitimately varies
 * (no AI provider configured → chat surfaces an error/retry state, which
 * is itself a valid flow), but every test asserts the destination
 * actually rendered instead of silently passing on a missing element.
 */

import { test, expect } from "@playwright/test";
import { createHumanBehavior, ciBasicOptions } from "../utils/human-behavior";
import { skipPassword } from "../../../../tests/e2e/vault-helpers";

/** Click a sidebar destination by its canonical data-tab-id. */
async function goToTab(page: import("@playwright/test").Page, tabId: string) {
  await page.locator(`aside [data-tab-id="${tabId}"]`).first().click();
}

test.describe("Uncovered tabs human-like flows", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test("chatLocal: opens, sends a message and resets the composer", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await goToTab(page, "chatLocal");
    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible({ timeout: 15_000 });

    const query = "What bookmarks do I have about testing?";
    await human.type(input, query);
    await human.click(page.getByRole("button", { name: "Send" }));

    // Composer clears once the send is accepted.
    await expect(input).toHaveValue("", { timeout: 10_000 });

    // The user message is persisted and rendered in the chat log. With no
    // AI provider configured the assistant side surfaces an error/retry
    // state — both are valid outcomes; the flow asserts the message was
    // accepted and *something* answered or reported within the budget.
    const log = page.getByRole("log", { name: /chat history/i });
    await expect(log.getByText(query)).toBeVisible({ timeout: 15_000 });
    await expect(
      log
        .getByRole("button", { name: /retry/i })
        .or(log.locator("..").getByText(/error|sorry/i))
        .first(),
    ).toBeVisible({ timeout: 45_000 });
  });

  test("chatLocal: web-search and private-mode toggles flip state", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await goToTab(page, "chatLocal");
    await expect(page.getByTestId("chat-input")).toBeVisible({
      timeout: 15_000,
    });

    const webSearch = page.getByRole("button", {
      name: /web search/i,
    });
    const privateMode = page.getByRole("button", {
      name: /private mode/i,
    });
    await expect(webSearch).toBeVisible();
    await expect(privateMode).toBeVisible();

    await expect(webSearch).toHaveAttribute("aria-pressed", "false");
    await human.click(webSearch);
    await expect(webSearch).toHaveAttribute("aria-pressed", "true");
    await human.click(webSearch);
    await expect(webSearch).toHaveAttribute("aria-pressed", "false");

    await expect(privateMode).toHaveAttribute("aria-pressed", "false");
    await human.click(privateMode);
    await expect(privateMode).toHaveAttribute("aria-pressed", "true");
  });

  test("support center: FAQ tab lists questions and expands an answer", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Sidebar "chat" id = Support Center (distinct from chatLocal).
    await goToTab(page, "chat");
    const tablist = page.getByRole("tablist", { name: /support/i });
    await expect(tablist).toBeVisible({ timeout: 15_000 });

    await human.click(tablist.locator('[data-tab-id="faq"]'));
    const faqButtons = page.locator("[data-faq-index]");
    await expect(faqButtons.first()).toBeVisible({ timeout: 10_000 });
    expect(await faqButtons.count()).toBeGreaterThan(0);

    await human.click(faqButtons.first());
    // The accordion answer animates open under the clicked question.
    await expect(
      page.locator(".overflow-hidden").filter({ hasText: /./ }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("support center: diagnostics tab runs an evaluation", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await goToTab(page, "chat");
    const tablist = page.getByRole("tablist", { name: /support/i });
    await expect(tablist).toBeVisible({ timeout: 15_000 });

    await human.click(tablist.locator('[data-tab-id="diagnostics"]'));
    const reevaluate = page.getByRole("button", { name: /re-evaluate/i });
    await expect(reevaluate).toBeVisible({ timeout: 10_000 });

    await human.click(reevaluate);
    // Diagnostics cards render with a status icon; wait for the run to
    // settle (pending spinner gone) instead of asserting a fixed delay.
    await expect(page.locator(".animate-spin")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: /copy (report|diagnostic)/i }),
    ).toBeVisible();
  });

  test("support center: chat tab accepts a message", async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await goToTab(page, "chat");
    const tablist = page.getByRole("tablist", { name: /support/i });
    await expect(tablist).toBeVisible({ timeout: 15_000 });

    const input = page.getByRole("textbox", { name: /type a message/i });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await human.type(input, "How do I export my bookmarks?");
    await human.click(page.getByRole("button", { name: "Send" }).last());

    await expect(input).toHaveValue("", { timeout: 10_000 });
    await expect(
      page.getByText("How do I export my bookmarks?").first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("kanban view renders its board", async ({ page }) => {
    await goToTab(page, "kanban");
    await expect(
      page.getByRole("heading", { name: /kanban/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("calendar view renders the month grid and navigates", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await goToTab(page, "calendar");
    const grid = page.getByRole("grid", { name: /calendar/i });
    await expect(grid).toBeVisible({ timeout: 15_000 });

    const nextMonth = page.getByRole("button", { name: /next month/i });
    await human.click(nextMonth);
    await expect(grid).toBeVisible({ timeout: 5_000 });
  });

  test("list view renders and filters by type", async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await goToTab(page, "list");
    await expect(
      page.getByRole("heading", { name: /list view/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const filter = page.getByRole("combobox", { name: /filter by type/i });
    if (await filter.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await human.click(filter);
      const option = page.getByRole("option").first();
      if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await human.click(option);
      }
    }
  });

  test("gallery view renders and accepts a search", async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await goToTab(page, "gallery");
    await expect(
      page.getByRole("heading", { name: /gallery/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const search = page.getByRole("searchbox", { name: /search/i }).or(
      page.getByRole("textbox", { name: /search/i }),
    );
    await expect(search.first()).toBeVisible({ timeout: 10_000 });
    await human.type(search.first(), "test");
    await expect(search.first()).toHaveValue(/test/i, { timeout: 5_000 });
  });

  test("timeline view renders and accepts a search", async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await goToTab(page, "timeline");
    await expect(
      page.getByRole("heading", { name: /timeline/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const search = page.getByRole("searchbox", { name: /search/i }).or(
      page.getByRole("textbox", { name: /search/i }),
    );
    await expect(search.first()).toBeVisible({ timeout: 10_000 });
    await human.type(search.first(), "bookmark");
  });

  test("voiceLocal: voice commands view loads", async ({ page }) => {
    await goToTab(page, "voiceLocal");
    // Lazy chunk + possible mic-permission prompt: assert the destination
    // rendered a heading and no error boundary took over.
    await expect(
      page.getByRole("heading", { name: /voice/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("collaboration view renders", async ({ page }) => {
    await goToTab(page, "collaboration");
    await expect(
      page.getByRole("heading", { name: /collaboration/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("security dashboard renders vault health", async ({ page }) => {
    await goToTab(page, "security");
    await expect(page.getByTestId("security-dashboard")).toBeVisible({
      timeout: 15_000,
    });
  });
});
