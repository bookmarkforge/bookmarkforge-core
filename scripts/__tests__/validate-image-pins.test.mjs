import { describe, it, expect } from "vitest";
import { validateImagePins } from "../validate-image-pins.mjs";

describe("validate-image-pins", () => {
  it("passes when all images are pinned by digest", () => {
    const result = validateImagePins(
      "FROM node:20-alpine@sha256:abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\n" +
        "FROM nginx:1.27-alpine@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef AS web\n",
    );
    expect(result.errors).toHaveLength(0);
    expect(result.checked).toBe(2);
  });

  it("fails on tag-only image without digest", () => {
    const result = validateImagePins("FROM node:20-alpine\n");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].image).toBe("node:20-alpine");
  });

  it("fails on :latest tag without digest", () => {
    const result = validateImagePins("    image: ollama/ollama:latest\n");
    expect(result.errors).toHaveLength(1);
  });

  it("exempts project-built images (bookmarkforge/*)", () => {
    const result = validateImagePins("    image: bookmarkforge/web:staging\n");
    expect(result.errors).toHaveLength(0);
    expect(result.checked).toBe(1);
  });

  it("exempts build-arg parameterized images", () => {
    const result = validateImagePins(
      '    image: bookmarkforge/web:${IMAGE_TAG:-staging}\n',
    );
    expect(result.errors).toHaveLength(0);
  });

  it("exempts multi-stage build aliases (FROM base AS deps)", () => {
    const result = validateImagePins("FROM base AS deps\n");
    expect(result.errors).toHaveLength(0);
    expect(result.checked).toBe(0);
  });

  it("parses compose image: keys with quotes", () => {
    const result = validateImagePins(
      '    image: "redis:7-alpine"\n',
    );
    expect(result.errors).toHaveLength(1);
    expect(result.checked).toBe(1);
  });

  it("accepts tagless digest-only pins", () => {
    const result = validateImagePins(
      "FROM ghcr.io/owner/repo@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\n",
    );
    expect(result.errors).toHaveLength(0);
    expect(result.checked).toBe(1);
  });

  it("detects multiple unpinned images in a compose file", () => {
    const result = validateImagePins(
      '    image: "redis:7-alpine"\n' +
        '    image: "ollama/ollama:latest"\n' +
        '    image: "node:22-alpine"\n' +
        '    image: bookmarkforge/api:${IMAGE_TAG:-staging}\n',
    );
    expect(result.errors).toHaveLength(3);
    expect(result.checked).toBe(4);
  });

  it("passes on a fully pinned compose snippet", () => {
    const result = validateImagePins(
      '    image: "redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf"\n' +
        '    image: "ollama/ollama:latest@sha256:020e4134285e2ef4d8fd801234176de3b4faadc992a3eb06c8e66a2f9d4c4ba2"\n' +
        '    image: "node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32"\n' +
        '    image: bookmarkforge/web:${IMAGE_TAG:-staging}\n',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.checked).toBe(4);
  });
});
