# BookmarkForge Extension - Local Development Setup

This guide explains how to develop and test the BookmarkForge browser extension locally.

## Prerequisites

- Node.js >= 20.19.0
- Chrome/Chromium browser (for Chrome extension development)
- Firefox browser (for Firefox extension development)
- BookmarkForge local dev server running (see Vercel setup)

## Extension Architecture

### Files Structure

```
extension/
├── manifest.json              # Chrome extension manifest
├── manifest-firefox.json      # Firefox extension manifest
├── background.js              # Service worker (background script)
├── popup.html                 # Extension popup UI
├── popup.js                   # Popup logic
├── popup.css                  # Popup styling
├── capture-url.js            # URL capture functionality
├── brand-tokens.css          # Brand styling
├── icon-16.png              # Extension icon (16x16)
├── icon-48.png              # Extension icon (48x48)
├── icon-128.png             # Extension icon (128x128)
├── PRIVACY.md               # Privacy policy
└── __tests__/               # Extension tests
```

### How It Works

1. **Context Menu**: Right-click on any page to save to BookmarkForge
2. **Popup**: Click extension icon to access quick save
3. **Communication**: Extension communicates with local BookmarkForge instance
4. **Storage**: Uses browser storage for settings

## Local Development

### 1. Start BookmarkForge Dev Server

First, ensure your local BookmarkForge instance is running:

```bash
cd D:\Nueva\carpeta\bookmark7
npm run dev
```

This will start the dev server on `http://localhost:5173`.

### 2. Build Extension for Development

```bash
npm run build:extension:custom
```

This builds the extension with development configuration.

### 3. Load Extension in Chrome

#### Chrome/Chromium/Edge

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `extension/` directory
5. The extension should now appear in your extensions list

#### Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/manifest-firefox.json`
4. The extension should now be loaded

### 4. Configure Extension Settings

The extension needs to know where your local BookmarkForge instance is running:

1. Click the extension icon
2. In the popup, configure:
   - **BookmarkForge URL**: `http://localhost:5173`
   - **API Endpoint**: (if needed for your setup)

### 5. Test the Extension

#### Test Context Menu

1. Navigate to any webpage
2. Right-click on the page
3. Select "Save to BookmarkForge" from the context menu
4. Verify the bookmark is saved to your local instance

#### Test Popup

1. Click the extension icon
2. Enter a URL or use the current page
3. Click "Save"
4. Verify the bookmark is saved

#### Test URL Capture

1. Navigate to a webpage
2. Click the extension icon
3. Click "Capture URL"
4. Verify the URL is captured and ready to save

## Development Workflow

### Making Changes

1. **Edit extension files** in the `extension/` directory
2. **Rebuild the extension**:
   ```bash
   npm run build:extension:custom
   ```
3. **Reload the extension** in the browser:
   - Chrome: Click the reload button on the extension card in `chrome://extensions/`
   - Firefox: Reload the temporary add-on

### Hot Reload

For faster development during popup changes:

1. Open the popup in a new tab: `chrome-extension://<extension-id>/popup.html`
2. Use browser DevTools to inspect and debug
3. Changes to popup.js/popup.css may require a full extension reload

### Testing Extension Logic

Run extension tests:

```bash
npm run test:extension
```

Run extension smoke tests:

```bash
npm run test:extension:smoke
```

## Configuration

### Local vs Production

The extension can work with both local and production BookmarkForge instances:

**Local Development:**
```
URL: http://localhost:5173
Environment: development
```

**Production:**
```
URL: https://bookmarkforge.com
Environment: production
```

### Environment Variables

The extension reads configuration from browser storage:

```javascript
// In popup.js
const config = {
  bookmarkForgeUrl: localStorage.getItem('bookmarkforge_url') || 'https://bookmarkforge.com',
  apiKey: localStorage.getItem('bookmarkforge_api_key') || null
};
```

## Troubleshooting

### Extension Not Loading

**Chrome:**
- Check Developer mode is enabled
- Verify manifest.json is valid JSON
- Check Chrome console for errors

**Firefox:**
- Ensure manifest-firefox.json is selected
- Check WebExtension console for errors
- Verify Firefox version compatibility

### Connection to Local Instance Failed

1. Verify BookmarkForge dev server is running:
   ```bash
   npm run dev
   ```
2. Check the URL is correct: `http://localhost:5173`
3. Check browser console for CORS errors
4. Ensure the dev server allows connections from extensions

### Manifest Version Errors

Chrome requires manifest version 3. If you see errors:
- Verify `manifest_version: 3` in manifest.json
- Check that all permissions are valid for MV3
- Review CSP settings in the manifest

### Service Worker Not Starting

1. Check background.js for syntax errors
2. Verify service worker is registered correctly
3. Check browser console for errors
4. Try reloading the extension

## Building for Production

When ready to distribute the extension:

### 1. Update Version

Edit `extension/manifest.json` and `extension/manifest-firefox.json`:

```json
{
  "version": "1.0.1"
}
```

### 2. Build Production Extension

```bash
npm run build:extension:custom
```

### 3. Package Extension

Create a zip file for distribution:

```bash
# Chrome
zip -r bookmarkforge-extension-chrome.zip extension/

# Firefox
zip -r bookmarkforge-extension-firefox.zip extension/
```

### 4. Upload to Web Store

- **Chrome Web Store**: Upload to https://chrome.google.com/webstore/devconsole
- **Firefox Add-ons**: Upload to https://addons.mozilla.org/developers/

## Security Considerations

### Content Security Policy

The extension uses strict CSP:

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'none'; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'; style-src 'self'"
  }
}
```

### Permissions

The extension requests minimal permissions:
- `activeTab`: Access current tab for URL capture
- `contextMenus`: Add context menu items
- `storage`: Store extension settings

### Data Handling

- Extension does not store sensitive data
- All communication goes to configured BookmarkForge instance
- Local storage used only for preferences

## Testing Checklist

Before releasing the extension:

- [ ] Test in Chrome (latest version)
- [ ] Test in Firefox (latest version)
- [ ] Test context menu functionality
- [ ] Test popup functionality
- [ ] Test URL capture
- [ ] Test with local BookmarkForge instance
- [ ] Test with production BookmarkForge instance
- [ ] Verify CSP is working correctly
- [ ] Check for console errors
- [ ] Test on different pages (HTTPS, HTTP, different domains)
- [ ] Verify extension icons display correctly
- [ ] Test privacy policy link

## Resources

- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Firefox WebExtension API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [BookmarkForge Architecture Tutorial](ARCHITECTURE-TUTORIAL.md)
- [BookmarkForge API Documentation](api.md)

## Next Steps

1. Start your local BookmarkForge instance
2. Build and load the extension
3. Test all functionality
4. Make improvements as needed
5. Prepare for distribution when ready

Happy extension development! 🚀
