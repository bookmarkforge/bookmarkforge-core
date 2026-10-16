import { secureStorage } from "../SecureStorage";
import { firewalledFetch } from "../../utils/networkFirewall";
import { logger } from "../../utils/logger";
import { readBoundedCloudResponse, readBoundedJson } from "./cloudSync.response";
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

async function getSecureToken(key: string): Promise<string | null> {
  try {
    const token = await secureStorage.getSecret(key);
    if (token) {return token;}
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`[CloudSync] getSecureToken failed for ${key}: ${msg}`);
  }
  return null;
}

interface RawCloudEntry {
  id?: unknown;
  name?: unknown;
  modifiedTime?: unknown;
  lastModifiedDateTime?: unknown;
}

/** Validates a cloud provider file entry, dropping fields with wrong types. */
function normalizeCloudFileEntry(
  e: RawCloudEntry,
): { id: string; name: string; modifiedTime: string } | null {
  const id = typeof e.id === "string" && e.id.length > 0 ? e.id : null;
  const name = typeof e.name === "string" && e.name.length > 0 ? e.name : null;
  const modifiedTime =
    typeof (e.modifiedTime ?? e.lastModifiedDateTime) === "string"
      ? String(e.modifiedTime ?? e.lastModifiedDateTime)
      : "";
  if (!id || !name) {return null;}
  return { id, name, modifiedTime };
}

class DriveAdapter implements CloudProviderAdapter {
  providerName = "drive" as const;
  constructor(private token?: string) {}
  async authenticate(_signal?: AbortSignal): Promise<string> {
    const t =
      this.token ||
      (typeof process !== "undefined"
        ? await getSecureToken("DRIVE_ACCESS_TOKEN")
        : undefined);
    if (t) {return t;}
    throw new Error("DriveAdapter: missing access token");
  }
  private async fetchJson(
    url: string,
    options?: RequestInit,
  ): Promise<unknown> {
    const res = await cloudFetch(url, options, "cloud-sync");
    if (!res.ok)
      {throw new Error(`Drive API error: ${res.status} ${res.statusText}`);}
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {return readBoundedJson(res);}
    return res.text();
  }
  async listFiles(signal?: AbortSignal): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  > {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=id,name,modifiedTime",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok)
      {throw new Error(
        `Drive listFiles failed: ${res.status} ${res.statusText}`,
      );}
    const data = await readBoundedJson<Record<string, unknown>>(res);
    const files = Array.isArray(data.files) ? data.files : [];
    return files
      .map((e: RawCloudEntry) => normalizeCloudFileEntry(e))
      .filter((e: ReturnType<typeof normalizeCloudFileEntry>) => e !== null);
  }
  async uploadFile(
    path: string,
    content: string | Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const token = await this.authenticate(signal);
    const fileName = path.split("/").pop() ?? "data.json";
    const metadataRes = await cloudFetch(
      "https://www.googleapis.com/drive/v3/files",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: fileName, parents: ["appDataFolder"] }),
      },
      "cloud-sync",
      signal,
    );
    if (!metadataRes.ok)
      {throw new Error(
        `Drive file create failed: ${metadataRes.status} ${metadataRes.statusText}`,
      );}
    const fileMeta = await readBoundedJson<Record<string, unknown>>(metadataRes);
    const fileId = typeof fileMeta?.id === "string" ? fileMeta.id : null;
    if (!fileId) {throw new Error("Drive file create returned no id");}
    const contentStr =
      typeof content === "string" ? content : content.toString();
    const metadataPart = JSON.stringify({
      name: fileName,
      parents: ["appDataFolder"],
    });
    let boundary: string;
    do {
      const randomPart = Array.from(
        crypto.getRandomValues(new Uint8Array(12)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      boundary =
        "------BookmarkForge" + randomPart + Date.now().toString(36);
    } while (contentStr.includes(boundary) || metadataPart.includes(boundary));
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${contentStr}\r\n--${boundary}--`;
    const res = await cloudFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`,
      {
        method: "PUT",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
          Authorization: `Bearer ${token}`,
        },
        body: multipart,
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok)
      {throw new Error(
        `Drive file upload failed: ${res.status} ${res.statusText}`,
      );}
    return fileId;
  }
  async downloadFile(id: string, signal?: AbortSignal): Promise<Buffer> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Drive download failed: ${res.status}`);}
    const arrayBuf = await readBoundedCloudResponse(res);
    return Buffer.from(arrayBuf);
  }

  async deleteFile(id: string, signal?: AbortSignal): Promise<void> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Drive delete failed: ${res.status}`);}
  }
}

