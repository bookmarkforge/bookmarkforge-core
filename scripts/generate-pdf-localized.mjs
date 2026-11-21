import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import PDFDocument from "pdfkit";
import { marked } from "marked";
import {
  LANDING_CODES,
  MANUAL_FILES,
  manualPdfPath,
  manualSourcePath,
  manualStyledHtmlPath,
} from "./landing-registry.mjs";

// DERIVED from the landing locale registry (single source of truth), Spanish
// first as the master manual the PDF set leads with. The hand-kept `codes`
// list this replaced could drift from the registry silently.
const codes = ["es", ...LANDING_CODES.filter((code) => code !== "es")];
const titles = {
  es: ["Manual de usuario", "Última actualización: septiembre de 2026"], en: ["User manual", "Last updated: September 2026"],
  ar: ["دليل المستخدم", "آخر تحديث: سبتمبر 2026"], bg: ["Ръководство за потребителя", "Последна актуализация: септември 2026"], cs: ["Uživatelská příručka", "Poslední aktualizace: září 2026"],
  da: ["Brugervejledning", "Sidst opdateret: september 2026"], de: ["Benutzerhandbuch", "Letzte Aktualisierung: September 2026"], el: ["Εγχειρίδιο χρήστη", "Τελευταία ενημέρωση: Σεπτέμβριος 2026"],
  fi: ["Käyttöopas", "Päivitetty viimeksi: syyskuu 2026"], fr: ["Manuel utilisateur", "Dernière mise à jour : septembre 2026"], he: ["מדריך למשתמש", "עדכון אחרון: ספטמבר 2026"],
  hi: ["उपयोगकर्ता पुस्तिका", "अंतिम अपडेट: सितंबर 2026"], hr: ["Korisnički priručnik", "Zadnje ažuriranje: rujan 2026"], hu: ["Felhasználói kézikönyv", "Utoljára frissítve: 2026. szeptember"],
  id: ["Panduan pengguna", "Terakhir diperbarui: September 2026"], it: ["Manuale utente", "Ultimo aggiornamento: settembre 2026"], ja: ["ユーザーマニュアル", "最終更新: 2026年9月"],
  ko: ["사용자 설명서", "최종 업데이트: 2026년 9월"], nl: ["Gebruikershandleiding", "Laatst bijgewerkt: september 2026"], no: ["Brukerhåndbok", "Sist oppdatert: september 2026"],
  pl: ["Podręcznik użytkownika", "Ostatnia aktualizacja: wrzesień 2026"], pt: ["Manual do utilizador", "Última atualização: setembro de 2026"], ro: ["Manual de utilizare", "Ultima actualizare: septembrie 2026"],
  ru: ["Руководство пользователя", "Последнее обновление: сентябрь 2026"], sv: ["Användarhandbok", "Senast uppdaterad: september 2026"], th: ["คู่มือผู้ใช้", "อัปเดตล่าสุด: กันยายน 2026"],
  tr: ["Kullanım kılavuzu", "Son güncelleme: Eylül 2026"], uk: ["Посібник користувача", "Останнє оновлення: вересень 2026"], vi: ["Sổ tay người dùng", "Cập nhật lần cuối: tháng 9 năm 2026"], zh: ["用户手册", "最后更新：2026年9月"],
};
const rtl = new Set(["ar", "he"]);
const documents = codes.map((code) => ({
  code,
  source: manualSourcePath(code),
  pdf: manualPdfPath(code),
  html: manualStyledHtmlPath(code),
  title: titles[code][0],
  footer: titles[code][1],
}));

if (documents.length !== 30 || documents.some((item) => !existsSync(item.source))) {
  throw new Error("The manual inventory does not contain exactly the expected 30 Markdown files");
}

