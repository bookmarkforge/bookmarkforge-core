import { ChatMessage } from "../services/ai/types";

declare global {
  interface Window {
    puter?: PuterAI;
  }
}

interface PuterAI {
  ai: {
    chat: (
      messages: ChatMessage[],
      options?: { model?: string },
    ) => Promise<{ text: string }>;
  };
}

export {};
