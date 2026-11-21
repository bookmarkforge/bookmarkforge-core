/**
 * useAppUrlActions.ts — one-shot URL param actions for the app shell.
 *
 * Consumed once per document mount (MainApp only renders after the vault is
 * unlocked, so locked-vault deliveries simply wait in the URL until this
 * effect runs):
 *
 *   ?action=paste        → read the OS clipboard into quick capture
 *   ?action=new-note     → open quick capture empty (note flow)
 *   ?action=flashcards   → open the flashcard review overlay
 *   ?q=<terms>           → open the Omnibar seeded with the query
 *                          (OpenSearch / opensearch.xml target)
 *
 * Params are stripped via history.replaceState AFTER handling so a reload
 * does not replay the action and the query never lingers in history.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { requestQuickCapture } from "./clipboard";
import { readClipboardAndCapture } from "./readClipboard";

export interface AppUrlActionsDeps {
  setShowOmnibar: (show: boolean) => void;
  setShowFlashcards: (show: boolean) => void;
  setOmnibarQuery: (query: string | null) => void;
}

const HANDLED_PARAMS = ["action", "q"];

export function useAppUrlActions({
  setShowOmnibar,
  setShowFlashcards,
  setOmnibarQuery,
}: AppUrlActionsDeps): void {
  const { t } = useTranslation();
  const tRef = useRef<TFunction>(t);
  tRef.current = t;
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current || typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    const query = params.get("q");
    const hasAction = action !== null && HANDLED_ACTIONS.has(action);
    const hasQuery = query !== null && query.trim().length > 0;
    if (!hasAction && !hasQuery) {
      return;
    }
    handledRef.current = true;

    if (hasQuery) {
      setOmnibarQuery(query!.trim());
      setShowOmnibar(true);
    }
    if (hasAction) {
      switch (action) {
        case "paste":
          void readClipboardAndCapture(tRef.current);
          break;
        case "new-note":
          requestQuickCapture();
          break;
        case "flashcards":
          setShowFlashcards(true);
          break;
        case "search":
          setShowOmnibar(true);
          break;
      }
    }

    // Strip only the params we consumed; leave everything else (e.g.
    // ?demo=, ?reset=) untouched for the initializers that own them.
    const url = new URL(window.location.href);
    for (const key of HANDLED_PARAMS) {
      url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url.toString());
    // Mount-once by design: URL actions are a single delivery per document.
  }, []);
}

const HANDLED_ACTIONS = new Set(["paste", "new-note", "flashcards", "search"]);
