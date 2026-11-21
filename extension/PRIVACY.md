# BookmarkForge Extension — Privacy

The extension reads the active tab's URL and title only when the user
explicitly invokes a capture action (context menu or toolbar button).

**It does not transmit anything.** A capture opens a new tab pointing at the
BookmarkForge instance the user configured (`<base-url>#capture?url=…&title=…`).
The captured URL and title travel in the URL fragment, and a fragment is never
part of an HTTP request: it stays in the browser, is read by the application
itself, and never reaches a server — neither ours nor the user's.

The extension does not sell data, inject advertising, collect browsing
history, or transmit vault contents to BookmarkForge. The configured server URL
is stored in browser extension storage. Users can inspect, change, or remove
that URL from the extension settings.

**Why `chrome.storage.sync`:** Manifest V3 service workers have no
`localStorage`, so `chrome.storage` is the only persistence API available to
the background worker. `storage.sync` is used deliberately over
`storage.local`: the single stored value is a non-sensitive, user-chosen
server URL, and syncing lets the configuration follow the user across their
signed-in browsers. No page content, titles, tokens, or credentials are ever
written to extension storage — the only key is `bookmarkforge_base_url`, and
it is validated as an HTTPS (or loopback) URL before every read and write.

Page titles and URLs are read only when the user explicitly activates capture.
No provider API keys are bundled in the extension, and no telemetry is
collected by the extension itself.

For self-hosted deployments, the operator controls the server and its
retention policy. Report security issues through the project's documented
security channel.
