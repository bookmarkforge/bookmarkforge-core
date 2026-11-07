import { describe, it, expect } from 'vitest';
import manifest from '../manifest.json';
import firefoxManifest from '../manifest-firefox.json';

// Permissions that would be broader than what the extension actually needs.
// The extension only reads the active tab's URL/title (via activeTab) and
// registers a context menu — nothing else.
const UNNECESSARY_PERMISSIONS = ['tabs', 'notifications', 'cookies', 'webRequest', 'webNavigation', 'bookmarks', 'history', 'downloads', 'clipboardRead', 'unlimitedStorage'];

const PNG_ICON_SIZES = ['16', '48', '128'];

// Shared checks so Chrome (MV3) and Firefox (MV2) stay in parity: same name,
// version, description, permissions, icon set and capture entry points.
function expectParityWithChrome(firefox: typeof firefoxManifest) {
  expect(firefox.name).toBe(manifest.name);
  expect(firefox.version).toBe(manifest.version);
  expect(firefox.description).toBe(manifest.description);
  expect(firefox.permissions).toEqual(manifest.permissions);
  expect(firefox.homepage_url).toBe(manifest.homepage_url);
}

function expectMinimalPermissions(perms: string[] | undefined) {
  expect(perms).toBeDefined();
  expect(perms).toContain('activeTab');
  expect(perms).toContain('contextMenus');
  for (const perm of UNNECESSARY_PERMISSIONS) {
    expect(perms).not.toContain(perm);
  }
}

function expectPngIcons(icons: Record<string, string> | undefined) {
  expect(icons).toBeDefined();
  for (const size of PNG_ICON_SIZES) {
    expect(icons?.[size]).toBe(`icon-${size}.png`);
  }
}

describe('Extension Manifest (Chrome MV3)', () => {
  it('should use manifest version 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('should have minimum required permissions', () => {
    expectMinimalPermissions(manifest.permissions);
  });

  it('should not have unnecessary permissions', () => {
    expect(manifest.permissions).toBeDefined();
    for (const perm of UNNECESSARY_PERMISSIONS) {
      expect(manifest.permissions).not.toContain(perm);
    }
  });

  it('should not have host_permissions', () => {
    expect(
      (manifest as { host_permissions?: string[] }).host_permissions,
    ).toBeUndefined();
  });

  it('should have a background service worker', () => {
    expect(manifest.background?.service_worker).toBe('background.js');
  });

  it('should have correct popup HTML', () => {
    expect(manifest.action?.default_popup).toBe('popup.html');
  });

  it('should reference PNG icons in all standard sizes (Web Store requires PNG)', () => {
    expectPngIcons(manifest.icons);
    expectPngIcons(manifest.action?.default_icon);
  });
});

describe('Extension Manifest (Firefox MV2)', () => {
  it('should use manifest version 2', () => {
    expect(firefoxManifest.manifest_version).toBe(2);
  });

  it('should use browser_action (MV2) pointing to the same popup', () => {
    expect(firefoxManifest.browser_action?.default_popup).toBe('popup.html');
  });

  it('should have minimal permissions and no host permissions', () => {
    expectMinimalPermissions(firefoxManifest.permissions);
    expect((firefoxManifest as { host_permissions?: string[] }).host_permissions).toBeUndefined();
  });

  it('should use a non-persistent event-page background script', () => {
    expect(firefoxManifest.background?.scripts).toEqual(['capture-url.js', 'background.js']);
    expect(firefoxManifest.background?.persistent).toBe(false);
  });

  it('should declare a gecko id and a supported Firefox version', () => {
    const gecko = firefoxManifest.browser_specific_settings?.gecko;
    expect(gecko?.id).toBe('bookmarkforge@proton.me');
    expect(gecko?.strict_min_version).toBeTruthy();
  });

  it('should reference PNG icons in all standard sizes', () => {
    expectPngIcons(firefoxManifest.icons);
    expectPngIcons(firefoxManifest.browser_action?.default_icon);
  });

  it('should stay in parity with the Chrome manifest (name/version/description/permissions)', () => {
    expectParityWithChrome(firefoxManifest);
  });
});
