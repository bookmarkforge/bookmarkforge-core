import { describe, expect, it } from "vitest";
import { decodeRemoteBackupBase64 } from "../../components/settings/CloudSyncSection";

describe("decodeRemoteBackupBase64", () => {
  it("decodes valid padded Base64", () => {
    expect(Array.from(decodeRemoteBackupBase64("SGk="))).toEqual([72, 105]);
  });

  it.each(["", "not base64!", "SGk", "SG=k", "SGk===", "SGk=extra"])(
    "rejects malformed Base64: %s",
    (value) => {
      expect(() => decodeRemoteBackupBase64(value)).toThrow(
        "The backup file is corrupted or not a valid BookmarkForge backup.",
      );
    },
  );

  it("rejects a payload over the 200 MB decoded limit before allocation", () => {
    const oversized = "A".repeat(280 * 1024 * 1024);
    expect(() => decodeRemoteBackupBase64(oversized)).toThrow(
      "The backup file is too large to restore. Please use a backup smaller than 200 MB.",
    );
  });
});