class DropboxAdapter implements CloudProviderAdapter {
  providerName = "dropbox" as const;
  constructor(private token?: string) {}
  async authenticate(_signal?: AbortSignal): Promise<string> {
    const t =
      this.token ||
      (typeof process !== "undefined"
        ? await getSecureToken("DROPBOX_ACCESS_TOKEN")
        : undefined);
    if (t) {return t;}
    throw new Error("DropboxAdapter: missing access token");
  }
  async listFiles(signal?: AbortSignal): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  > {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      "https://api.dropboxapi.com/2/files/list_folder",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: "" }),
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Dropbox list_files failed: ${res.status}`);}
    const data = await readBoundedJson<Record<string, unknown>>(res);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries
      .map((e: RawCloudEntry & { client_modified?: unknown }) =>
        normalizeCloudFileEntry({ ...e, modifiedTime: e.client_modified }),
      )
      .filter((e: ReturnType<typeof normalizeCloudFileEntry>) => e !== null);
  }
  async uploadFile(
    path: string,
    content: string | Buffer,
    _mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const token = await this.authenticate(signal);
    const filePath = `/${path.split("/").pop() ?? "data.json"}`;
    const res = await cloudFetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            path: filePath,
            mode: "overwrite",
            autorename: true,
            mute: false,
          }),
        },
        body: content as BodyInit,
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Dropbox upload failed: ${res.status}`);}
    const data = await readBoundedJson<Record<string, unknown>>(res);
    return typeof data?.id === "string" ? data.id : "unknown";
  }
  async downloadFile(id: string, signal?: AbortSignal): Promise<Buffer> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      "https://content.dropboxapi.com/2/files/download",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({ path: id }),
        },
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Dropbox download failed: ${res.status}`);}
    const data = await readBoundedCloudResponse(res);
    return Buffer.from(data);
  }

  async deleteFile(id: string, signal?: AbortSignal): Promise<void> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      "https://api.dropboxapi.com/2/files/delete_v2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: id }),
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Dropbox delete failed: ${res.status}`);}
  }
}

