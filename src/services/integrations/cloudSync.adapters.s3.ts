import { firewalledFetch } from "../../utils/networkFirewall";
import { readBoundedCloudResponse } from "./cloudSync.response";
import type { CloudProviderAdapter } from "./cloudSync.adapters.types";

export interface S3Config {
  /** S3-compatible endpoint, e.g. https://s3.amazonaws.com or https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  /** AWS region used for the SigV4 credential scope, e.g. us-east-1. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

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

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => {
    return `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: Uint8Array,
  data: string,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
  return new Uint8Array(signature);
}

interface S3SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/**
 * Builds an AWS Signature V4 signed S3 request. `objectKey` is the object
 * path within the bucket (no leading slash). `payload` is the request body
 * (empty string for GET).
 */
export async function signS3Request(
  config: S3Config,
  method: "PUT" | "GET" | "DELETE",
  objectKey: string,
  payload: string | null,
  contentType?: string,
): Promise<S3SignedRequest> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(config.endpoint).host;
  const bucket = config.bucket.replace(/^\/+|\/+$/g, "");
  const segments = objectKey.split("/").filter((s) => s.length > 0);
  const canonicalUri =
    "/" +
    [bucket, ...segments.map((s) => encodeRfc3986(s))].join("/");

  const body = payload ?? "";
  const payloadHash = await sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) {
    headers["content-type"] = contentType;
  }

  const headerEntries = Object.entries(headers).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const canonicalHeaders = headerEntries
    .map(([name, value]) => `${name}:${value.trim()}\n`)
    .join("");
  const signedHeaders = headerEntries.map(([name]) => name).join(";");

  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(
    new TextEncoder().encode(`AWS4${config.secretAccessKey}`),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, config.region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signatureBytes = await hmacSha256(kSigning, stringToSign);
  const signature = Array.from(signatureBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${config.endpoint.replace(/\/+$/, "")}${canonicalUri}`,
    headers: { ...headers, authorization },
    body: body || null,
  };
}

class S3Adapter implements CloudProviderAdapter {
  providerName = "s3" as const;
  constructor(private config?: S3Config) {}

  async authenticate(_signal?: AbortSignal): Promise<string> {
    if (!this.config?.accessKeyId) {
      throw new Error("S3Adapter: missing access key id");
    }
    return this.config.accessKeyId;
  }

  private async ensureConfig(): Promise<S3Config> {
    const cfg = this.config;
    if (!cfg?.endpoint || !cfg?.bucket || !cfg?.region) {
      throw new Error("S3Adapter: missing configuration");
    }
    return cfg;
  }

  async listFiles(signal?: AbortSignal): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  > {
    const config = await this.ensureConfig();
    const req = await signS3Request(
      config,
      "GET",
      "",
      "",
      undefined,
    );
    const res = await cloudFetch(req.url, { headers: req.headers }, "cloud-sync", signal);
    if (!res.ok) {
      throw new Error(`S3 list_files failed: ${res.status} ${res.statusText}`);
    }
    const data = await readBoundedCloudResponse(res);
    // ListObjectsV2 XML — extract <Key> entries. Parsing the full XML is
    // overkill for the backup use case (a single object per destination).
    const text = new TextDecoder().decode(data);
    const keys = Array.from(text.matchAll(/<Key>([^<]+)<\/Key>/g)).map((m) => m[1]);
    return keys
      .filter((k): k is string => typeof k === "string" && k.length > 0)
      .map((key) => ({
        id: key,
        name: key.split("/").pop() ?? key,
      }));
  }

  async uploadFile(
    path: string,
    content: string | Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const config = await this.ensureConfig();
    const fileName = path.split("/").pop() ?? "data.json";
    const body = typeof content === "string" ? content : content.toString();
    const req = await signS3Request(
      config,
      "PUT",
      fileName,
      body,
      mimeType || "application/octet-stream",
    );
    const res = await cloudFetch(
      req.url,
      { method: "PUT", headers: req.headers, body: req.body ?? "" },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {
      throw new Error(`S3 upload failed: ${res.status} ${res.statusText}`);
    }
    return fileName;
  }

  async downloadFile(id: string, signal?: AbortSignal): Promise<Buffer> {
    const config = await this.ensureConfig();
    const req = await signS3Request(config, "GET", id, "", undefined);
    const res = await cloudFetch(req.url, { headers: req.headers }, "cloud-sync", signal);
    if (!res.ok) {
      throw new Error(`S3 download failed: ${res.status} ${res.statusText}`);
    }
    const data = await readBoundedCloudResponse(res);
    return Buffer.from(data);
  }

  async deleteFile(id: string, signal?: AbortSignal): Promise<void> {
    const config = await this.ensureConfig();
    const req = await signS3Request(config, "DELETE", id, "", undefined);
    const res = await cloudFetch(
      req.url,
      { method: "DELETE", headers: req.headers },
      "cloud-sync",
      signal,
    );
    if (!res.ok) {
      throw new Error(`S3 delete failed: ${res.status}`);
    }
  }
}

export { S3Adapter };
