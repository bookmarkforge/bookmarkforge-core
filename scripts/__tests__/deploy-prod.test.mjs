import { describe, expect, it } from "vitest";
import {
  calculateImageTag,
  selectProductionTag,
  shouldBuildImages,
} from "../deploy-prod.mjs";

describe("selectProductionTag", () => {
  it("selects the newest production tag", () => {
    expect(selectProductionTag(["prod-20260827-2300-a1b2c3d", "prod-20260827-2200-deadbee"])).toBe("prod-20260827-2300-a1b2c3d");
  });

  it("ignores non-production tags and invalid input", () => {
    expect(selectProductionTag(["v1.0.0", "release-x", "prod-current"])).toBe("prod-current");
    expect(selectProductionTag(null)).toBeNull();
  });
});

describe("calculateImageTag", () => {
  it("prefers an explicit IMAGE_TAG", () => {
    expect(calculateImageTag({ imageTag: "a1b2c3d", gitSha: "deadbee" })).toBe("a1b2c3d");
  });

  it("falls back to the git SHA or dry-run placeholder", () => {
    expect(calculateImageTag({ gitSha: "deadbee" })).toBe("deadbee");
    expect(calculateImageTag({ dryRun: true })).toBe("deadbeef");
  });

  it("rejects malformed image tags", () => {
    expect(calculateImageTag({ imageTag: "not-a-sha" })).toBe("");
  });
});

describe("isAnnotatedTagType", () => {
  it("accepts only the annotated tag object type", async () => {
    const { isAnnotatedTagType } = await import("../deploy-prod.mjs");
    expect(isAnnotatedTagType("tag")).toBe(true);
    expect(isAnnotatedTagType("commit")).toBe(false);
    expect(isAnnotatedTagType("")).toBe(false);
  });
});

describe("shouldBuildImages", () => {
  it("builds by default and marks dry-run simulation", () => {
    expect(shouldBuildImages({ imageTag: "a1b2c3d" })).toEqual({
      build: true,
      simulated: false,
      imageTag: "a1b2c3d",
    });
    expect(shouldBuildImages({ noDocker: false, dryRun: true, imageTag: "a1b2c3d" })).toEqual({
      build: true,
      simulated: true,
      imageTag: "a1b2c3d",
    });
  });

  it("skips builds with --no-docker", () => {
    expect(shouldBuildImages({ noDocker: true, imageTag: "a1b2c3d" })).toEqual({
      build: false,
      simulated: false,
      imageTag: "a1b2c3d",
    });
  });
});
