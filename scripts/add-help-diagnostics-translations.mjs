/**
 * add-help-diagnostics-translations.mjs
 * Translates the Help & diagnostics card keys (added with the support
 * diagnostics button) into every locale still carrying the English text.
 * Idempotent: re-running skips keys already translated (value differs from EN).
 * Usage: node scripts/add-help-diagnostics-translations.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = "public/locales";

const EN = {
  app_helpDiagnostics: "Help & diagnostics",
  app_helpDiagnosticsDesc:
    "Copy a redacted diagnostic (counts & versions only — no vault content) to paste in support. Includes BF-E code if present.",
  app_diagCopyFailed: "Could not copy diagnostic. See Help.",
};

const T = {
  ar: {
    app_helpDiagnostics: "المساعدة والتشخيص",
    app_helpDiagnosticsDesc:
      "انسخ تشخيصًا مُجرّدًا (الأعداد والإصدارات فقط — بلا محتوى من الخزنة) لإلصاقه في الدعم. يتضمن رمز BF-E إن وُجد.",
    app_diagCopyFailed: "تعذّر نسخ التشخيص. راجع المساعدة.",
  },
  bg: {
    app_helpDiagnostics: "Помощ и диагностика",
    app_helpDiagnosticsDesc:
      "Копирайте обезличена диагностика (само бройки и версии — без съдържание от трезора), за да я изпратите на поддръжката. Включва BF-E код, ако има такъв.",
    app_diagCopyFailed: "Диагностиката не можа да се копира. Вижте Помощ.",
  },
  cs: {
    app_helpDiagnostics: "Nápověda a diagnostika",
    app_helpDiagnosticsDesc:
      "Zkopírujte anonymizovanou diagnostiku (pouze počty a verze — bez obsahu trezoru) pro vložení do podpory. Pokud existuje, zahrnuje kód BF-E.",
    app_diagCopyFailed: "Diagnostiku se nepodařilo zkopírovat. Viz Nápověda.",
  },
  da: {
    app_helpDiagnostics: "Hjælp og diagnostik",
    app_helpDiagnosticsDesc:
      "Kopiér en anonymiseret diagnostik (kun antal og versioner — intet boksindhold) til at indsætte i supporten. Indeholder BF-E-kode, hvis den findes.",
    app_diagCopyFailed: "Kunne ikke kopiere diagnostikken. Se Hjælp.",
  },
  de: {
    app_helpDiagnostics: "Hilfe & Diagnose",
    app_helpDiagnosticsDesc:
      "Kopieren Sie einen anonymisierten Diagnosebericht (nur Zähler und Versionen — kein Tresorinhalt) zum Einfügen im Support. Enthält, falls vorhanden, den BF-E-Code.",
    app_diagCopyFailed: "Diagnose konnte nicht kopiert werden. Siehe Hilfe.",
  },
  el: {
    app_helpDiagnostics: "Βοήθεια & διαγνωστικά",
    app_helpDiagnosticsDesc:
      "Αντιγράψτε μια ανωνυμοποιημένη διάγνωση (μόνο μετρήσεις και εκδόσεις — χωρίς περιεχόμενο θησαυροφυλακίου) για επικόλληση στην υποστήριξη. Περιλαμβάνει κωδικό BF-E αν υπάρχει.",
    app_diagCopyFailed: "Δεν ήταν δυνατή η αντιγραφή της διάγνωσης. Δείτε Βοήθεια.",
  },
  fi: {
    app_helpDiagnostics: "Ohje ja diagnostiikka",
    app_helpDiagnosticsDesc:
      "Kopioi anonymisoitu diagnostiikka (vain määrät ja versiot — ei holvin sisältöä) liitettäväksi tukeen. Sisältää BF-E-koodin, jos sellainen on.",
    app_diagCopyFailed: "Diagnostiikkaa ei voitu kopioida. Katso Ohje.",
  },
  fr: {
    app_helpDiagnostics: "Aide & diagnostic",
    app_helpDiagnosticsDesc:
      "Copiez un diagnostic anonymisé (compteurs et versions uniquement — aucun contenu du coffre) à coller dans le support. Inclut le code BF-E s'il existe.",
    app_diagCopyFailed: "Impossible de copier le diagnostic. Voir Aide.",
  },
  he: {
    app_helpDiagnostics: "עזרה ואבחון",
    app_helpDiagnosticsDesc:
      "העתיקו אבחון מאולח (ספירות וגרסאות בלבד — ללא תוכן הכספת) להדבקה בתמיכה. כולל קוד BF-E אם קיים.",
    app_diagCopyFailed: "לא ניתן היה להעתיק את האבחון. ראו עזרה.",
  },
  hi: {
    app_helpDiagnostics: "सहायता और निदान",
    app_helpDiagnosticsDesc:
      "समर्थन में पेस्ट करने के लिए एक गुमनाम निदान कॉपी करें (केवल संख्याएँ और संस्करण — वॉल्ट सामग्री नहीं)। यदि उपलब्ध हो तो BF-E कोड शामिल है।",
    app_diagCopyFailed: "निदान कॉपी नहीं हो सका। सहायता देखें।",
  },
  hr: {
    app_helpDiagnostics: "Pomoć i dijagnostika",
    app_helpDiagnosticsDesc:
      "Kopirajte anonimiziranu dijagnostiku (samo brojevi i verzije — bez sadržaja sefa) za slanje podrci. Uključuje BF-E kod ako postoji.",
    app_diagCopyFailed: "Dijagnostiku nije moguće kopirati. Pogledajte Pomoć.",
  },
  hu: {
    app_helpDiagnostics: "Súgó és diagnosztika",
    app_helpDiagnosticsDesc:
      "Másoljon leanonimizált diagnosztikát (csak számok és verziók — széf tartalma nélkül) az ügyfélszolgálatnak. Ha van, tartalmazza a BF-E kódot.",
    app_diagCopyFailed: "A diagnosztika nem másolható. Lásd a Súgót.",
  },
  id: {
    app_helpDiagnostics: "Bantuan & diagnostik",
    app_helpDiagnosticsDesc:
      "Salin diagnostik yang dianonimkan (hanya hitungan dan versi — tanpa isi brankas) untuk ditempel ke dukungan. Menyertakan kode BF-E jika ada.",
    app_diagCopyFailed: "Tidak dapat menyalin diagnostik. Lihat Bantuan.",
  },
  it: {
    app_helpDiagnostics: "Guida e diagnostica",
    app_helpDiagnosticsDesc:
      "Copia una diagnostica anonimizzata (solo conteggi e versioni — nessun contenuto della cassaforte) da incollare nell'assistenza. Include il codice BF-E se presente.",
    app_diagCopyFailed: "Impossibile copiare la diagnostica. Vedi Guida.",
  },
  ja: {
    app_helpDiagnostics: "ヘルプと診断",
    app_helpDiagnosticsDesc:
      "匿名化された診断情報（件数とバージョンのみ — 保管庫の内容は含まれません）をコピーしてサポートに貼り付けてください。BF-E コードがあれば表示されます。",
    app_diagCopyFailed: "診断情報をコピーできませんでした。ヘルプを参照してください。",
  },
  ko: {
    app_helpDiagnostics: "도움말 및 진단",
    app_helpDiagnosticsDesc:
      "지원팀에 붙여넣을 수 있도록 익명화된 진단 정보를 복사하세요(개수와 버전만 — 보관함 내용 없음). BF-E 코드가 있으면 포함됩니다.",
    app_diagCopyFailed: "진단 정보를 복사할 수 없습니다. 도움말을 참조하세요.",
  },
  nl: {
    app_helpDiagnostics: "Hulp & diagnostiek",
    app_helpDiagnosticsDesc:
      "Kopieer een geanonimiseerde diagnose (alleen aantallen en versies — geen kluisinhoud) om te plakken in support. Bevat de BF-E-code indien aanwezig.",
    app_diagCopyFailed: "Kon de diagnose niet kopiëren. Zie Hulp.",
  },
  no: {
    app_helpDiagnostics: "Hjelp og diagnostikk",
    app_helpDiagnosticsDesc:
      "Kopier en anonymisert diagnostikk (kun antall og versjoner — ingen innhold fra boksen) for å lime inn i supporten. Inkluderer BF-E-kode hvis den finnes.",
    app_diagCopyFailed: "Kunne ikke kopiere diagnostikken. Se Hjelp.",
  },
  pl: {
    app_helpDiagnostics: "Pomoc i diagnostyka",
    app_helpDiagnosticsDesc:
      "Skopiuj zanonimizowaną diagnostykę (tylko liczniki i wersje — bez zawartości sejfu), aby wkleić ją do wsparcia. Zawiera kod BF-E, jeśli występuje.",
    app_diagCopyFailed: "Nie można skopiować diagnostyki. Zobacz Pomoc.",
  },
  pt: {
    app_helpDiagnostics: "Ajuda e diagnóstico",
    app_helpDiagnosticsDesc:
      "Copie um diagnóstico anonimizado (apenas contagens e versões — sem conteúdo do cofre) para colar no suporte. Inclui o código BF-E, se existir.",
    app_diagCopyFailed: "Não foi possível copiar o diagnóstico. Veja Ajuda.",
  },
  ro: {
    app_helpDiagnostics: "Ajutor și diagnostic",
    app_helpDiagnosticsDesc:
      "Copiați un diagnostic anonimizat (doar contoare și versiuni — fără conținutul seifului) pentru a-l trimite la asistență. Include codul BF-E, dacă există.",
    app_diagCopyFailed: "Nu s-a putut copia diagnosticul. Consultați Ajutorul.",
  },
  ru: {
    app_helpDiagnostics: "Справка и диагностика",
    app_helpDiagnosticsDesc:
      "Скопируйте обезличенную диагностику (только счётчики и версии — без содержимого хранилища), чтобы вставить её в обращение в поддержку. Включает код BF-E, если он есть.",
    app_diagCopyFailed: "Не удалось скопировать диагностику. См. Справку.",
  },
  sv: {
    app_helpDiagnostics: "Hjälp och diagnostik",
    app_helpDiagnosticsDesc:
      "Kopiera en anonymiserad diagnostik (endast räknare och versioner — inget valvinnehåll) att klistra in i supporten. Innehåller BF-E-kod om en finns.",
    app_diagCopyFailed: "Kunde inte kopiera diagnostiken. Se Hjälp.",
  },
  th: {
    app_helpDiagnostics: "ช่วยเหลือและการวินิจฉัย",
    app_helpDiagnosticsDesc:
      "คัดลอกข้อมูลวินิจฉัยที่ไม่ระบุตัวตน (เฉพาะจำนวนและเวอร์ชัน — ไม่มีเนื้อหาตู้เซฟ) เพื่อวางให้ฝ่ายสนับสนุน รวมรหัส BF-E หากมี",
    app_diagCopyFailed: "ไม่สามารถคัดลอกข้อมูลวินิจฉัยได้ ดูช่วยเหลือ",
  },
  tr: {
    app_helpDiagnostics: "Yardım ve tanılama",
    app_helpDiagnosticsDesc:
      "Destek ekibine yapıştırmak üzere anonimleştirilmiş bir tanılama kopyalayın (yalnızca sayaçlar ve sürümler — kasa içeriği yok). Varsa BF-E kodunu içerir.",
    app_diagCopyFailed: "Tanılama kopyalanamadı. Yardım'a bakın.",
  },
  uk: {
    app_helpDiagnostics: "Довідка та діагностика",
    app_helpDiagnosticsDesc:
      "Скопіюйте знеособлену діагностику (лише лічильники та версії — без вмісту сховища), щоб вставити її в звернення до підтримки. Містить код BF-E, якщо він є.",
    app_diagCopyFailed: "Не вдалося скопіювати діагностику. Див. Довідку.",
  },
  vi: {
    app_helpDiagnostics: "Trợ giúp & chẩn đoán",
    app_helpDiagnosticsDesc:
      "Sao chép thông tin chẩn đoán đã ẩn danh (chỉ số đếm và phiên bản — không có nội dung két sắt) để dán vào phần hỗ trợ. Bao gồm mã BF-E nếu có.",
    app_diagCopyFailed: "Không thể sao chép thông tin chẩn đoán. Xem Trợ giúp.",
  },
  zh: {
    app_helpDiagnostics: "帮助与诊断",
    app_helpDiagnosticsDesc:
      "复制一份去标识化的诊断信息（仅计数和版本 — 不含保险库内容）粘贴给支持团队。如存在，将包含 BF-E 代码。",
    app_diagCopyFailed: "无法复制诊断信息。请参阅帮助。",
  },
};

const KEYS = Object.keys(EN);
let touched = 0;
for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const code = file.replace(".json", "");
  if (code === "en") {continue;}
  const translations = T[code];
  if (!translations) {
    console.warn(`[help-i18n] SKIP ${code}: no translations defined`);
    continue;
  }
  const path = join(LOCALES_DIR, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  // Only overwrite keys whose value is still the ENGLISH text (untranslated).
  // A locale with an existing real translation is never touched.
  const pending = KEYS.filter((k) => k in json && json[k] === EN[k]);
  if (pending.length === 0) {continue;}
  for (const key of pending) {
    json[key] = translations[key];
  }
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  touched++;
  console.log(`[help-i18n] ${code}: translated ${pending.length} key(s)`);
}
console.log(`[help-i18n] done — ${touched} locale file(s) updated`);
