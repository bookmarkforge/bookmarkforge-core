import type { CloudProvider } from "./cloudSync.types";
import type { CloudProviderAdapter } from "./cloudSync.adapters.types";
import {
  DriveAdapter,
  DropboxAdapter,
  OneDriveAdapter,
  BoxAdapter,
  PCloudAdapter,
} from "./cloudSync.adapters.token";
import { WebDAVAdapter } from "./cloudSync.adapters.config";
import { S3Adapter, type S3Config } from "./cloudSync.adapters.s3";

export function getErrorMessage(e: unknown, fallback = ""): string {
  if (e instanceof Error) {return e.message;}
  if (e && typeof e === "object" && "message" in e)
    {return String((e as { message: string }).message);}
  return fallback || String(e);
}

export function createAdapter(
  provider: CloudProvider,
  token?: string,
  config?: Record<string, unknown>,
): CloudProviderAdapter {
  switch (provider) {
    case "drive":
      return new DriveAdapter(token);
    case "dropbox":
      return new DropboxAdapter(token);
    case "onedrive":
      return new OneDriveAdapter(token);
    case "box":
      return new BoxAdapter(token);
    case "pcloud":
      return new PCloudAdapter(token);
    case "s3":
      return new S3Adapter(config as unknown as S3Config);
    case "webdav":
      return new WebDAVAdapter(
        config as { url: string; username?: string; password?: string },
      );
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
