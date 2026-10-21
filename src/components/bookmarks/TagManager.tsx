import React from "react";
import { X, Plus, Tag, Sparkles, Loader2, Palette } from "lucide-react";
import { useState, useRef, useEffect, useMemo, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { aiManager } from "../../services/ai/ProviderManager";
import { tagColorService } from "../../services/TagColorService";
import { sanitizeTags } from "../../services/SanitizationService";
import { logger } from "../../utils/logger";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { generateWithPrivacy } from "../../services/ai/privacy";

function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#1f2937" : "#ffffff";
}

export const TagManager = ({
    tags,
    allTags,
    onAddTag,
    onRemoveTag,
    content,
    // Content without an explicit privacy decision is treated as private.
    isPrivate = true,
  }: {
    tags: string[];
    allTags: string[];
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
    content?: string;
    isPrivate?: boolean;
  }) => {
    const { t } = useTranslation();
    const [isAdding, setIsAdding] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionClickedRef = useRef(false);
    const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
    const [showColorPicker, setShowColorPicker] = useState<string | null>(null);
    // Content/tags-driven suggestion load: a newer run (content/tags change)
    // supersedes the in-flight one via the guard. autoLoad off — the effect
    // drives the trigger; its short-content path calls cancel (the fixed
    // cancel resets the loading flag) so the spinner never flashes.
    const {
      load,
      loading: isGeneratingSuggestions,
      cancel,
    } = useGuardedDataLoad<string[]>(
      async (signal) => {
        if (!content) {return [];}
        const prompt = `Suggest 3-5 relevant tags (max 2 words each, lowercase, comma-separated) for this content: ${content.substring(0, 500)}`;
        const response = await generateWithPrivacy(
          aiManager,
          { isPrivate },
          prompt,
          undefined,
          { signal },
        );
        if (signal.aborted) {return [];}
        return response.text
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0 && t.length < 20 && !tags.includes(t))
          .slice(0, 5);
      },
      {
        autoLoad: false,
        initialLoading: false,
        onSuccess: (suggestedTags) => setAiSuggestions(suggestedTags),
        onError: (error) =>
          logger.error("Failed to generate AI suggestions:", error),
      },
    );

    const suggestions = useMemo(
      () =>
        allTags
          .filter(
            (t) =>
              t.toLowerCase().includes(inputValue.toLowerCase()) &&
              !tags.includes(t),
          )
          .slice(0, 5),
      [allTags, inputValue, tags],
    );

    useEffect(() => {
      if (!content || content.length < 50) {
        // Short content: clear and cancel any in-flight generation (its late
        // result is dropped); the fixed cancel resets the loading flag.
        cancel();
        setAiSuggestions([]);
      } else {
        void load();
      }
    }, [content, tags, load, cancel]);

    useEffect(() => {
      if (isAdding && inputRef.current) {
        inputRef.current.focus();
        suggestionClickedRef.current = false;
      }
    }, [isAdding]);

    const prevInputValueRef = useRef(inputValue);
    if (inputValue !== prevInputValueRef.current) {
      prevInputValueRef.current = inputValue;
      setSelectedIndex(0);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (
          suggestions.length > 0 &&
          selectedIndex >= 0 &&
          selectedIndex < suggestions.length
        ) {
          const selectedSuggestion = suggestions[selectedIndex];
          if (selectedSuggestion) {onAddTag(selectedSuggestion);}
          setInputValue("");
          setIsAdding(false);
        } else if (inputValue.trim()) {
          const sanitizedTags = sanitizeTags([inputValue.trim()]);
          if (sanitizedTags.length > 0) {onAddTag(sanitizedTags[0]!);}
          setInputValue("");
          setIsAdding(false);
        }
      } else if (e.key === "Escape") {
        setIsAdding(false);
        setInputValue("");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
    }

    return (
      <div className="flex gap-1.5 flex-wrap items-center relative">
        {tags?.map((tag) => {
          const tagColor = tagColorService.getTagColor(tag);
          return (
            <span
              key={tag}
              className="text-xs font-medium ps-2.5 pe-1.5 py-1 rounded-md border flex items-center gap-1.5 group/tag transition-colors relative"
              style={{
                backgroundColor: tagColor ? `${tagColor}20` : undefined,
                color: tagColor ? getContrastColor(tagColor) : undefined,
                borderColor: tagColor ? `${tagColor}50` : undefined,
                ...(tagColor
                  ? {}
                  : {
                      backgroundColor:
                        "var(--tw-bg-[var(--bg-secondary)], rgb(244 244 245))",
                      color:
                        "var(--tw-text-[var(--text-secondary)], rgb(63 63 70))",
                      borderColor:
                        "var(--tw-border-[var(--divider)], rgb(228 228 231))",
                    }),
              }}
            >
              {tag}
              <button
                onClick={() =>
                  setShowColorPicker(showColorPicker === tag ? null : tag)
                }
                className="text-[var(--text-muted)] hover:text-cyan-500 rounded p-0.5 transition-colors opacity-0 group-hover/tag:opacity-100"
                title={t("app_changeColor", "Change color")}
              >
                <Palette className="size-3" />
              </button>
              <button
                onClick={() => onRemoveTag(tag)}
                className="text-[var(--text-muted)] hover:ds-text-danger hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--color-danger)]/10 rounded p-0.5 transition-colors"
                title={t("app_removeTag", "Remove tag")}
              >
                <X className="size-3" />
              </button>
              {showColorPicker === tag && (
                <div className="absolute top-full start-0 mt-1.5 bg-white dark:bg-[var(--bg-card)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-lg shadow-xl z-50 p-2 flex gap-1.5">
                  {tagColorService.getColorPalette().map((color) => (
                    <button
                      key={color}
                      onClick={() => {
                        tagColorService.setTagColor(tag, color);
                        setShowColorPicker(null);
                      }}
                      aria-label={t("app_colorSwatch", "{{color}} color", {
                        color,
                      })}
                      className="size-6 rounded-md border-2 border-white dark:border-[var(--divider)] hover:scale-110 transition-transform"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                  <button
                    onClick={() => {
                      tagColorService.removeTagColor(tag);
                      setShowColorPicker(null);
                    }}
                    className="size-6 rounded-md border-2 border-dashed border-[var(--divider)] dark:border-[var(--divider)] flex items-center justify-center hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]"
                    title={t("app_removeColor", "Remove color")}
                  >
                    <X className="size-3 text-[var(--text-muted)]" />
                  </button>
                </div>
              )}
            </span>
          );
        })}

        {isAdding ? (
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              aria-label={t("app_newTag", "New tag")}
              className="text-xs font-medium bg-white dark:bg-[var(--bg-primary)] border border-blue-500 rounded-md px-2.5 py-1 w-28 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-[var(--text-primary)] dark:text-white shadow-sm"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                setTimeout(() => {
                  if (!suggestionClickedRef.current && inputValue.trim()) {
                    const sanitized = sanitizeTags([inputValue.trim()]);
                    if (sanitized.length > 0) {onAddTag(sanitized[0]!);}
                  }
                  setIsAdding(false);
                  setInputValue("");
                }, 100);
              }}
              placeholder={t("app_typeTag")}
            />
            {suggestions.length > 0 && (
              <div className="absolute top-full start-0 mt-1.5 w-36 bg-white dark:bg-[var(--bg-card)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-lg shadow-xl z-50 overflow-hidden">
                {suggestions.map((suggestion, idx) => (
                  <div
                    key={suggestion}
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      suggestionClickedRef.current = true;
                      onAddTag(suggestion);
                      setInputValue("");
                      setIsAdding(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        suggestionClickedRef.current = true;
                        onAddTag(suggestion);
                        setInputValue("");
                        setIsAdding(false);
                      }
                    }}
                    className={`px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                      idx === selectedIndex
                        ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/50"
                    }`}
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {aiSuggestions.length > 0 && !isAdding && (
              <div className="flex gap-1.5">
                {aiSuggestions.slice(0, 3).map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => onAddTag(suggestion)}
                    className="truncate text-[10px] font-medium bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-2 py-0.5 rounded-md border border-cyan-200 dark:border-cyan-500/20 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 transition-colors flex items-center gap-1"
                    title={t("app_aiSuggested", "AI suggested")}
                  >
                    <Sparkles className="size-2.5" /> {suggestion}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setIsAdding(true)}
              className="truncate text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] dark:text-[var(--text-muted)] dark:hover:text-[var(--text-muted)] border border-dashed border-[var(--divider)] dark:border-[var(--divider)] hover:border-[var(--divider)] dark:hover:border-[var(--divider)] rounded-md px-2.5 py-1 flex items-center gap-1.5 transition-colors hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/50"
            >
              {isGeneratingSuggestions ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus className="size-3" />
              )}{" "}
              {t("app_tags")}
            </button>
          </div>
        )}
      </div>
    );
  };

function getTagContrastColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#1f2937" : "#ffffff";
}

export const ExpandedTagManager = ({
  tags,
  allTags,
  onAddTag,
  onRemoveTag,
  onClearTags,
}: {
  tags: string[];
  allTags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onClearTags?: () => void;
}) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");

  const unusedTags = allTags.filter((t) => !(tags || []).includes(t));
  const filteredSuggestions = unusedTags
    .filter((t) => t.toLowerCase().includes(inputValue.toLowerCase()))
    .slice(0, 10);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      const sanitized = sanitizeTags([inputValue.trim()]);
      if (sanitized.length > 0) {onAddTag(sanitized[0]!);}
      setInputValue("");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2.5 items-center">
        {tags?.map((tag) => {
          const tagColor = tagColorService.getTagColor(tag);
          return (
            <span
              key={tag}
              className="text-sm font-semibold ps-3.5 pe-2 py-1.5 rounded-full flex items-center gap-2 group/tag shadow-sm transition-all hover:shadow-md"
              style={{
                backgroundColor: tagColor ? `${tagColor}15` : undefined,
                color: tagColor ? getTagContrastColor(tagColor) : undefined,
                border: "1px solid",
                borderColor: tagColor ? `${tagColor}50` : undefined,
              }}
            >
              {tag}
              <button
                onClick={() => onRemoveTag(tag)}
                className="text-current opacity-60 hover:opacity-100 hover:ds-text-danger hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--color-danger)]/20 rounded-full p-1 transition-colors"
                title={t("app_removeTag", "Remove tag")}
              >
                <X className="size-3.5" />
              </button>
            </span>
          );
        })}
        {(!tags || tags.length === 0) && (
          <span className="text-sm text-[var(--text-muted)] dark:text-[var(--text-muted)] italic">
            {t("app_noTags", "No tags added yet.")}
          </span>
        )}
        {tags && tags.length > 1 && onClearTags && (
          <button
            onClick={onClearTags}
            className="truncate text-xs font-medium ds-text-danger/70 hover:ds-text-danger dark:ds-text-danger/70 dark:hover:ds-text-danger hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--color-danger)]/10 px-3 py-1.5 rounded-full transition-colors ms-auto"
          >
            {t("app_clearTags", "Clear all")}
          </button>
        )}
      </div>

      <div className="relative">
        <div className="flex items-center gap-3 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-2.5 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all shadow-inner">
          <Tag className="size-4 text-[var(--text-muted)]" />
          <input
            type="text"
            aria-label={t("app_typeTag") || "Type a tag and press Enter..."}
            className="bg-transparent border-none outline-none text-sm text-[var(--text-primary)] dark:text-white w-full placeholder:text-[var(--text-muted)]"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("app_typeTag") || "Type a tag and press Enter..."}
          />
          {inputValue.trim() && (
            <button
              onClick={() => {
                const sanitized = sanitizeTags([inputValue.trim()]);
                if (sanitized.length > 0) {onAddTag(sanitized[0]!);}
                setInputValue("");
              }}
              className="truncate text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors shadow-sm"
            >
              {t("app_add", "Add")}
            </button>
          )}
        </div>
      </div>

      {unusedTags.length > 0 && (
        <div className="pt-2 border-t border-[var(--divider)] dark:border-[var(--divider)]/50">
          <p className="text-xs font-medium text-[var(--text-muted)] dark:text-[var(--text-muted)] mb-3 uppercase tracking-wider">
            {t("app_suggestedTags", "Available tags")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(inputValue ? filteredSuggestions : unusedTags.slice(0, 15)).map(
              (tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    onAddTag(tag);
                    setInputValue("");
                  }}
                  className="truncate text-xs font-medium px-3 py-1.5 rounded-full bg-white dark:bg-[var(--bg-card)] text-[var(--text-secondary)] dark:text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] hover:text-[var(--text-primary)] dark:hover:text-[var(--text-muted)] transition-all border border-[var(--divider)] dark:border-[var(--divider)] flex items-center gap-1.5 hover:scale-105 active:scale-95 shadow-sm"
                >
                  <Plus className="size-3" /> {tag}
                </button>
              ),
            )}
            {inputValue && filteredSuggestions.length === 0 && (
              <span className="text-xs text-[var(--text-secondary)] italic">
                {t(
                  "app_noMatchingTags",
                  "No matching tags found. Press Enter to create.",
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
