import type { CloudProvider } from "./cloudSync.types";

export interface CloudProviderAdapter {
  providerName: CloudProvider;
  authenticate(signal?: AbortSignal): Promise<string>;
  listFiles(signal?: AbortSignal): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  >;
  uploadFile(
    path: string,
    content: string | Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string>;
  downloadFile(id: string, signal?: AbortSignal): Promise<Buffer>;
  /** Optional provider-side deletion used by remote retention. */
  deleteFile?(id: string, signal?: AbortSignal): Promise<void>;
}
