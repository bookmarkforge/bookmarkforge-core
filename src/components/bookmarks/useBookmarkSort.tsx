import { useState, useMemo, useCallback, useTransition } from "react";
import { Bookmark } from "../../types";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

type SortField = "title" | "url" | "createdAt" | "updatedAt";

interface UseBookmarkSortProps {
  bookmarks: Bookmark[];
}

interface UseBookmarkSortReturn {
  sortField: SortField;
  setSortField: React.Dispatch<React.SetStateAction<SortField>>;
  sortDirection: "asc" | "desc";
  setSortDirection: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
  sortedBookmarks: Bookmark[];
  handleSort: (field: SortField) => void;
  SortIcon: React.FC<{
    field: SortField;
    currentField: SortField;
    direction: "asc" | "desc";
  }>;
}

const SortIcon: React.FC<{
  field: SortField;
  currentField: SortField;
  direction: "asc" | "desc";
}> = ({ field, currentField, direction }) => {
  if (currentField !== field) {
    return (
      <ArrowUpDown className="size-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
    );
  }
  return direction === "asc" ? (
    <ArrowUp className="size-3 text-blue-500" />
  ) : (
    <ArrowDown className="size-3 text-blue-500" />
  );
};

export function useBookmarkSort({
  bookmarks,
}: UseBookmarkSortProps): UseBookmarkSortReturn {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [, startTransition] = useTransition();

  const sortedBookmarks = useMemo(() => {
    // Fast path: `useBookmarkData` subscribes with `.sort({ createdAt: "desc" })`,
    // so RxDB already delivers the array in that order, and the
    // search/tag filters preserve it. For the default sort, verify (O(n))
    // that the array is already sorted and return it as-is — this saves the
    // 100k spread and the TimSort on every data emission. The verification
    // is essential: tests and other callers may pass arrays in any order
    // (and the hybrid semantic merge re-sorts). Equality between adjacent
    // items does not break the order (stable comparator: returns 0).
    if (sortField === "createdAt" && sortDirection === "desc") {
      let alreadySorted = true;
      for (let i = 1; i < bookmarks.length; i++) {
        if (
          // i-1 >= 0 and i < bookmarks.length by the loop bound, so both
          // accesses are in-bounds; `!` narrows the index-signature type.
          (bookmarks[i - 1]!.createdAt || "") < (bookmarks[i]!.createdAt || "")
        ) {
          alreadySorted = false;
          break;
        }
      }
      if (alreadySorted) {
        return bookmarks;
      }
    }

    // Title/URL sorting: decorate once with the lowercased value
    // instead of re-lowercasing on every comparison (the comparator runs
    // ~n·log n times; with 100k bookmarks that was ~3.4M repeated lowercasing).
    if (sortField === "title" || sortField === "url") {
      const decorated = bookmarks.map((b) => ({
        bookmark: b,
        val: String(b[sortField] || "").toLowerCase(),
      }));
      decorated.sort((x, y) => {
        if (x.val < y.val) {
          return sortDirection === "asc" ? -1 : 1;
        }
        if (x.val > y.val) {
          return sortDirection === "asc" ? 1 : -1;
        }
        return 0;
      });
      return decorated.map((d) => d.bookmark);
    }

    return [...bookmarks].sort((a, b) => {
      const aVal = a[sortField] || "";
      const bVal = b[sortField] || "";
      if (aVal < bVal) {
        return sortDirection === "asc" ? -1 : 1;
      }
      if (aVal > bVal) {
        return sortDirection === "asc" ? 1 : -1;
      }
      return 0;
    });
  }, [bookmarks, sortField, sortDirection]);

  const handleSort = useCallback(
    (field: SortField) => {
      startTransition(() => {
        if (sortField === field) {
          setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
          setSortField(field);
          setSortDirection("asc");
        }
      });
    },
    [sortField, sortDirection, startTransition],
  );

  return {
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    sortedBookmarks,
    handleSort,
    SortIcon,
  };
}
