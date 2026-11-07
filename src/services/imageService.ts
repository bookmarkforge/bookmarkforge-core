import { GEMINI_API_BASE, AI_MODELS } from "../constants/config";
import { logger } from "../utils/logger";
import {
  cancelResponseBody,
  readBoundedResponseJson,
  readBoundedResponseText,
  sanitizeErrorMessage,
  fetchWithTimeout,
} from "./ai/utils";
import { securityVault, SECURE_STORAGE_KEYS } from "./SecurityVault";

function getGeminiApiHeaders(apiKey: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey ?? "",
  };
}

/**
 * Generates an image based on the provided prompt.
 *
 * Security: Calls the Gemini API directly instead of routing through
 * the eliminated proxy. The API key is read from the vault.
 *
 * @param prompt The text prompt to generate the image from.
 * @returns A promise resolving to a base64 encoded data URL of the generated image.
 * @throws Error if no image could be generated.
 */
const MAX_IMAGE_PROMPT_LENGTH = 20_000;
const MAX_IMAGE_BASE64_LENGTH = 36 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES = MAX_IMAGE_BASE64_LENGTH + 64 * 1024;

export const generateImage = async (prompt: string): Promise<string> => {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("Image prompt cannot be empty");
  }
  if (prompt.length > MAX_IMAGE_PROMPT_LENGTH) {
    throw new Error("Image prompt too long (max 20k characters)");
  }

  let apiKey: string | null = null;
  try {
    apiKey = await securityVault.decryptSecret(SECURE_STORAGE_KEYS.API_KEY);
  } catch {
    // best-effort; will result in a 401 from the API
  }

  const model = AI_MODELS.GEMINI_EXP;
  const response = await fetchWithTimeout(
    `${GEMINI_API_BASE}/${model}:generateContent`,
    {
      method: "POST",
      headers: getGeminiApiHeaders(apiKey),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["image"] },
      }),
    },
  );

  if (!response.ok) {
    let errText = "";
    try { errText = await readBoundedResponseText(response, 64 * 1024); } catch {
      await cancelResponseBody(response);
    }
    logger.warn("[ImageService] Gemini image generation failed", {
      status: response.status,
    });
    throw new Error(
      `Image generation failed: ${sanitizeErrorMessage(errText)}`,
    );
  }

  const data = await readBoundedResponseJson<{
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
      };
    }>;
    error?: unknown;
  }>(response, MAX_IMAGE_RESPONSE_BYTES);
  if (data.error !== undefined) {
    throw new Error(sanitizeErrorMessage(String(data.error)));
  }
  const parts = data.candidates?.[0]?.content?.parts;
  const inlineData = parts?.[0]?.inlineData;
  const imageBase64 = inlineData?.data;
  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    throw new Error("No image generated");
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new Error("Generated image exceeds the 36 MB limit");
  }

  // The Gemini API returns bare base64 in `inlineData`. Callers (the editor
  // toolbar) feed this straight into an <img>/markdown URL, so the data-URL
  // wrapper has to be built here — the documented contract of this function.
  if (imageBase64.startsWith("data:")) {return imageBase64;}
  const mimeType =
    typeof inlineData?.mimeType === "string" &&
    inlineData.mimeType.startsWith("image/")
      ? inlineData.mimeType
      : "image/png";
  return `data:${mimeType};base64,${imageBase64}`;
};