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
        "Invalid remote backup encoding",
      );
    },
  );

  it("rejects a payload over the 100 MB decoded limit before allocation", () => {
    const oversized = "A".repeat(140 * 1024 * 1024);
    expect(() => decodeRemoteBackupBase64(oversized)).toThrow(
      "Remote backup exceeds the 100 MB limit",
    );
  });
});
