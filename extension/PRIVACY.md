# BookmarkForge Extension — Privacy

The extension reads the active tab's URL and title only when the user
explicitly invokes a capture action (context menu, toolbar button or
keyboard shortcut).

**It does not transmit anything.** A capture opens a new tab pointing at the
BookmarkForge instance the user configured (`<base-url>#capture?url=…&title=…`).
The captured URL and title travel in the URL fragment, and a fragment is never
part of an HTTP request: it stays in the browser, is read by the application
itself, and never reaches a server — neither ours nor the user's.

The extension does not sell data, inject advertising, collect browsing
history, or transmit vault contents to BookmarkForge. The configured server URL
is stored in browser extension storage. Users can inspect, change, or remove
that URL from the extension settings.

Page titles and URLs are read only when the user explicitly activates capture.
No provider API keys are bundled in the extension, and no telemetry is
collected by the extension itself.

For self-hosted deployments, the operator controls the server and its
retention policy. Report security issues through the project's documented
security channel.
