export interface Bookmark {
  id: string;
  url: string;
  urlHash: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  relatedLinks: string[];
  embedding: number[];
  processed: boolean;
  isPrivate: boolean;
  isDeleted: boolean;
  broken?: boolean;
  lastChecked?: string;
  visitCount: number;
  lastVisitedAt?: string;
  isRead?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  folderId: string;
  title: string;
  blocks: unknown[];
  textContent: string;
  summary: string;
  tags: string[];
  links: string[];
  embedding: number[];
  processed: boolean;
  isPrivate: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

// Type for creating new bookmarks (partial fields)
export interface Folder {
  id: string;
  title: string;
  parentId?: string;
  createdAt: string;
}

// Type for i18n translation function
export type TranslationFunction = (
  key: string,
  options?: Record<string, string | number | boolean>,
) => string;

// Type for RxDB subscription
export interface RxDBSubscription {
  unsubscribe: () => void;
}

// Type for AI Manager (ProviderManager interface)
export interface AIManager {
  generateText: (
    prompt: string,
    systemPrompt?: string,
    options?: {
      complexity?: "simple" | "complex";
      isPrivate?: boolean;
      model?: string;
      responseMimeType?: string;
      responseSchema?: Record<string, unknown>;
      tools?: Record<string, unknown>[];
      signal?: AbortSignal;
    },
  ) => Promise<{ text: string; provider: string }>;
  getProviderInfo: () => { provider: string; model: string };
}