class OneDriveAdapter implements CloudProviderAdapter {
  providerName = "onedrive" as const;
  constructor(private token?: string) {}
  private getBaseUrl(): string {
    return "https://graph.microsoft.com/v1.0/me/drive";
  }
  async authenticate(_signal?: AbortSignal): Promise<string> {
    const t =
      this.token ||
      (typeof process !== "undefined"
        ? await getSecureToken("ONEDRIVE_ACCESS_TOKEN")
        : undefined);
    if (t) {return t;}
    throw new Error("OneDriveAdapter: missing access token");
  }
  async listFiles(signal?: AbortSignal): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  > {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      `${this.getBaseUrl()}/root/children?select=id,name,lastModifiedDateTime`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`OneDrive list_files failed: ${res.status}`);}
    const data = await readBoundedJson<Record<string, unknown>>(res);
    const entries = Array.isArray(data.value) ? data.value : [];
    return entries
      .map((e: RawCloudEntry) => normalizeCloudFileEntry(e))
      .filter((e: ReturnType<typeof normalizeCloudFileEntry>) => e !== null);
  }
  async uploadFile(
    path: string,
    content: string | Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const token = await this.authenticate(signal);
    const fileName = path.split("/").pop() ?? "data.json";
    const res = await cloudFetch(
      `${this.getBaseUrl()}/root:/${fileName}:/content`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
        body: content as BodyInit,
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`OneDrive upload failed: ${res.status}`);}
    const data = await readBoundedJson<Record<string, unknown>>(res);
    return typeof data?.id === "string" ? data.id : "unknown";
  }
  async downloadFile(id: string, signal?: AbortSignal): Promise<Buffer> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      `${this.getBaseUrl()}/items/${id}/content`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`OneDrive download failed: ${res.status}`);}
    const data = await readBoundedCloudResponse(res);
    return Buffer.from(data);
  }

  async deleteFile(id: string, signal?: AbortSignal): Promise<void> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      `${this.getBaseUrl()}/items/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`OneDrive delete failed: ${res.status}`);}
  }
}

class BoxAdapter implements CloudProviderAdapter {
  providerName = "box" as const;
  constructor(private token?: string) {}
  async authenticate(_signal?: AbortSignal): Promise<string> {
    const t =
      this.token ||
      (typeof process !== "undefined"
        ? await getSecureToken("BOX_ACCESS_TOKEN")
        : undefined);
    if (t) {return t;}
    throw new Error("BoxAdapter: missing access token");
  }
  async listFiles(signal?: AbortSignal): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  > {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      "https://api.box.com/2.0/folders/0/items",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Box list_files failed: ${res.status}`);}
    const data = await readBoundedJson<Record<string, unknown>>(res);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries
      .map((e: RawCloudEntry & { modified_at?: unknown }) =>
        normalizeCloudFileEntry({ ...e, modifiedTime: e.modified_at }),
      )
      .filter((e: ReturnType<typeof normalizeCloudFileEntry>) => e !== null);
  }
  async uploadFile(
    path: string,
    content: string | Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const token = await this.authenticate(signal);
    const fileName = path.split("/").pop() ?? "data.json";
    const formData = new FormData();
    formData.append(
      "attributes",
      JSON.stringify({ name: fileName, parent: { id: "0" } }),
    );
    formData.append(
      "file",
      new Blob([content as BlobPart], { type: mimeType }),
      fileName,
    );
    const res = await cloudFetch(
      "https://upload.box.com/api/2.0/files/content",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Box upload failed: ${res.status}`);}
    const data = await readBoundedJson<Record<string, unknown>>(res);
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const first = entries[0];
    return first && typeof first === "object" && typeof first.id === "string"
      ? first.id
      : "unknown";
  }
  async downloadFile(id: string, signal?: AbortSignal): Promise<Buffer> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      `https://api.box.com/2.0/files/${id}/content`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Box download failed: ${res.status}`);}
    const data = await readBoundedCloudResponse(res);
    return Buffer.from(data);
  }

  async deleteFile(id: string, signal?: AbortSignal): Promise<void> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      `https://api.box.com/2.0/files/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`Box delete failed: ${res.status}`);}
  }
}

class PCloudAdapter implements CloudProviderAdapter {
  providerName = "pcloud" as const;
  constructor(private token?: string) {}
  async authenticate(_signal?: AbortSignal): Promise<string> {
    const t =
      this.token ||
      (typeof process !== "undefined"
        ? await getSecureToken("PCLOUD_ACCESS_TOKEN")
        : undefined);
    if (t) {return t;}
    throw new Error("PCloudAdapter: missing access token");
  }
  async listFiles(signal?: AbortSignal): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  > {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      "https://api.pcloud.com/listfolder",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          auth: token,
          folderid: "0",
          norecursive: "1",
        }).toString(),
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`pCloud list_files failed: ${res.status}`);}
    const data = await readBoundedJson<{
      result?: number;
      error?: string;
      metadata?: {
        contents?: Array<{ fileid: string; name: string; modified: string }>;
      };
    } | null>(res);
    if (!data || typeof data.result !== "number")
      {throw new Error("pCloud list_files returned malformed payload");}
    if (data.result !== 0)
      {throw new Error(`pCloud error: ${data.error || "unknown error"}`);}
    const entries = (data.metadata?.contents ?? []) as Array<{
      fileid: string;
      name: string;
      modified: string;
    }>;
    return entries.map((e) => ({
      id: String(e.fileid),
      name: e.name,
      modifiedTime: e.modified,
    }));
  }
  async uploadFile(
    path: string,
    content: string | Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const token = await this.authenticate(signal);
    const fileName = path.split("/").pop() ?? "data.json";
    const body = new FormData();
    body.append("auth", token);
    body.append("folderid", "0");
    body.append(
      "file",
      new Blob([content as BlobPart], { type: mimeType }),
      fileName,
    );
    const res = await cloudFetch(
      "https://api.pcloud.com/uploadfile",
      { method: "POST", body },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`pCloud upload failed: ${res.status}`);}
    const data = await readBoundedJson<{
      result?: number;
      error?: string;
      fileids?: string[];
    } | null>(res);
    if (!data || typeof data.result !== "number")
      {throw new Error("pCloud upload returned malformed payload");}
    if (data.result !== 0)
      {throw new Error(`pCloud error: ${data.error || "unknown error"}`);}
    return typeof data?.fileids?.[0] === "string"
      ? data.fileids[0]
      : "unknown";
  }
  async downloadFile(id: string, signal?: AbortSignal): Promise<Buffer> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      "https://api.pcloud.com/getfile",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ auth: token, fileid: id }).toString(),
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`pCloud download failed: ${res.status}`);}
    const data = await readBoundedCloudResponse(res);
    return Buffer.from(data);
  }

  async deleteFile(id: string, signal?: AbortSignal): Promise<void> {
    const token = await this.authenticate(signal);
    const res = await cloudFetch(
      "https://api.pcloud.com/deletefile",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ auth: token, fileid: id }).toString(),
      },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {throw new Error(`pCloud delete failed: ${res.status}`);}
    const data = await readBoundedJson<{ result?: number; error?: string }>(res);
    if (data.result !== 0) {
      throw new Error(`pCloud delete failed: ${data.error || data.result}`);
    }
  }
}

export {
  DriveAdapter,
  DropboxAdapter,
  OneDriveAdapter,
  BoxAdapter,
  PCloudAdapter,
};
