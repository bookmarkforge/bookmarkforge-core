import { describe, expect, it, vi } from "vitest";
import type { RxCollection } from "rxdb";
import type { BookmarkDocType } from "../../db/schema";
import {
  boundedBookmarkQuery,
  MAX_SELECT_ITEMS,
} from "../../utils/knowledgeCardBounds";

type FakeBookmark = Pick<BookmarkDocType, "id" | "updatedAt">;

describe("boundedBookmarkQuery", () => {
  it("sorts before limiting and materializes no more than the default cap", async () => {
    const vault: FakeBookmark[] = Array.from(
      { length: MAX_SELECT_ITEMS + 1 },
      (_, index) => ({
        id: `bookmark-${index}`,
        updatedAt: new Date(index).toISOString(),
      }),
    );
    let requestedLimit = 0;
    const exec = vi.fn(async () => vault.slice(0, requestedLimit));
    const limit = vi.fn((value: number) => {
      requestedLimit = value;
      return { exec };
    });
    const sort = vi.fn(() => ({ limit }));
    const find = vi.fn(() => ({ sort }));
    const collection = { find } as unknown as RxCollection<BookmarkDocType>;

    const result = await boundedBookmarkQuery(collection).exec();

    expect(find).toHaveBeenCalledWith();
    expect(sort).toHaveBeenCalledWith({ updatedAt: "desc" });
    expect(limit).toHaveBeenCalledWith(MAX_SELECT_ITEMS);
    expect(exec).toHaveBeenCalledOnce();
    expect(result).toHaveLength(MAX_SELECT_ITEMS);
    expect(vault).toHaveLength(MAX_SELECT_ITEMS + 1);
  });

  it("forwards a selector without changing the bounded query order", async () => {
    const exec = vi.fn(async () => [] as FakeBookmark[]);
    const limit = vi.fn(() => ({ exec }));
    const sort = vi.fn(() => ({ limit }));
    const find = vi.fn(() => ({ sort }));
    const collection = { find } as unknown as RxCollection<BookmarkDocType>;
    const selector = { isDeleted: false };

    await boundedBookmarkQuery(collection, 25, selector).exec();

    expect(find).toHaveBeenCalledWith({ selector });
    expect(sort).toHaveBeenCalledWith({ updatedAt: "desc" });
    expect(limit).toHaveBeenCalledWith(25);
  });
});
