import { useState, useEffect, useMemo, useRef } from "react";
import { Bookmark } from "../../types";
import {
  ragEngine,
  type BookmarkWithSimilarity,
} from "../../services/ai/RAGEngine";
import { logger } from "../../utils/logger";
import {
  runWithTimeout,
  semanticSearchService,
} from "../../services/ai/SemanticSearchService";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";

interface UseBookmarkSearchProps {
  bookmarks: Bookmark[];
  ragEngine: typeof ragEngine;
}

interface LoweredFields {
  title: string;
  url: string;
  summary: string;
  content: string;
  tags: string[];
}

interface UseBookmarkSearchReturn {
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  isSemanticSearch: boolean;
  setIsSemanticSearch: React.Dispatch<React.SetStateAction<boolean>>;
  isSearching: boolean;
  semanticSearchError: boolean;
  filteredBookmarks: Bookmark[];
  selectedTags: string[];
  setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useBookmarkSearch({
  bookmarks,
}: UseBookmarkSearchProps): UseBookmarkSearchReturn {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSemanticSearch, setIsSemanticSearch] = useState(false);
  const [semanticResults, setSemanticResults] = useState<
    BookmarkWithSimilarity[] | null
  >(null);
  const [semanticSearchError, setSemanticSearchError] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // Semantic search is a refresh-style data-load: a newer query supersedes
  // the in-flight one. autoLoad off — the debounce effect drives the trigger;
  // its else branch calls cancel (the fixed cancel resets the loading flag)
  // instead of load() so the spinner never flashes for the no-op path.
  const {
    load,
    loading: isSearching,
    cancel: cancelSearch,
  } = useGuardedDataLoad<BookmarkWithSimilarity[] | null>(
    async (signal) => {
      const expandedQuery = await runWithTimeout(
        (searchSignal) =>
          semanticSearchService.expandQuery(
            debouncedSearchQuery,
            searchSignal,
          ),
        8_000,
        signal,
      );
      if (signal.aborted) {return null;}
      return runWithTimeout(
        (searchSignal) =>
          ragEngine.searchSimilar(
            expandedQuery,
            bookmarks,
            20,
            searchSignal,
          ),
        15_000,
        signal,
      );
    },
    {
      autoLoad: false,
      initialLoading: false,
      onSuccess: (results) => {
        setSemanticSearchError(false);
        setSemanticResults(results);
      },
      onError: (err) => {
        setSemanticSearchError(true);
        // Do not let results from a previous query remain visible after a
        // failed expansion/embedding request. The regular text matcher below
        // is the safe fallback for the current query.
        setSemanticResults(null);
        logger.error("[useBookmarkSearch] Semantic search failed", {
          error: err,
        });
      },
    },
  );

  // Lazy cache of lowercased fields, keyed by the `bookmarks` reference:
  // the text scan lowercases title/url/summary/content (content can be KBs)
  // of EVERY bookmark on EVERY query — with 100k items that blocks the main
  // thread on every typing pause. Built on the first search and reused while
  // the data does not change.
  const loweredIndexRef = useRef<{
    key: Bookmark[];
    map: Map<string, LoweredFields>;
  } | null>(null);

  const getLoweredMap = (): Map<string, LoweredFields> => {
    const cached = loweredIndexRef.current;
    if (cached && cached.key === bookmarks) {
      return cached.map;
    }
    const map = new Map<string, LoweredFields>();
    for (const b of bookmarks) {
      map.set(b.id, {
        title: b.title?.toLowerCase() ?? "",
        url: b.url?.toLowerCase() ?? "",
        summary: b.summary?.toLowerCase() ?? "",
        content: b.content?.toLowerCase() ?? "",
        tags: (b.tags ?? []).map((tag) => tag.toLowerCase()),
      });
    }
    loweredIndexRef.current = { key: bookmarks, map };
    return map;
  };

  // Clearing the search discards the cache: keeping twice the dataset
  // lowercased indefinitely is not worth it in a local-first app.
  useEffect(() => {
    if (!debouncedSearchQuery.trim()) {
      loweredIndexRef.current = null;
    }
  }, [debouncedSearchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (isSemanticSearch) {
      void ragEngine.prefetch();
    }
  }, [isSemanticSearch]);

  useEffect(() => {
    if (isSemanticSearch && debouncedSearchQuery.trim().length > 2) {
      setSemanticSearchError(false);
      // Clear the previous semantic result set before starting a new query;
      // otherwise the old result order can be rendered while the new request
      // is still expanding or embedding.
      setSemanticResults(null);
      void load();
    } else {
      // cancelSearch invalidates any in-flight expansion/search (its late
      // result is dropped) and resets the loading flag.
      cancelSearch();
      setSemanticSearchError(false);
      setSemanticResults(null);
    }
  }, [debouncedSearchQuery, isSemanticSearch, bookmarks, load, cancelSearch]);

  const filteredBookmarks = useMemo(() => {
    let results = bookmarks;

    if (selectedTags.length > 0) {
      results = results.filter((b) =>
        selectedTags.every((tag) => b.tags?.includes(tag)),
      );
    }

    if (!debouncedSearchQuery.trim()) {
      return results;
    }

    const query = debouncedSearchQuery.toLowerCase();

    // Text search with the cache: `results` is always a subset of
    // `bookmarks` (filters/tags), so every id is in the map; the `false`
    // for the impossible case is defensive.
    const loweredMap = getLoweredMap();
    const textMatches = (results: Bookmark[]): Bookmark[] =>
      results.filter((bookmark) => {
        const l = loweredMap.get(bookmark.id);
        if (!l) {
          return false;
        }
        return (
          l.title.includes(query) ||
          l.url.includes(query) ||
          l.summary.includes(query) ||
          l.content.includes(query) ||
          l.tags.some((tag) => tag.includes(query))
        );
      });

    // O(n+m) with Set: semantic results must remain inside the active tag
    // filter. Without this boundary, a semantic hit from another tag could
    // bypass the user's selected filters.
    const resultIds = new Set<string>();
    for (const r of results) {
      resultIds.add(r.id);
    }

    // Hybrid search: combine text matches + semantic matches. Text matches
    // remain first because they are explicit keyword hits.
    if (isSemanticSearch && semanticResults && semanticResults.length > 0) {
      const matches = textMatches(results);

      const hybridResults: Bookmark[] = [];
      const seen = new Set<string>();

      for (const b of matches) {
        hybridResults.push(b);
        seen.add(b.id);
      }

      for (const bm of semanticResults) {
        if (resultIds.has(bm.id) && !seen.has(bm.id)) {
          hybridResults.push(bm);
          seen.add(bm.id);
        }
      }

      return hybridResults;
    }

    // An empty semantic result is not a reason to hide exact text matches;
    // use the same text fallback as the document search.
    if (semanticResults && semanticResults.length > 0) {
      return semanticResults.filter((b) => resultIds.has(b.id));
    }

    return textMatches(results);
  }, [
    bookmarks,
    debouncedSearchQuery,
    semanticResults,
    selectedTags,
    isSemanticSearch,
  ]);

  return {
    searchQuery,
    setSearchQuery,
    isSemanticSearch,
    setIsSemanticSearch,
    isSearching,
    semanticSearchError,
    filteredBookmarks: filteredBookmarks as Bookmark[],
    selectedTags,
    setSelectedTags,
  };
}
