# BookmarkForge Extension — Privacy

The extension only reads the active tab after the user invokes a capture action. It sends the selected page metadata to the BookmarkForge vault endpoint configured by the user.

The extension does not sell data, inject advertising, collect browsing history, or transmit vault contents to BookmarkForge. The configured server URL is stored in browser extension storage. Users can inspect, change, or remove that URL from the extension settings.

Page titles, URLs, and selected capture metadata are transmitted only when the user explicitly activates capture. No provider API keys are bundled in the extension.

For self-hosted deployments, the operator controls the server and its retention policy. Report security issues through the project’s documented security channel.