const htmlStyle = `@page{size:A4;margin:2cm}body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.8;color:#1a1a2e;font-size:13px}h1{color:#16213e;border-bottom:3px solid #0f3460;padding-bottom:10px}h2{color:#0f3460;border-bottom:1px solid #e0e0e0;padding-bottom:6px;margin-top:30px}code{background:#f4f4f4;padding:2px 6px;border-radius:3px}pre{background:#1a1a2e;color:#e0e0e0;padding:15px;border-radius:8px}table{border-collapse:collapse;width:100%;margin:15px 0}th,td{border:1px solid #ddd;padding:8px}th{background:#0f3460;color:white}footer{margin-top:50px;border-top:1px solid #ddd;padding-top:10px;color:#666;font-size:.8em;text-align:center}`;

function fontPath() {
  const candidates = [
    process.env.WINDIR ? join(process.env.WINDIR, "Fonts", "arial.ttf") : "",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  ];
  return candidates.find((path) => path && existsSync(path));
}

function tokenText(token) {
  if (!token) return "";
  if (typeof token.text === "string") return token.text;
  if (Array.isArray(token.tokens)) return token.tokens.map(tokenText).join(" ");
  return "";
}

// PDFKit needs a file stream; keeping this helper isolated makes the generator
// independent from Chromium, whose shutdown can hang on some CI hosts.
import { createWriteStream } from "node:fs";
const font = fontPath();
function generatePdf(document, source, created) {
  // CreationDate has to reach the constructor: pdfkit derives the trailer /ID
  // from the info dict it was built with, so assigning it afterwards leaves the
  // file salted with the current time and two runs disagree byte by byte.
  const pdf = new PDFDocument({ size: "A4", margin: 50, info: { CreationDate: created } });
  const output = createWriteStream(document.pdf);
  pdf.pipe(output);
  if (font) pdf.font(font);
  pdf.info.Title = `BookmarkForge v1 — ${document.title}`;
  pdf.info.Language = document.code;
  pdf.fontSize(22).fillColor("#16213e").text(document.title, { align: rtl.has(document.code) ? "right" : "left" });
  pdf.moveDown(0.5).fontSize(9).fillColor("#666").text(document.footer, { align: rtl.has(document.code) ? "right" : "left" });
  pdf.moveDown(1).fillColor("#1a1a2e");
  for (const token of marked.lexer(source)) {
    const text = tokenText(token).replace(/\n+/g, " ").trim();
    if (!text && token.type !== "hr") continue;
    if (token.type === "heading") {
      pdf.moveDown(0.7).fontSize(token.depth === 1 ? 18 : token.depth === 2 ? 14 : 12).fillColor("#0f3460").text(text, { align: rtl.has(document.code) ? "right" : "left" }).fillColor("#1a1a2e");
    } else if (token.type === "list") {
      for (const item of token.items ?? []) pdf.fontSize(10).text(`• ${tokenText(item).trim()}`, { indent: 12, align: rtl.has(document.code) ? "right" : "left" });
      pdf.moveDown(0.3);
    } else if (token.type === "code") {
      pdf.fontSize(8).fillColor("#333").text(token.text ?? "", { indent: 8 }).fillColor("#1a1a2e");
    } else if (token.type === "hr") {
      pdf.moveDown(0.4).moveTo(50, pdf.y).lineTo(545, pdf.y).strokeColor("#dddddd").stroke().moveDown(0.4);
    } else {
      pdf.fontSize(10).text(text, { align: rtl.has(document.code) ? "right" : "left", paragraphGap: 5 });
    }
  }
  pdf.moveDown(1).fontSize(8).fillColor("#666").text("BookmarkForge v1.0.0 · MIT Core / Pro propietario", { align: "center" });
  pdf.end();
  return new Promise((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
  });
}

