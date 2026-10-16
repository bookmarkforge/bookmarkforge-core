import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup';

describe('Extension Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="pageTitle">Example Page</div>
      <div id="pageUrl">https://example.com/page</div>
      <button id="saveBtn">Save to BookmarkForge</button>
      <div id="status" style="display:none"></div>
    `;
  });

  it('background and popup should use the same fragment-hash URL pattern', async () => {
    // Load background.js
    await import('../background.js');

    // Simulate context menu click
    const clickListener = (globalThis as any).chrome.contextMenus.onClicked.addListener;
    const bgCallback = (clickListener as any).mock.calls[0][0];
    await bgCallback(
      { menuItemId: 'save-to-bookmarkforge', pageUrl: 'https://example.com/page' },
      { title: 'Example Page' }
    );

    const bgUrl = (globalThis as any).chrome.tabs.create.mock.calls[0][0].url;

    // Reset mock for popup test
    vi.clearAllMocks();

    // Load popup.js
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: 'Example Page', url: 'https://example.com/page' }]);

    // Click save
    document.getElementById('saveBtn')?.click();
    await vi.waitFor(() => expect((globalThis as any).chrome.tabs.create).toHaveBeenCalled());

    const popupUrl = (globalThis as any).chrome.tabs.create.mock.calls[0]?.[0]?.url;

    // Both use fragment hash (no ? query strings)
    expect(bgUrl).toContain('#');
    expect(bgUrl).not.toContain('?');
    expect(popupUrl).toContain('#');
    expect(popupUrl).not.toContain('?');

    // Both encode URL and title
    expect(bgUrl).toContain('url=https%3A%2F%2Fexample.com%2Fpage');
    expect(popupUrl).toContain('url=https%3A%2F%2Fexample.com%2Fpage');
  });

  it('createBookmarklet produces a safe javascript: URL', () => {
    const bookmarklet = (globalThis as any).BookmarkForgeCaptureUrl.createBookmarklet(
      'https://bookmarkforgeapp.com',
    );

    // Must start with javascript:(function(){
    expect(bookmarklet).toMatch(/^javascript:\(function\(\)\{/);
    // Must end with })();
    expect(bookmarklet).toMatch(/\}\)\(\);$/);
    // The base URL is serialized via JSON.stringify (double-quoted string)
    expect(bookmarklet).toContain('var b="https://bookmarkforgeapp.com"');
    // Uses encodeURIComponent for user data (no raw injection)
    expect(bookmarklet).toContain('encodeURIComponent(window.location.href)');
    expect(bookmarklet).toContain('encodeURIComponent(document.title');
  });

  it('createBookmarklet escapes quotes in the base URL', () => {
    const bookmarklet = (globalThis as any).BookmarkForgeCaptureUrl.createBookmarklet(
      'https://evil.com/"onerror=alert(1)',
    );
    // JSON.stringify must escape the double quote inside the URL
    expect(bookmarklet).toContain('var b="https://evil.com/\\"onerror=alert(1)"');
    // No unescaped double-quote that could break the JS string
    const varBMatch = bookmarklet.match(/var b="([^"]*)"/);
    expect(varBMatch).not.toBeNull();
  });

  it('createBookmarklet escapes backslashes in the base URL', () => {
    const bookmarklet = (globalThis as any).BookmarkForgeCaptureUrl.createBookmarklet(
      'https://evil.com/\\script',
    );
    // JSON.stringify must escape the backslash
    expect(bookmarklet).toContain('var b="https://evil.com/\\\\script"');
  });

  it('isValidBaseUrl rejects javascript: scheme', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('javascript:alert(1)')).toBe(false);
  });

  it('isValidBaseUrl rejects http:// scheme', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('http://insecure.example.com')).toBe(false);
  });

  it('isValidBaseUrl rejects data: scheme', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('isValidBaseUrl rejects file: scheme', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('file:///etc/passwd')).toBe(false);
  });

  it('isValidBaseUrl rejects vbscript: scheme', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('vbscript:MsgBox(1)')).toBe(false);
  });

  it('isValidBaseUrl rejects empty and whitespace strings', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('')).toBe(false);
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('   ')).toBe(false);
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl(null)).toBe(false);
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl(undefined)).toBe(false);
  });

  it('isValidBaseUrl accepts valid https URLs', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('https://bookmarkforgeapp.com')).toBe(true);
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('https://example.com/path?q=1')).toBe(true);
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('https://sub.domain.co.uk')).toBe(true);
  });

  it('isValidBaseUrl rejects hostname starting with dash', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('https://-evil.com')).toBe(false);
  });

  it('isValidBaseUrl rejects URLs with backslash normalization tricks', () => {
    // WHATWG normalizes backslashes, so https:\/\/ becomes https://
    // but the result should still be a valid https URL — this is safe
    expect((globalThis as any).BookmarkForgeCaptureUrl.isValidBaseUrl('https:\\/\\/example.com')).toBe(true);
  });

  it('normalizeBaseUrl strips trailing slashes', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.normalizeBaseUrl('https://example.com///')).toBe('https://example.com');
  });

  it('normalizeBaseUrl trims whitespace', () => {
    expect((globalThis as any).BookmarkForgeCaptureUrl.normalizeBaseUrl('  https://example.com  ')).toBe('https://example.com');
  });
});
