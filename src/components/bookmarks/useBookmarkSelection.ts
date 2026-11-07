import { useState, useCallback, useRef } from "react";
import { Bookmark } from "../../types";

interface UseBookmarkSelectionProps {
  filteredBookmarks: Bookmark[];
}

interface UseBookmarkSelectionReturn {
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedIds: Set<string>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  handleSelectAll: () => void;
  handleSelect: (id: string) => void;
  handleToggleExpand: (id: string) => void;
  selectedRowRef: React.RefObject<HTMLTableRowElement | null>;
}

export function useBookmarkSelection({
  filteredBookmarks,
}: UseBookmarkSelectionProps): UseBookmarkSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);

  const handleSelectAll = useCallback(() => {
    if (filteredBookmarks.length === 0) {return;}

    const filteredIds = new Set(filteredBookmarks.map((b) => b.id));
    setSelectedIds((previous) => {
      const allFilteredSelected = filteredBookmarks.every((bookmark) =>
        previous.has(bookmark.id),
      );
      const next = new Set(previous);

      // Preserve selections outside the active search/tag filter. Clearing
      // everything here makes a filtered select-all unexpectedly destroy the
      // user's selection in other result pages.
      for (const id of filteredIds) {
        if (allFilteredSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }, [filteredBookmarks]);

  const handleSelect = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return {
    selectedIds,
    setSelectedIds,
    expandedIds,
    setExpandedIds,
    selectedIndex,
    setSelectedIndex,
    handleSelectAll,
    handleSelect,
    handleToggleExpand,
    selectedRowRef,
  };
}
