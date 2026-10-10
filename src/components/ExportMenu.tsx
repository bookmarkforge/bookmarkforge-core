import { toast } from "sonner";
import { sanitizeText } from "../services/SanitizationService";
import { downloadBlob } from "../utils/download";
import { useGuardedActions } from "../hooks/useGuardedActions";
import i18n from "../i18n";
import { logger } from "../utils/logger";

interface BlockContent {
  text?: string;
}

interface BlockItem {
  type: string;
  content?: BlockContent[];
}

interface EditorWithExport {
  blocksToMarkdownLossy?: (document: BlockItem[]) => string;
  document?: BlockItem[];
}

interface ExportMenuProps {
  editor: EditorWithExport;
  title: string;
}

interface DocxOptions {
  author?: string;
  createdDate?: Date;
}

interface EpubOptions {
  coverImage?: string;
  language?: string;
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const generateHtmlDocx = (
  title: string,
  content: string,
  _options?: DocxOptions,
): string => {
  const safeTitle = escapeHtml(title);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
    h1 { color: #333; }
    p { margin-bottom: 1em; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  ${content}
</body>
</html>`;
  return html;
};

const generateEpub = (
  title: string,
  _content: string,
  options?: EpubOptions,
): string => {
  const safeTitle = escapeHtml(title);
  const safeLang = escapeHtml(options?.language || "en");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${safeTitle}</dc:title>
    <dc:language>${safeLang}</dc:language>
  </metadata>
  <manifest>
    <item id="content" href="content.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>`;
};

export const ExportMenu = ({ editor, title }: ExportMenuProps) => {
  // All four exports share ONE guard (any new export invalidates the
  // previous in-flight one). The downloads are gated by the helper's
  // onSuccess, so a superseded export never writes its file. The guard
  // auto-cancels on unmount.
  const {
    pdf: pdfAction,
    markdown: markdownAction,
    docx: docxAction,
    epub: epubAction,
  } = useGuardedActions<{
    pdf: void;
    markdown: string;
    docx: string;
    epub: string;
  }>({
    pdf: {
      onSuccess: () => {
        const element = document.querySelector(
          ".blocknote-theme-wrapper",
        ) as HTMLElement;
        if (!element) {return;}
        void import("html2pdf.js")
          .then(({ default: html2pdf }) =>
            html2pdf().from(element).save(`${title}.pdf`),
          )
          .catch((error: unknown) => {
            // The PDF generator is an external chunk: a failed load (offline
            // or cache miss) or a render error must surface instead of dying
            // as an unhandled rejection with no user feedback.
            logger.error("[ExportMenu] PDF export failed", { error });
            toast.error(i18n.t("app_exportError"));
          });
      },
    },
    markdown: {
      onSuccess: (markdown) => {
        const blob = new Blob([markdown], { type: "text/markdown" });
        downloadBlob(blob, `${title}.md`);
      },
    },
    docx: {
      onSuccess: (content) => {
        const html = generateHtmlDocx(title, content.replace(/\n/g, "<br>"));
        const blob = new Blob([html], { type: "application/msword" });
        downloadBlob(blob, `${title}.doc`);
      },
    },
    epub: {
      onSuccess: (content) => {
        const epub = generateEpub(title, content);
        const blob = new Blob([epub], { type: "application/epub+zip" });
        downloadBlob(blob, `${title}.epub`);
      },
    },
  });

  const getEditorContent = async (): Promise<string> => {
    if (editor.blocksToMarkdownLossy) {
      return editor.blocksToMarkdownLossy(editor.document ?? []);
    }
    return (
      editor.document
        ?.map((b: BlockItem) => {
          const text = sanitizeText(b.content?.[0]?.text || "");
          if (b.type === "heading") {
            return `<h1>${text}</h1>`;
          }
          if (b.type === "paragraph") {
            return `<p>${text}</p>`;
          }
          if (b.type === "bulletListItem") {
            return `<li>${text}</li>`;
          }
          return text;
        })
        .join("\n") || ""
    );
  };

  const exportPdf = () => {
    void pdfAction.run(async () => undefined);
  };

  const exportMarkdown = () => {
    void markdownAction.run(async () => getEditorContent());
  };

  const exportDocx = () => {
    void docxAction.run(async () => getEditorContent());
  };

  const exportEpub = () => {
    void epubAction.run(async () => getEditorContent());
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={exportPdf}
        className="px-3 py-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-lg hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors text-sm font-medium"
      >
        PDF
      </button>
      <button
        onClick={exportMarkdown}
        className="px-3 py-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-lg hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors text-sm font-medium"
      >
        MD
      </button>
      <button
        onClick={exportDocx}
        className="px-3 py-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-lg hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors text-sm font-medium"
      >
        DOC
      </button>
      <button
        onClick={exportEpub}
        className="px-3 py-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-lg hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors text-sm font-medium"
      >
        EPUB
      </button>
    </div>
  );
};