// A pinned creation date is what makes these artifacts reproducible. pdfkit
// stamps the info dict (and the trailer /ID derived from it) with `new Date()`,
// so before this the generator emitted byte-different PDFs for identical
// manuals: fixing one figure in ten manuals rewrote all thirty binaries.
// The default is the month the manuals' own footer declares; SOURCE_DATE_EPOCH
// overrides it the way reproducible-builds tooling expects.
const MANUAL_DATE = Date.UTC(2026, 8, 1, 0, 0, 0);
// Source-date-epoch value, when set, pins the PDF creation date to a
// deterministic value the reproducible-builds ecosystem understands.
export function pdfDate(epochSeconds) {
  // When called without an argument (backward compat: main(argv) still
  // calls pdfDate()), fall back to the process env so the CI step can
  // pass it explicitly.
  if (epochSeconds === undefined) {
    const raw = (process.env.SOURCE_DATE_EPOCH ?? "").trim();
    if (!raw) return new Date(MANUAL_DATE);
    if (!/^\d+$/.test(raw)) {
      throw new Error("SOURCE_DATE_EPOCH must be whole seconds since the epoch, not " + JSON.stringify(raw));
    }    const at = new Date(Number(raw) * 1000);    if (Number.isNaN(at.getTime())) throw new Error("SOURCE_DATE_EPOCH is out of range");    return at;  }  // Called with an explicit epoch value (tests / CI passes).  if (!/^\d+$/.test(epochSeconds)) {
    throw new Error("SOURCE_DATE_EPOCH must be whole seconds since the epoch, not " + JSON.stringify(epochSeconds));
  }  const at = new Date(Number(epochSeconds) * 1000);  if (Number.isNaN(at.getTime())) throw new Error("SOURCE_DATE_EPOCH is out of range");  return at;
}


function flagValue(argv, name) {
  const index = argv.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index === -1) return null;
  const inline = argv[index].startsWith(name + "=");
  const value = inline ? argv[index].slice(name.length + 1) : argv[index + 1];
  if (!value || (!inline && value.startsWith("--"))) throw new Error(`${name} needs a value`);
  return value;
}

// The generator had no per-locale switch, so touching one manual meant
// rebuilding (and diffing) every artifact. `--only` narrows the set; the
// default remains the full inventory, which is what the npm script runs.
export function selectDocuments(all, argv) {
  const wanted = flagValue(argv, "--only");
  if (wanted === null) return all;
  const codes = wanted.split(",").map((code) => code.trim().toLowerCase()).filter(Boolean);
  if (codes.length === 0) throw new Error("--only needs at least one locale, for example --only=cs,fr");
  const unknown = codes.filter((code) => !all.some((item) => item.code === code));
  if (unknown.length > 0) {
    throw new Error(`--only does not know ${unknown.join(", ")}; the manuals cover ${all.map((item) => item.code).join(", ")}`);
  }
  return all.filter((item) => codes.includes(item.code));
}

async function main(argv) {
  const created = pdfDate(process.env.SOURCE_DATE_EPOCH);
  const selected = selectDocuments(documents, argv);
  const outDir = flagValue(argv, "--out-dir");
  if (outDir) mkdirSync(outDir, { recursive: true });
  const target = (path) => (outDir ? join(outDir, basename(path)) : path);
  for (const document of selected) {
    const source = readFileSync(document.source, "utf8");
    const html = `<!doctype html><html lang="${document.code}"${rtl.has(document.code) ? " dir=\"rtl\"" : ""}><head><meta charset="UTF-8"><title>BookmarkForge v1 — ${document.title}</title><style>${htmlStyle}</style></head><body>${marked.parse(source)}<footer>${document.footer} · BookmarkForge v1.0.0 · MIT Core / Pro propietario</footer></body></html>`;
    writeFileSync(target(document.html), html);
    await generatePdf({ ...document, pdf: target(document.pdf) }, source, created);
    console.log(`Generado ${target(document.pdf)}`);
  }
  // The public-export overlays are copies of the Spanish and English manuals
  // and only make sense once those two were rebuilt in place.
  if (!outDir && selected.length === documents.length) {
    copyFileSync(manualPdfPath("es"), `scripts/public-export/${MANUAL_FILES.es}.pdf`);
    copyFileSync(manualPdfPath("en"), `scripts/public-export/${MANUAL_FILES.en}.pdf`);
  }
  const where = outDir ? ` in ${outDir}` : "";
  const overlays = !outDir && selected.length === documents.length ? " and updated the two public-overlay PDFs" : "";
  console.log(`Generated ${selected.length} PDF(s) [${selected.map((item) => item.code).join(", ")}]${where}${overlays}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
