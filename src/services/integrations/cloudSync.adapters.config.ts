import { firewalledFetch } from "../../utils/networkFirewall";
import { readBoundedCloudResponse, readBoundedText } from "./cloudSync.response";
import type { CloudProviderAdapter } from "./cloudSync.adapters.types";

function cloudFetch(
  url: string,
  options: RequestInit | undefined,
  context: string,
  signal?: AbortSignal,
): Promise<Response> {
  return firewalledFetch(
    url,
    signal ? { ...options, signal } : options,
    context,
  );
}

/**
 * Validates a WebDAV path/id to prevent path traversal / SSRF.
 * Allows a server-absolute path (leading "/") but rejects any directory
 * walking (".."), backslashes, or URL scheme/authority injection.
 */
function safeWebDavSegment(segment: string): string | null {
  if (typeof segment !== "string" || segment.length === 0) {return null;}
  const trimmed = segment.trim();
  // Reject scheme-prefixed or authority URLs (e.g. "http://", "//host")
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("//"))
    {return null;}
  // Reject directory traversal, encoded traversal, backslashes and controls.
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }
  if (
    decoded.includes("..") ||
    decoded.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(decoded)
  ) {return null;}
  return trimmed;
}

/** Validates a WebDAV display name as a single path component. */
function safeWebDavName(name: string): string | null {
  const safeName = safeWebDavSegment(name);
  if (!safeName) {return null;}
  let decoded = safeName;
  try {
    decoded = decodeURIComponent(safeName);
  } catch {
    return null;
  }
  if (decoded.includes("/")) {return null;}
  return safeName;
}

class WebDAVAdapter implements CloudProviderAdapter {
  providerName = "webdav" as const;
  constructor(
    private config?: { url: string; username?: string; password?: string },
  ) {}
  private getAuth(): string {
    if (!this.config?.username) {return "";}
    return `Basic ${btoa(`${this.config.username}:${this.config.password ?? ""}`)}`;
  }
  async authenticate(_signal?: AbortSignal): Promise<string> {
    if (!this.config?.url)
      {throw new Error("WebDAVAdapter: missing configuration");}
    return this.getAuth();
  }
  async listFiles(signal?: AbortSignal): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  > {
    const auth = await this.authenticate(signal);
    const res = await cloudFetch(
      this.config!.url,
      { method: "PROPFIND", headers: { Authorization: auth, Depth: "1" } },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`WebDAV list_files failed: ${res.status}`);}
    const text = await readBoundedText(res);
    if (!text || typeof text !== "string")
      {throw new Error("WebDAV list_files returned empty payload");}
    const hrefMatches =
      text.match(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/g) || [];
    const nameMatches =
      text.match(/<(?:\w+:)?displayname>([^<]+)<\/(?:\w+:)?displayname>/g) ||
      [];
    const results: Array<{ id: string; name: string }> = [];
    for (let i = 0; i < Math.min(hrefMatches.length, nameMatches.length); i++) {
      const nameMatch = nameMatches[i];
      const hrefMatch = hrefMatches[i];
      if (nameMatch && hrefMatch) {
        const name = nameMatch.replace(/<[^>]+>/g, "");
        const id = hrefMatch.replace(/<[^>]+>/g, "");
        const safeId = safeWebDavSegment(id);
        const safeName = safeWebDavName(name);
        if (safeName && !safeName.startsWith(".") && safeId)
          {results.push({ id: safeId, name: safeName });}
      }
    }
    return results;
  }
  async uploadFile(
    path: string,
    content: string | Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const auth = await this.authenticate(signal);
    const fileName = safeWebDavSegment(path.split("/").pop() ?? "data.json");
    if (!fileName) {throw new Error("WebDAVAdapter: invalid file path");}
    const url = `${this.config!.url.replace(/\/$/, "")}/${encodeURIComponent(fileName)}`;
    const res = await cloudFetch(
      url,
      {
        method: "PUT",
        headers: { Authorization: auth, "Content-Type": mimeType },
        body: content as BodyInit,
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`WebDAV upload failed: ${res.status}`);}
    return fileName;
  }
  async downloadFile(id: string, signal?: AbortSignal): Promise<Buffer> {
    const auth = await this.authenticate(signal);
    const safeId = safeWebDavSegment(id);
    if (!safeId) {throw new Error("WebDAVAdapter: invalid file id");}
    const res = await cloudFetch(
      `${this.config!.url.replace(/\/$/, "")}/${encodeURIComponent(safeId)}`,
      { headers: { Authorization: auth } },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`WebDAV download failed: ${res.status}`);}
    const data = await readBoundedCloudResponse(res);
    return Buffer.from(data);
  }

  async deleteFile(id: string, signal?: AbortSignal): Promise<void> {
    const auth = await this.authenticate(signal);
    const safeId = safeWebDavSegment(id);
    if (!safeId) {throw new Error("WebDAVAdapter: invalid file id");}
    const res = await cloudFetch(
      `${this.config!.url.replace(/\/$/, "")}/${encodeURIComponent(safeId)}`,
      { method: "DELETE", headers: { Authorization: auth } },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`WebDAV delete failed: ${res.status}`);}
  }
}

export { WebDAVAdapter };
