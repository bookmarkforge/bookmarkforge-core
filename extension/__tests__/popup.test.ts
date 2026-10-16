import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup';

describe('popup.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks does NOT reset implementations — a mockImplementation
    // set by one test would leak into later tests. Reset to the plain
    // vi.fn() (callback never invoked) so ordering never matters.
    (globalThis as any).chrome.tabs.create.mockReset();
    (globalThis as any).chrome.tabs.query.mockReset();
    vi.resetModules();
    document.body.innerHTML = `
      <div id="pageTitle">Loading...</div>
      <div id="pageUrl">Loading...</div>
      <button id="saveBtn">Save to BookmarkForge</button>
      <div id="status" style="display:none"></div>
    `;
  });

  it('should query the active tab on load and display title and URL', async () => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: 'Test Page', url: 'https://example.com' }]);

    expect(document.getElementById('pageTitle')?.textContent).toBe('Test Page');
    expect(document.getElementById('pageUrl')?.textContent).toBe('https://example.com');
  });

  it('should handle missing tab gracefully', async () => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    (globalThis as any).chrome.runtime.lastError = { message: 'Error' };
    queryCallback(null);
    delete (globalThis as any).chrome.runtime.lastError;

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Unable to read current tab');
  });

  it('should open capture URL with fragment hash on save click', async () => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: 'My Page', url: 'https://example.com/page' }]);

    document.getElementById('saveBtn')?.click();
    await vi.waitFor(() => expect((globalThis as any).chrome.tabs.create).toHaveBeenCalled());

    expect((globalThis as any).chrome.tabs.create).toHaveBeenCalledWith({
      url: expect.stringMatching(/^https:\/\/bookmarkforge\.com\/capture#/),
    }, expect.any(Function));

    const url = (globalThis as any).chrome.tabs.create.mock.calls[0][0].url;
    expect(url).toContain('#url=https%3A%2F%2Fexample.com%2Fpage');
    expect(url).toContain('&title=My%20Page');
    expect(url).not.toContain('?');
  });

  it('should show error when no URL is available', async () => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: 'No URL', url: null }]);

    document.getElementById('saveBtn')?.click();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('No page URL found');
  });

  it.each([
    ['chrome://extensions', 'chrome:// URL'],
    ['file:///C:/tmp/page.html', 'file:// URL'],
    ['about:blank', 'about: URL'],
  ])('should block non-http(s) tab %s (%s) and not open a capture tab', async (unsafeUrl, _label) => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: 'Unsafe', url: unsafeUrl }]);

    document.getElementById('saveBtn')?.click();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('This page cannot be captured');
    expect((globalThis as any).chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('should show auto-save success message after opening the capture tab', async () => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: 'My Page', url: 'https://example.com/page' }]);

    (globalThis as any).chrome.tabs.create.mockImplementation(
      (_opts: unknown, cb: (tab: unknown) => void) => {
        cb({ id: 1 });
      },
    );

    document.getElementById('saveBtn')?.click();
    await vi.waitFor(() => expect((globalThis as any).chrome.tabs.create).toHaveBeenCalled());

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe(
      'BookmarkForge opened! Your page is being saved automatically.',
    );
  });

  it('should handle chrome.runtime.lastError on tabs.create', async () => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: 'Test', url: 'https://example.com' }]);

    (globalThis as any).chrome.tabs.create.mockImplementation(
      (_opts: unknown, cb: (tab: unknown) => void) => {
        (globalThis as any).chrome.runtime.lastError = { message: 'Error' };
        cb(null);
        delete (globalThis as any).chrome.runtime.lastError;
      },
    );

    document.getElementById('saveBtn')?.click();
    await vi.waitFor(() => expect((globalThis as any).chrome.tabs.create).toHaveBeenCalled());

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Could not open BookmarkForge');
  });

  it('should not inject HTML when tab title contains angle brackets', async () => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: '<img src=x onerror=alert(1)>', url: 'https://example.com' }]);

    const pageTitleEl = document.getElementById('pageTitle');
    // textContent must render the raw string, not parse it as HTML
    expect(pageTitleEl?.innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(pageTitleEl?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('should not inject HTML when tab URL contains script tags', async () => {
    await import('../popup.js');

    const queryCallback = (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: 'Test', url: 'https://example.com/<script>alert(1)</script>' }]);

    const pageUrlEl = document.getElementById('pageUrl');
    expect(pageUrlEl?.textContent).toBe('https://example.com/<script>alert(1)</script>');
    expect(pageUrlEl?.innerHTML).not.toContain('<script>');
  });
});
