# BookmarkForge Extension

A browser extension for BookmarkForge that allows you to save any page to your personal vault with a single click.

## Features

- **One-click saving**: Save any page to your BookmarkForge vault from the browser toolbar or context menu
- **Privacy-first**: Uses fragment hash URLs to prevent page metadata from leaking to third-party logs
- **Self-hosted support**: Configure your own BookmarkForge instance
- **Minimal permissions**: Only requests the permissions it needs (activeTab, contextMenus, storage)
- **Manifest V3**: Modern extension API for Chrome, Edge, and Firefox (109+)

## Installation

### From Firefox Add-ons

1. Visit the [BookmarkForge Extension page on Firefox Add-ons](https://addons.mozilla.org/)
2. Click "Add to Firefox"
3. Follow the installation prompts

### From Chrome Web Store

1. Visit the [BookmarkForge Extension page on Chrome Web Store](https://chrome.google.com/webstore)
2. Click "Add to Chrome"
3. Follow the installation prompts

### Manual Installation (Development)

For development or testing:

1. Clone this repository
2. Open your browser's extension management page:
   - Chrome: `chrome://extensions/`
   - Firefox: `about:debugging#/runtime/this-firefox`
3. Enable "Developer mode"
4. Click "Load unpacked" (Chrome) or "Load Temporary Add-on" (Firefox)
5. Select the `extension/` directory

## Usage

### Toolbar Button

1. Click the BookmarkForge icon in your browser toolbar
2. Review the page title and URL
3. Click "Save to BookmarkForge"
4. The page will open in BookmarkForge and be saved automatically

### Context Menu

1. Right-click on any page or link
2. Select "Save to BookmarkForge"
3. The page/link will open in BookmarkForge and be saved automatically

### Custom Server URL

To use your self-hosted BookmarkForge instance:

1. Click the BookmarkForge icon in your browser toolbar
2. Click "Settings"
3. Enter your BookmarkForge URL (e.g., `https://your-domain.com`)
4. Click "Save"

To reset to the default:

1. Open Settings
2. Click "Reset"

## Privacy Policy

The extension only reads the active tab after you invoke a capture action. It sends the selected page metadata to the BookmarkForge vault endpoint configured by you.

The extension does not:
- Sell data
- Inject advertising
- Collect browsing history
- Transmit vault contents to BookmarkForge

The configured server URL is stored in browser extension storage. You can inspect, change, or remove that URL from the extension settings.

For more details, see [PRIVACY.md](PRIVACY.md).

## Development

### Building

The extension files are in the `extension/` directory. No build process is required.

### Testing

Run the extension tests:

```bash
npm test -- extension
```

### Manifest Files

- `manifest.json` - Chrome/Edge (Manifest V3)
- `manifest-firefox.json` - Firefox (Manifest V3)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- Website: https://bookmarkforgeapp.com
- Privacy Policy: https://bookmarkforgeapp.com/privacy-and-terms.html
- Email: bookmarkforge@proton.me

## Security

Report security issues through the project's documented security channel. Do not report security vulnerabilities via public issues.
