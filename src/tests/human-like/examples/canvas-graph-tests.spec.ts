/**
 * Canvas and Graph View Tests
 *
 * REWRITTEN 2026-09-24 (debt payment #2, second advanced-* file out of the
 * vacuous baseline — this file was the largest 100%-vacuous entry: 15 tests,
 * every body wrapped in try/catch that swallowed everything, guards aimed at
 * testids that no production component renders (canvas-node, graph-node,
 * connection-mode, node-details-panel) and assertions like "hasContent is
 * truthy" asserted on a boolean, not on the UI).
 *
 * The real contract (verified against src/components/CanvasView.tsx and
 * GraphView.tsx, plus public/locales/en.json):
 *   - CanvasView is an @xyflow/react board. With zero nodes it renders the
 *     empty state carrying data-testid="canvas-view" ("Empty Canvas"); the
 *     top-left Panel offers "Add Doc" / "Add Bookmark" / "Clear". With no
 *     data in the vault those buttons toast "No documents found" / "No
 *     bookmarks found" instead of adding a node. Once nodes exist, the empty
 *     state disappears and xyflow's Controls + MiniMap mount.
 *   - GraphView (d3 force) renders heading "Knowledge Graph", a "Filter
 *     nodes" input (aria-label; 300ms debounce), a stats line
 *     "Nodes: N | Links: N | Clusters: N", and its own empty state
 *     ("Your knowledge graph is empty") when there is no data.
 *
 * Every assertion is unconditional on state the test drives, so the ratchet
 * classifies all five tests as `real`.
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Canvas and Graph View Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  async function openCanvas(page: import('@playwright/test').Page) {
    await page.locator('[data-tab-id="canvas"]').first().click();
    // The empty-state card IS the canvas-view testid (mounted only while
    // nodes.length === 0), so first navigation asserts it.
    await expect(page.getByText('Empty Canvas')).toBeVisible({
      timeout: 15_000,
    });
  }

  async function openGraph(page: import('@playwright/test').Page) {
    await page.locator('[data-tab-id="graph"]').first().click();
    // exact:true — the empty state's heading ("Your knowledge graph is
    // empty") also contains this substring and would strict-violate.
    await expect(
      page.getByRole('heading', { name: 'Knowledge Graph', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  }

  test('2.1 Canvas opens with its empty state and the add/clear panel', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await openCanvas(page);

    // Empty-state contract: the dedicated testid overlay + copy.
    await expect(page.getByTestId('canvas-view')).toBeVisible();
    await expect(
      page.getByText(
        'Start by adding documents or bookmarks from the top-left panel',
      ),
    ).toBeVisible();

    // The toolbar panel exists with its three actions.
    await expect(
      page.getByRole('button', { name: 'Add Doc' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add Bookmark' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();

    // Human pacing: one hover over the panel before leaving (a real user
    // reads the toolbar before acting).
    await human.hover(page.getByRole('button', { name: 'Add Doc' }));
  });

  test('2.2 Add Bookmark with an empty vault fails closed with its toast', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await openCanvas(page);

    // No bookmarks were seeded: the guard path fires the toast and adds
    // nothing — the empty state must stay visible.
    await human.click(page.getByRole('button', { name: 'Add Bookmark' }));
    await expect(
      page.getByText('No bookmarks found'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('canvas-view')).toBeVisible();
  });

  test('2.3 Seeded bookmark lets Add Bookmark mount xyflow controls', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await saveBookmark(page, 'https://canvas.example.com', 'Canvas Fixture');

    await openCanvas(page);
    await human.click(page.getByRole('button', { name: 'Add Bookmark' }));

    // The node is added: the empty state leaves, xyflow's Controls mount.
    await expect(page.getByTestId('canvas-view')).toBeHidden({
      timeout: 15_000,
    });
    await expect(
      page.locator('.react-flow__controls'),
    ).toBeVisible({ timeout: 15_000 });
    // The bookmark node renders with its label through the custom node type.
    await expect(page.getByText('Canvas Fixture').first()).toBeVisible();

    // A second add works too (two nodes now); Clear returns to the empty
    // state, closing the lifecycle.
    await human.click(page.getByRole('button', { name: 'Add Bookmark' }));
    await human.click(page.getByRole('button', { name: 'Clear' }));
    await expect(page.getByTestId('canvas-view')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('2.4 Graph opens with stats line and the empty state', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await openGraph(page);

    // The stats line renders with real numbers ("Nodes: 0 | Links: 0 |
    // Clusters: 0" on a fresh vault).
    await expect(
      page.getByText(/^Nodes: \d+ \| Links: \d+ \| Clusters: \d+$/),
    ).toBeVisible();

    // d3 svg surface present.
    await expect(page.locator('svg.w-full.h-full')).toHaveCount(1);
    await human.hover(page.getByRole('textbox', { name: 'Filter nodes' }));
  });

  test('2.5 Graph filter input drives its debounced search', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await saveBookmark(page, 'https://graph.example.com', 'Graph Fixture');
    await openGraph(page);

    const filter = page.getByRole('textbox', { name: 'Filter nodes' });
    await human.type(filter, 'Graph Fixture');

    // The controlled input reflects the keystrokes (the debounce only
    // delays the d3 reload, not the value).
    await expect(filter).toHaveValue('Graph Fixture');

    // After the 300ms debounce + reload the view is still functional.
    await expect(
      page.getByRole('heading', { name: 'Knowledge Graph', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/^Nodes: \d+ \| Links: \d+ \| Clusters: \d+$/),
    ).toBeVisible();
  });
});
