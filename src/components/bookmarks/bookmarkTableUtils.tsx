import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Bookmark } from "../../types";
import type { TFunction } from "i18next";
import i18n from "../../i18n";
import { formatDate } from "../../utils/localization";
import { SanitizationService } from "../../services/SanitizationService";
import { escapeCsv } from "../../services/exporter.formatters";
import { downloadBlob } from "../../utils/download";

export type SortField = "title" | "url" | "createdAt" | "updatedAt";

const EXPORT_JSON_PREFIX = "data:text/json;charset=utf-8";
const CSV_MIME = "text/csv;charset=utf-8";
const MARKDOWN_MIME = "text/markdown;charset=utf-8";

export const SortIcon = ({
  field,
  sortField,
  sortDirection,
}: {
  field: SortField;
  sortField: SortField;
  sortDirection: "asc" | "desc";
}) => {
  if (sortField !== field) {
    return (
      <ArrowUpDown className="size-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
    );
  }
  return sortDirection === "asc" ? (
    <ArrowUp className="size-3 text-blue-500" />
  ) : (
    <ArrowDown className="size-3 text-blue-500" />
  );
};

export function exportJSON(
  bookmarks: Bookmark[],
  filename = "bookmarks_export.json",
): void {
  const dataStr =
    EXPORT_JSON_PREFIX + encodeURIComponent(JSON.stringify(bookmarks, null, 2));
  const anchor = document.createElement("a");
  anchor.setAttribute("href", dataStr);
  anchor.setAttribute("download", filename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function exportCSV(
  bookmarks: Bookmark[],
  t: TFunction,
  filename?: string,
): void {
  const headers = [
    t("app_csvTitle"),
    t("app_csvUrl"),
    t("app_csvSummary"),
    t("app_csvTags"),
    t("app_csvCreatedAt"),
  ];
  const rows = bookmarks.map((b) => [
    `"${escapeCsv(b.title || "")}"`,
    `"${escapeCsv(b.url || "")}"`,
    `"${escapeCsv(b.summary || "")}"`,
    `"${escapeCsv((b.tags || []).join(", "))}"`,
    `"${new Date(b.createdAt).toISOString()}"`,
  ]);
  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join(
    "\n",
  );
  const blob = new Blob([csvContent], { type: CSV_MIME });
  downloadBlob(
    blob,
    filename ||
      `bookmarks_export_${new Date().toISOString().split("T")[0]}.csv`,
  );
}

export function exportMarkdown(bookmark: Bookmark, t: TFunction): void {
  const safeUrl = SanitizationService.sanitizeUrl(bookmark.url);
  const safeSummary = SanitizationService.sanitizeText(
    bookmark.summary || t("app_noSummaryAvailable", "No summary available."),
  );
  const safeContent = SanitizationService.sanitizeText(bookmark.content || "");
  const content = `# ${bookmark.title}\n\n**URL:** ${safeUrl}\n**${t("app_added", "Added")}:** ${formatDate(bookmark.createdAt, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language)}\n\n## ${t("app_summary", "Summary")}\n${safeSummary}\n\n## ${t("app_content", "Content")}\n${safeContent}`;
  const blob = new Blob([content], { type: MARKDOWN_MIME });
  downloadBlob(
    blob,
    `${bookmark.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.md`,
  );
}

export async function exportPDF(
  bookmark: Bookmark,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {return;}
  const element = document.getElementById("reading-content");
  if (element) {
    const { default: html2pdf } = await import("html2pdf.js");
    if (signal?.aborted) {return;}
    const opt = {
      margin: 1,
      filename: `${bookmark.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: {
        unit: "in" as const,
        format: "letter" as const,
        orientation: "portrait" as const,
      },
    };
    html2pdf().set(opt).from(element).save();
  }
}
