// Ambient declarations for the extension's plain-JS surface (P-27).
// capture-url.js publishes its builder on globalThis; the MV3 service
// worker loads it via importScripts.

interface BookmarkForgeCaptureUrlApi {
  buildCaptureUrl(baseUrl: string, values: { url?: string; title?: string; text?: string }): string;
  createBookmarklet(baseUrl: string): string;
  normalizeBaseUrl(baseUrl: string): string;
  isValidBaseUrl(value: string): boolean;
}

declare global {
   
  var BookmarkForgeCaptureUrl: BookmarkForgeCaptureUrlApi | undefined;
  function importScripts(...urls: string[]): void;
}

export {};
