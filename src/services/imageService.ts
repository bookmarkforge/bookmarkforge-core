import { firewalledFetch } from "../utils/networkFirewall";
import { fetchWithAiSession } from "./ai/aiSession";
import { logger } from "../utils/logger";
import {
  cancelResponseBody,
  readBoundedResponseJson,
  readBoundedResponseText,
  sanitizeErrorMessage,
} from "./ai/utils";

/**
 * Generates an image based on the provided prompt.
 *
 * Security: Always routes through our backend (firewalledFetch) instead of
 * using the Google GenAI SDK directly. The SDK's internal fetch bypasses the
 * SSRF firewall and on-prem proxy. The backend proxies the request with full
 * firewall protection.
 *
 * @param prompt The text prompt to generate the image from.
 * @returns A promise resolving to a base64 encoded data URL of the generated image.
 * @throws Error if no image could be generated.
 */
const MAX_IMAGE_PROMPT_LENGTH = 20_000;
// Mirrors the server contract (ai-media.ts): a generated image up to 36 MiB
// of base64 is accepted upstream, so the client must accept exactly the same
// envelope instead of rejecting what the backend considers valid.
const MAX_IMAGE_BASE64_LENGTH = 36 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES = MAX_IMAGE_BASE64_LENGTH + 64 * 1024;

export const generateImage = async (prompt: string): Promise<string> => {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("Image prompt cannot be empty");
  }
  if (prompt.length > MAX_IMAGE_PROMPT_LENGTH) {
    throw new Error("Image prompt too long (max 20k characters)");
  }

  const response = await fetchWithAiSession(
    (sessionOptions) => firewalledFetch(
      "/api/services/ai/generate-image",
      sessionOptions,
      "image-generation",
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    },
  );

  if (!response.ok) {
    let errText = "";
    try {
      errText = await readBoundedResponseText(response, 64 * 1024);
    } catch {
      await cancelResponseBody(response);
    }
    logger.warn("[ImageService] Backend image generation failed", {
      status: response.status,
    });
    throw new Error(
      `Image generation failed: ${sanitizeErrorMessage(errText)}`,
    );
  }

  const data = await readBoundedResponseJson<{
    error?: unknown;
    imageBase64?: unknown;
  }>(response, MAX_IMAGE_RESPONSE_BYTES);
  if (data.error !== undefined) {
    throw new Error(sanitizeErrorMessage(String(data.error)));
  }
  if (typeof data.imageBase64 !== "string" || data.imageBase64.length === 0) {
    throw new Error("No image generated");
  }
  if (data.imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new Error("Generated image exceeds the 36 MB limit");
  }

  return data.imageBase64;
};
