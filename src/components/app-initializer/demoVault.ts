import { generateId } from "../../utils/id";
import { initDB } from "../../container/database";
import { logger } from "../../utils/logger";
import { safeGet, safeSet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";

export async function createDemoVault() {
  try {
    // P93: never inject demo content into a real user's vault. The demo seed
    // only runs when the user EXPLICITLY opted into demo mode (?demo=true
    // param or the DEMO_ACTIVE flag) — the same gate the AppInitializer
    // demo-unlock path uses. A fresh real vault must start empty and honest.
    const isDemoParam =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "true";
    const isDemoActive =
      safeGet(STORAGE_KEYS.DEMO_ACTIVE) === "true" || isDemoParam;
    if (!isDemoActive) {
      logger.info("[Onboarding] Skipping Demo Vault — not in demo mode");
      return;
    }

    const db = await initDB();
    if (safeGet(STORAGE_KEYS.DEMO_VAULT_CREATED) === "true") {
      return;
    }

    // Typed access for the demo-vault onboarding path. The collections
    // shape below mirrors what `initDB()` returns at runtime — we
    // don't need full RxDB generic fidelity here, just enough to satisfy
    // TS narrowing for `find()` / `insert()` across the demo seed.
    type DemoVaultCol = {
      find: () => { exec: () => Promise<{ length: number }> };
      insert: (doc: unknown) => Promise<unknown>;
    };
    const dbTyped = db as unknown as {
      collections: {
        documents?: DemoVaultCol;
        bookmarks?: DemoVaultCol;
        flashcards?: DemoVaultCol;
      };
      documents?: DemoVaultCol;
      bookmarks?: DemoVaultCol;
      flashcards?: DemoVaultCol;
    };
    const documentsCol =
      dbTyped.collections.documents || dbTyped.documents;
    const bookmarksCol =
      dbTyped.collections.bookmarks || dbTyped.bookmarks;
    const flashcardsCol =
      dbTyped.collections.flashcards || dbTyped.flashcards;

    if (!documentsCol || !bookmarksCol) {
      logger.error("[Onboarding] Collections not found on DB instance");
      return;
    }

    const docCount = await documentsCol
      .find()
      .exec()
      .then((docs: unknown) => (docs as { length: number }).length);
    const bookmarkCount = await bookmarksCol
      .find()
      .exec()
      .then((bms: unknown) => (bms as { length: number }).length);

    if (docCount === 0 && bookmarkCount === 0) {
      logger.info("[Onboarding] Empty database detected. Creating Demo Vault.");

      const docId = generateId();
      await documentsCol.insert({
        id: docId,
        folderId: "root",
        title: "👋 Welcome to your Digital Brain",
        textContent:
          "BookmarkForge is your local-first, AI-powered knowledge base. Everything here runs on your device, ensuring total privacy. Try the AI Assistant or semantic search!",
        blocks: [
          {
            type: "heading",
            props: { level: 1 },
            content: "Welcome to BookmarkForge 🚀",
          },
          {
            type: "paragraph",
            content:
              "BookmarkForge is your local-first, AI-powered knowledge base.",
          },
          {
            type: "paragraph",
            content:
              "Try using the **AI Copilot** by typing `/` or highlighting text. Your data never leaves your device unless you use a cloud provider.",
          },
          { type: "heading", props: { level: 2 }, content: "Features to try:" },
          { type: "bulletListItem", content: "💬 Local AI Chat (RAG)" },
          {
            type: "bulletListItem",
            content: "🧠 Semantic Search (meaning-based search)",
          },
          { type: "bulletListItem", content: "✂️ Web Clipper" },
          {
            type: "bulletListItem",
            content: "🔒 Military-grade AES-GCM encryption",
          },
        ],
        tags: ["welcome", "guide"],
        links: [],
        embedding: [],
        isPrivate: false,
        processed: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const bookmarks = [
        {
          id: generateId(),
          url: "https://en.wikipedia.org/wiki/Local-first_software",
          title: "Local-first software - Wikipedia",
          content:
            "Local-first software is a set of principles for software that enables both collaboration and ownership for users.",
          summary:
            "An overview of local-first software principles focusing on privacy, offline capabilities, and data ownership.",
          tags: ["architecture", "privacy"],
          relatedLinks: [],
          embedding: [],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: generateId(),
          url: "https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API",
          title: "WebGPU API - Web APIs | MDN",
          content:
            "The WebGPU API enables web developers to use the underlying system's GPU for high-performance computations.",
          summary:
            "Documentation for WebGPU, a modern API for high-performance graphics and computation in the browser.",
          tags: ["webdev", "ai", "gpu"],
          relatedLinks: [],
          embedding: [],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      await Promise.all(bookmarks.map((bm) => bookmarksCol.insert(bm)));

      if (flashcardsCol) {
        const flashcards = [
          {
            id: generateId(),
            documentId: docId,
            sourceType: "document",
            question: "What is the main advantage of Local-First software?",
            answer:
              "It enables offline work, high performance, and absolute data privacy since the database lives on the user's device.",
            nextReview: new Date().toISOString(),
            interval: 0,
            easeFactor: 2.5,
            repetition: 0,
            createdAt: new Date().toISOString(),
          },
          {
            id: generateId(),
            documentId: docId,
            sourceType: "document",
            question:
              "Does BookmarkForge use a central cloud database to store my notes?",
            answer:
              "No. The IndexedDB database lives exclusively on your hard drive, providing 100% data sovereignty.",
            nextReview: new Date().toISOString(),
            interval: 0,
            easeFactor: 2.5,
            repetition: 0,
            createdAt: new Date().toISOString(),
          },
        ];
        await Promise.all(flashcards.map((card) => flashcardsCol.insert(card)));
      }

      safeSet(STORAGE_KEYS.DEMO_VAULT_CREATED, "true");
      logger.info("[Onboarding] Demo Vault created successfully");
    }
  } catch (error: unknown) {
    logger.error("[Onboarding] Failed to create Demo Vault", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
