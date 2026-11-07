/**
 * Shared helpers for the sidebar-collapse layout assertions (plan 002:
 * the Tailwind v4 `sidebar-collapsed` variant must shift the content).
 *
 * Used by `sidebar-collapse-layout.spec.ts` (skipPassword, no vault) and
 * `vault-sidebar-toggle.spec.ts` (vault flow) so both specs measure the
 * same computed layout without duplicating selectors.
 */
import type { Page } from "@playwright/test";

export const SIDEBAR_SELECTOR = 'aside[data-collapsed]';
export const CONTENT_SELECTOR = ".flex-1.flex.flex-col.min-h-screen";

export interface SidebarLayoutState {
  sidebarWidth: number;
  contentMargin: string;
  htmlCollapsed: boolean;
}

/**
 * Snapshot of the layout state relevant to the collapse variant:
 * the rail width, the content column's `margin-inline-start` (which the
 * variant drives), and whether `sidebar-collapsed` is on `<html>`.
 */
export async function layoutState(page: Page): Promise<SidebarLayoutState> {
  return page.evaluate(
    ({ asideSel, contentSel }) => {
      const aside = document.querySelector(asideSel);
      const content = document.querySelector(contentSel);
      return {
        sidebarWidth: aside ? aside.getBoundingClientRect().width : 0,
        contentMargin: content
          ? getComputedStyle(content).marginInlineStart
          : "",
        htmlCollapsed: document.documentElement.classList.contains(
          "sidebar-collapsed",
        ),
      };
    },
    { asideSel: SIDEBAR_SELECTOR, contentSel: CONTENT_SELECTOR },
  );
}
