/**
 * importer.enex.ts — Evernote ENEX export parsing for UniversalImporter.
 *
 * ENEX is Evernote's XML export format:
 *
 *   <en-export><note><title>…</title><content>BASE64_ENML</content>
 *   <created>20240101T120000Z</created><updated>…</updated>
 *   <tag>…</tag><guid>…</guid></note>…</en-export>
 *
 * `<content>` holds base64-encoded ENML (Evernote Markup Language, an XHTML
 * subset). This module is pure parsing — no database access. The write
 * pipeline lives in UniversalImporter so it shares the journal/rollback
 * machinery, exactly like importer.markdown.ts.
 *
 * Mapping decisions:
 *   - note → document (web clips stay documents; their URL lives in the body)
 *   - `<guid>` → document id when present (stable dedup on re-import)
 *   - `<tag>` elements → document tags
 *   - ENML → markdown-lite textContent (headings, lists, checkboxes, links,
 *     bold/italic/code); `<en-media>` resources are skipped — attachment
 *     bytes are not imported in v1
 *   - notebooks are not part of the ENEX format → everything lands in root
 */

export interface ParsedEnexNote {
  title: string;
  textContent: string;
  createdAt?: string;
  updatedAt?: string;
  tags: string[];
  /** Evernote's stable note id — used as the document id for dedup. */
  guid?: string;
  /** True when the note carried <resource> elements (attachments skipped). */
  hasResources: boolean;
}

const EVERNOTE_DATE_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/;

/** "20240101T120000Z" → ISO-8601; anything else passes through trimmed. */
export function enexDateToIso(value: string | null | undefined): string | undefined {
  if (!value) {return undefined;}
  const trimmed = value.trim();
  const m = EVERNOTE_DATE_RE.exec(trimmed);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function decodeBase64Text(b64: string): string {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// ── ENML → markdown-lite ──────────────────────────────────────────────────

function collapseInline(text: string): string {
  return text.replace(/[ \t\u00a0]+/g, " ");
}

/** Render a DOM node to markdown-lite. */
function renderNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return collapseInline(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {return "";}

  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  switch (tag) {
    case "EN-MEDIA":
    case "EN-CRYPT":
      // Attachment payloads are not imported; encrypted note bodies cannot
      // be rendered without the note key — skip both silently.
      return "";
    case "BR":
      return "\n";
    case "HR":
      return "\n\n---\n\n";
    case "EN-TODO": {
      // ENML marks a done todo by the mere presence of `checked`
      // (`checked="true"`, `checked=""`, `checked="checked"` all appear in
      // the wild); an absent attribute means unchecked.
      return el.hasAttribute("checked") ? "- [x] " : "- [ ] ";
    }
    case "A": {
      const text = renderChildren(el).trim();
      const href = el.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) {
        // Bare anchors (no text) still contribute their URL.
        return text ? `[${text}](${href})` : href;
      }
      // Non-http(s) hrefs (javascript:, data:, en-media refs) are dropped —
      // the visible text is kept, the unsafe target is not propagated.
      return text;
    }
    case "STRONG":
    case "B":
      return `**${renderChildren(el).trim()}**`;
    case "EM":
    case "I":
      return `*${renderChildren(el).trim()}*`;
    case "CODE":
      return `\`${renderChildren(el).trim()}\``;
    case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
      const level = Number(tag[1]);
      const text = renderChildren(el).trim();
      return text ? `\n\n${"#".repeat(level)} ${text}\n\n` : "";
    }
    case "BLOCKQUOTE": {
      const inner = renderChildren(el).trim();
      if (!inner) {return "";}
      return `\n\n${inner.split("\n").map((l) => `> ${l}`).join("\n")}\n\n`;
    }
    case "PRE": {
      const text = renderChildren(el).trim();
      return text ? `\n\n\`\`\`\n${text}\n\`\`\`\n\n` : "";
    }
    case "UL": case "OL": {
      const items: string[] = [];
      for (const child of Array.from(el.children)) {
        if (child.tagName.toUpperCase() !== "LI") {continue;}
        const body = renderChildren(child).replace(/\n{2,}/g, "\n").trim();
        if (body) {
          // `<li><en-todo/></li>` already carries its own "- [ ]" marker —
          // do not double the bullet.
          items.push(body.startsWith("- [") ? body : `- ${body}`);
        }
      }
      return items.length ? `\n${items.join("\n")}\n` : "";
    }
    case "LI": {
      const body = renderChildren(el).trim();
      return body ? `- ${body}\n` : "";
    }
    case "P": {
      const inner = renderChildren(el).trim();
      return inner ? `${inner}\n\n` : "";
    }
    case "DIV": case "SECTION": case "ARTICLE": {
      // Evernote wraps most content in divs; render children and let the
      // block-level children produce their own spacing.
      return renderChildren(el);
    }
    default:
      return renderChildren(el);
  }
}

function renderChildren(el: Element): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    out += renderNode(child);
  }
  return out;
}

/**
 * Parse ENML. ENML is XHTML, so `text/xml` is the correct parser — it keeps
 * self-closing tags (`<en-media/>`, `<en-todo/>`) from swallowing following
 * siblings the way `text/html` would. Bare `&` characters (a common export
 * flaw) are escaped first; if the result still is not well-formed XML we fall
 * back to the lenient HTML parser.
 */
function parseEnml(enml: string): Document {
  const cleaned = enml.replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g,
    "&amp;",
  );
  const xml = new DOMParser().parseFromString(cleaned, "text/xml");
  if (xml.getElementsByTagName("parsererror").length === 0) {return xml;}
  return new DOMParser().parseFromString(enml, "text/html");
}

/** Convert decoded ENML to compact markdown-lite text. */
export function enmlToText(enml: string): string {
  const doc = parseEnml(enml);
  const container = doc.body ?? doc.documentElement;
  if (!container) {return "";}
  const raw = renderChildren(container as Element);
  return raw
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── ENEX parsing ──────────────────────────────────────────────────────────

const SAFE_GUID_RE = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Parse an ENEX document. Returns null when the XML is not an Evernote
 * export (`<en-export>` root missing or unparseable).
 */
export function parseEnexDocument(xml: string): ParsedEnexNote[] | null {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {return null;}
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "en-export") {return null;}

  const notes: ParsedEnexNote[] = [];
  for (const noteEl of Array.from(root.getElementsByTagName("note"))) {
    const title =
      noteEl.getElementsByTagName("title")[0]?.textContent?.trim() ?? "";

    const contentEl = noteEl.getElementsByTagName("content")[0];
    let textContent = "";
    const rawContent = contentEl?.textContent ?? "";
    if (rawContent.trim()) {
      try {
        textContent = enmlToText(decodeBase64Text(rawContent));
      } catch {
        // Undecodable content — keep the note with empty body rather than
        // dropping the whole export.
        textContent = "";
      }
    }

    const guidEl = noteEl.getElementsByTagName("guid")[0];
    const rawGuid = guidEl?.textContent?.trim() ?? "";

    notes.push({
      title: title || "Untitled Note",
      textContent,
      createdAt: enexDateToIso(
        noteEl.getElementsByTagName("created")[0]?.textContent,
      ),
      updatedAt: enexDateToIso(
        noteEl.getElementsByTagName("updated")[0]?.textContent,
      ),
      tags: Array.from(noteEl.getElementsByTagName("tag"))
        .map((t) => t.textContent?.trim() ?? "")
        .filter((t) => t.length > 0),
      guid: SAFE_GUID_RE.test(rawGuid) ? rawGuid : undefined,
      hasResources: noteEl.getElementsByTagName("resource").length > 0,
    });
  }
  return notes;
}
