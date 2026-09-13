#!/usr/bin/env node
/**
 * Generate localized privacy-and-terms pages by adapting the English version.
 * Usage: node scripts/generate-privacy-pages-simple.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PUBLIC = resolve(ROOT, "public");

// ── All 30 supported locales ───────────────────────────────────────
const ALL_LOCALES = [
  "ar","bg","cs","da","de","el","en","es","fi","fr",
  "he","hi","hr","hu","id","it","ja","ko","nl","no",
  "pl","pt","ro","ru","sv","th","tr","uk","vi","zh"
];

// Native language names are used in the full generator (generate-privacy-pages.mjs)

// ── og:locale values ───────────────────────────────────────────────
const OG_LOCALE = {
  ar:"ar_AR", bg:"bg_BG", cs:"cs_CZ", da:"da_DK", de:"de_DE",
  el:"el_GR", en:"en_US", es:"es_ES", fi:"fi_FI", fr:"fr_FR",
  he:"he_IL", hi:"hi_IN", hr:"hr_HR", hu:"hu_HU", id:"id_ID",
  it:"it_IT", ja:"ja_JP", ko:"ko_KR", nl:"nl_NL", no:"no_NO",
  pl:"pl_PL", pt:"pt_BR", ro:"ro_RO", ru:"ru_RU", sv:"sv_SE",
  th:"th_TH", tr:"tr_TR", uk:"uk_UA", vi:"vi_VN", zh:"zh_CN"
};

// ── RTL languages ──────────────────────────────────────────────────
const RTL = new Set(["ar", "he"]);

// ── Date formats per locale ────────────────────────────────────────
const DATE_FORMAT = {
  ar: { privacy: "4 سبتمبر 2026", terms: "23 يوليو 2026" },
  bg: { privacy: "4 септември 2026", terms: "23 юли 2026" },
  cs: { privacy: "4. září 2026", terms: "23. července 2026" },
  da: { privacy: "4. september 2026", terms: "23. juli 2026" },
  de: { privacy: "4. September 2026", terms: "23. Juli 2026" },
  el: { privacy: "4 Σεπτεμβρίου 2026", terms: "23 Ιουλίου 2026" },
  en: { privacy: "September 4, 2026", terms: "July 23, 2026" },
  es: { privacy: "4 de septiembre de 2026", terms: "23 de julio de 2026" },
  fi: { privacy: "4. syyskuuta 2026", terms: "23. heinäkuuta 2026" },
  fr: { privacy: "4 septembre 2026", terms: "23 juillet 2026" },
  he: { privacy: "4 בספטמבר 2026", terms: "23 ביולי 2026" },
  hi: { privacy: "4 सितंबर 2026", terms: "23 जुलाई 2026" },
  hr: { privacy: "4. rujna 2026", terms: "23. srpnja 2026" },
  hu: { privacy: "2026. szeptember 4.", terms: "2026. július 23." },
  id: { privacy: "4 September 2026", terms: "23 Juli 2026" },
  it: { privacy: "4 settembre 2026", terms: "23 luglio 2026" },
  ja: { privacy: "2026年9月4日", terms: "2026年7月23日" },
  ko: { privacy: "2026년 9월 4일", terms: "2026년 7월 23일" },
  nl: { privacy: "4 september 2026", terms: "23 juli 2026" },
  no: { privacy: "4. september 2026", terms: "23. juli 2026" },
  pl: { privacy: "4 września 2026", terms: "23 lipca 2026" },
  pt: { privacy: "4 de setembro de 2026", terms: "23 de julho de 2026" },
  ro: { privacy: "4 septembrie 2026", terms: "23 iulie 2026" },
  ru: { privacy: "4 сентября 2026", terms: "23 июля 2026" },
  sv: { privacy: "4 september 2026", terms: "23 juli 2026" },
  th: { privacy: "4 กันยายน 2026", terms: "23 กรกฎาคม 2026" },
  tr: { privacy: "4 Eylül 2026", terms: "23 Temmuz 2026" },
  uk: { privacy: "4 вересня 2026", terms: "23 липня 2026" },
  vi: { privacy: "4 tháng 9 năm 2026", terms: "23 tháng 7 năm 2026" },
  zh: { privacy: "2026年9月4日", terms: "2026年7月23日" }
};

// ── Title & meta desc per locale ──────────────────────────────────
const TITLE_MAP = {
  ar: "سياسة الخصوصية وشروط الخدمة",
  bg: "Политика за поверителност и условия за ползване",
  cs: "Zásady ochrany soukromí a podmínky užívání",
  da: "Privatlivspolitik & Vilkår for Brug",
  de: "Datenschutzerklärung & Nutzungsbedingungen",
  el: "Πολιτική Απορρήτου & Όροι Χρήσης",
  en: "Privacy Policy & Terms of Service",
  es: "Política de Privacidad y Términos de Servicio",
  fi: "Tietosuojakäytäntö ja Käyttöehdot",
  fr: "Politique de Confidentialité et Conditions d'Utilisation",
  he: "מדיניות פרטיות ותנאי שימוש",
  hi: "गोपनीयता नीति और सेवा की शर्तें",
  hr: "Pravilnik o privatnosti i Uvjeti korištenja",
  hu: "Adatvédelmi irányelv és Felhasználási feltételek",
  id: "Kebijakan Privasi & Ketentuan Layanan",
  it: "Informativa sulla Privacy e Termini di Servizio",
  ja: "プライバシーポリシー & 利用規約",
  ko: "개인정보처리방침 & 서비스 약관",
  nl: "Privacybeleid & Gebruiksvoorwaarden",
  no: "Personvernpolicy & Bruksvilkår",
  pl: "Polityka Prywatności i Regulamin",
  pt: "Política de Privacidade e Termos de Serviço",
  ro: "Politica de Confidențialitate și Termeni de Utilizare",
  ru: "Политика конфиденциальности и Условия использования",
  sv: "Integritetspolicy & Användarvillkor",
  th: "นโยบายความเป็นส่วนตัวและข้อกำหนดการใช้งาน",
  tr: "Gizlilik Politikası ve Kullanım Şartları",
  uk: "Політика конфіденційності та Умови використання",
  vi: "Chính sách Bảo mật & Điều khoản Dịch vụ",
  zh: "隐私政策和服务条款"
};

const META_DESC_MAP = {
  ar: "سياسة الخصوصية وشروط خدمة BookmarkForge. بياناتك تبقى على جهازك. محلي أولاً، مشفر، بدون معرفة.",
  bg: "Политика за поверителност и условия за ползване на BookmarkForge. Вашите данни са на вашето устройство. Първо локално, криптирано, без знание.",
  cs: "Zásady ochrany soukromí a podmínky užívání BookmarkForge. Vaše data zůstanou na vašem zařízení. Lokal-first, šifrované, zero-knowledge.",
  da: "BookmarkForge privatlivspolitik og vilkår for brug. Dine data bliver på din enhed. Lokal-først, krypteret, zero-knowledge.",
  de: "BookmarkForge Datenschutzerklärung und Nutzungsbedingungen. Ihre Daten bleiben auf Ihrem Gerät. Local-first, verschlüsselt, zero-knowledge.",
  el: "Πολιτική Απορρήτου και Όροι Χρήσης BookmarkForge. Τα δεδομένα σας μένουν στη συσκευή σας. Τοπικά-πρώτα, κρυπτογραφημένα, zero-knowledge.",
  en: "BookmarkForge Privacy Policy and Terms of Service. Your data stays on your device. Local-first, encrypted, zero-knowledge.",
  es: "Política de Privacidad y Términos de Servicio de BookmarkForge. Tus datos se quedan en tu dispositivo. Local-first, cifrado, zero-knowledge.",
  fi: "BookmarkForge tietosuojakäytäntö ja käyttöehdot. Tietosi pysyvät laitteellasi. Local-first, salattu, zero-knowledge.",
  fr: "Politique de Confidentialité et Conditions d'Utilisation de BookmarkForge. Vos données restent sur votre appareil. Local-first, chiffré, zero-knowledge.",
  he: "מדיניות פרטיות ותנאי שימוש של BookmarkForge. הנתונים שלך נשארים במכשיר שלך. מקומי-ראשון, מוצפן, zero-knowledge.",
  hi: "BookmarkForge की गोपनीयता नीति और सेवा की शर्तें। आपका डेटा आपके डिवाइस पर रहता है। लोकल-फर्स्ट, एन्क्रिप्टेड, जीरो-नॉलेज।",
  hr: "Pravilnik o privatnosti i Uvjeti korištenja BookmarkForge. Vaši podaci ostaju na vašem uređaju. Local-first, enkriptirano, zero-knowledge.",
  hu: "BookmarkForge adatvédelmi irányelv és Felhasználási feltételek. Az adatai az eszközén maradnak. Helyi-első, titkosított, zero-knowledge.",
  id: "Kebijakan Privasi & Ketentuan Layanan BookmarkForge. Data Anda tetap di perangkat Anda. Local-first, terenkripsi, zero-knowledge.",
  it: "Informativa sulla Privacy e Termini di Servizio di BookmarkForge. I tuoi dati rimangono sul tuo dispositivo. Local-first, crittografato, zero-knowledge.",
  ja: "BookmarkForgeのプライバシーポリシーと利用規約。あなたのデータはあなたのデバイスに留まります。ローカルファースト、暗号化、ゼロナレッジ。",
  ko: "BookmarkForge 개인정보처리방침 및 서비스 약관. 데이터는 사용자 기기에 유지됩니다. 로컬-퍼스트, 암호화, 제로-놀리지.",
  nl: "BookmarkForge Privacybeleid en Gebruiksvoorwaarden. Uw gegevens blijven op uw apparaat. Local-first, versleuteld, zero-knowledge.",
  no: "BookmarkForge personvernpolicy og bruksvilkår. Dataene dine forblir på enheten din. Local-first, kryptert, zero-knowledge.",
  pl: "Polityka Prywatności i Regulamin BookmarkForge. Twoje dane pozostają na Twoim urządzeniu. Local-first, zaszyfrowane, zero-knowledge.",
  pt: "Política de Privacidade e Termos de Serviço do BookmarkForge. Seus dados ficam no seu dispositivo. Local-first, criptografado, zero-knowledge.",
  ro: "Politica de Confidențialitate și Termeni de Utilizare BookmarkForge. Datele dumneavoastră rămân pe dispozitivul dumneavoastră. Local-first, criptat, zero-knowledge.",
  ru: "Политика конфиденциальности и Условия использования BookmarkForge. Ваши данные остаются на вашем устройстве. Local-first, зашифровано, zero-knowledge.",
  sv: "BookmarkForge integritetspolicy och användarvillkor. Dina data stannar på din enhet. Local-first, krypterat, zero-knowledge.",
  th: "นโยบายความเป็นส่วนตัวและข้อกำหนดการใช้งานของ BookmarkForge ข้อมูลของคุณอยู่บนอุปกรณ์ของคุณ Local-first เข้ารหัส zero-knowledge",
  tr: "BookmarkForge Gizlilik Politikası ve Kullanım Şartları. Verileriniz cihazınızda kalır. Yerel-öncelikli, şifreli, zero-knowledge.",
  uk: "Політика конфіденційності та Умови використання BookmarkForge. Ваші дані залишаються на вашому пристрої. Local-first, зашифровано, zero-knowledge.",
  vi: "Chính sách Bảo mật và Điều khoản Dịch vụ BookmarkForge. Dữ liệu của bạn nằm trên thiết bị của bạn. Local-first, mã hóa, zero-knowledge.",
  zh: "BookmarkForge 隐私政策和服务条款。您的数据留在您的设备上。本地优先、加密、零知识。"
};

const LAST_UPDATED_LABEL = {
  ar: "آخر تحديث",
  bg: "Последна актуализация",
  cs: "Poslední aktualizace",
  da: "Sidst opdateret",
  de: "Zuletzt aktualisiert",
  el: "Τελευταία ενημέρωση",
  en: "Last Updated",
  es: "Última actualización",
  fi: "Viimeksi päivitetty",
  fr: "Dernière mise à jour",
  he: "עודכן לאחרונה",
  hi: "अंतिम अद्यतन",
  hr: "Zadnje ažuriranje",
  hu: "Utolsó frissítés",
  id: "Terakhir diperbarui",
  it: "Ultimo aggiornamento",
  ja: "最終更新日",
  ko: "최종 업데이트",
  nl: "Laatst bijgewerkt",
  no: "Sist oppdatert",
  pl: "Ostatnia aktualizacja",
  pt: "Última atualização",
  ro: "Ultima actualizare",
  ru: "Последнее обновление",
  sv: "Senast uppdaterad",
  th: "อัปเดตล่าสุด",
  tr: "Son Güncelleme",
  uk: "Останнє оновлення",
  vi: "Cập nhật lần cuối",
  zh: "最后更新"
};

// ── Read English source ───────────────────────────────────────────
const EN_SOURCE = readFileSync(resolve(PUBLIC, "privacy-and-terms.html"), "utf-8");

// ── Locales that already have a privacy page (skip these) ──────────
const EXISTING = new Set(["en", "es", "fr", "de", "pt", "it"]);

// ── Helper: adapt HTML for a locale ────────────────────────────────
function adaptForLocale(code) {
  let html = EN_SOURCE;

  const isRTL = RTL.has(code);
  const dirAttr = isRTL ? ` dir="rtl"` : "";

  // 1. <html lang="en"> -> <html lang="xx" dir="rtl">
  html = html.replace(/<html lang="en">/, `<html lang="${code}"${dirAttr}>`);

  // 2. Title
  html = html.replace(
    /<title>Privacy Policy & Terms of Service \| BookmarkForge<\/title>/,
    `<title>${TITLE_MAP[code]} | BookmarkForge</title>`
  );

  // 3. meta description
  html = html.replace(
    /<meta name="description" content="BookmarkForge Privacy Policy and Terms of Service\. Your data stays on your device\. Local-first, encrypted, zero-knowledge\."/,
    `<meta name="description" content="${META_DESC_MAP[code]}"`
  );

  // 4. canonical
  const canonicalUrl = code === "en"
    ? "https://bookmarkforge.com/privacy-and-terms.html"
    : `https://bookmarkforge.com/${code}/privacy-and-terms.html`;
  html = html.replace(
    /<link rel="canonical" href="https:\/\/bookmarkforge\.com\/privacy-and-terms\.html">/,
    `<link rel="canonical" href="${canonicalUrl}">`
  );

  // 5. hreflang links - replace the entire block
  const hreflangBlock = ALL_LOCALES.map(l => {
    const url = l === "en"
      ? "https://bookmarkforge.com/privacy-and-terms.html"
      : `https://bookmarkforge.com/${l}/privacy-and-terms.html`;
    return `  <link rel="alternate" hreflang="${l}" href="${url}">`;
  }).join("\n");
  html = html.replace(
    /(  <link rel="alternate" hreflang="en" href="https:\/\/bookmarkforge\.com\/privacy-and-terms\.html">[\s\S]*?  <link rel="alternate" hreflang="x-default" href="https:\/\/bookmarkforge\.com\/privacy-and-terms\.html">)/,
    hreflangBlock + "\n  <link rel=\"alternate\" hreflang=\"x-default\" href=\"https://bookmarkforge.com/privacy-and-terms.html\">"
  );

  // 6. OG title
  html = html.replace(
    /<meta property="og:title" content="Privacy Policy & Terms of Service \| BookmarkForge">/,
    `<meta property="og:title" content="${TITLE_MAP[code]} | BookmarkForge">`
  );

  // 7. OG description
  html = html.replace(
    /<meta property="og:description" content="BookmarkForge Privacy Policy and Terms of Service\. Your data stays on your device\. Local-first, encrypted, zero-knowledge\."/,
    `<meta property="og:description" content="${META_DESC_MAP[code]}"`
  );

  // 8. OG URL
  html = html.replace(
    /<meta property="og:url" content="https:\/\/bookmarkforge\.com\/privacy-and-terms\.html">/,
    `<meta property="og:url" content="${canonicalUrl}">`
  );

  // 9. OG locale
  html = html.replace(
    /<meta property="og:locale" content="en_US">/,
    `<meta property="og:locale" content="${OG_LOCALE[code]}">`
  );

  // 10. OG locale alternates
  const ogAlts = ALL_LOCALES.filter(l => l !== code && l !== "en").map(l => {
    return `  <meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`;
  }).join("\n");
  html = html.replace(
    /(<meta property="og:locale:alternate" content="es_ES">)/,
    `$1\n${ogAlts}`
  );

  // 11. Twitter title
  html = html.replace(
    /<meta name="twitter:title" content="Privacy Policy & Terms of Service \| BookmarkForge">/,
    `<meta name="twitter:title" content="${TITLE_MAP[code]} | BookmarkForge">`
  );

  // 12. Twitter description
  html = html.replace(
    /<meta name="twitter:description" content="BookmarkForge Privacy Policy and Terms of Service\. Your data stays on your device\. Local-first, encrypted, zero-knowledge\."/,
    `<meta name="twitter:description" content="${META_DESC_MAP[code]}"`
  );

  // 13. Header link href
  const headerHref = code === "en" ? "/" : `/${code}/`;
  html = html.replace(
    /<a href="\/" class="brand" aria-label="BookmarkForge home">/,
    `<a href="${headerHref}" class="brand" aria-label="BookmarkForge ${code === "ar" ? "الرئيسية" : code === "he" ? "דף הבית" : "home"}">`
  );

  // 14. Last updated dates
  const dates = DATE_FORMAT[code];
  html = html.replace(
    /<p class="last-updated"><strong>Last Updated:<\/strong> September 4, 2026<\/p>/,
    `<p class="last-updated"><strong>${LAST_UPDATED_LABEL[code]}:<\/strong> ${dates.privacy}<\/p>`
  );
  html = html.replace(
    /<p class="last-updated"><strong>Last Updated:<\/strong> July 23, 2026<\/p>/,
    `<p class="last-updated"><strong>${LAST_UPDATED_LABEL[code]}:<\/strong> ${dates.terms}<\/p>`
  );

  // 15. Footer copyright
  const copyrightMap = {
    ar: "جميع الحقوق محفوظة.",
    bg: "Всички права запазени.",
    cs: "Všechna práva vyhrazena.",
    da: "Alle rettigheder forbeholdes.",
    de: "Alle Rechte vorbehalten.",
    el: "Με επιφύλαξη παντός δικαιώματος.",
    en: "All rights reserved.",
    es: "Todos los derechos reservados.",
    fi: "Kaikki oikeudet pidätetään.",
    fr: "Tous droits réservés.",
    he: "כל הזכויות שמורות.",
    hi: "सभी अधिकार सुरक्षित।",
    hr: "Sva prava pridržana.",
    hu: "Minden jog fenntartva.",
    id: "Hak cipta dilindungi.",
    it: "Tutti i diritti riservati.",
    ja: "無断転載を禁じます。",
    ko: "모든 권리 보유.",
    nl: "Alle rechten voorbehouden.",
    no: "Alle rettigheter reservert.",
    pl: "Wszelkie prawa zastrzeżone.",
    pt: "Todos os direitos reservados.",
    ro: "Toate drepturile rezervate.",
    ru: "Все права защищены.",
    sv: "Alla rättigheter förbehållna.",
    th: "สงวนลิขสิทธิ์.",
    tr: "Tüm hakları saklıdır.",
    uk: "Усі права захищені.",
    vi: "Đã đăng ký bản quyền.",
    zh: "版权所有。"
  };
  html = html.replace(
    /&copy; 2026 BookmarkForge\. All rights reserved\./,
    `&copy; 2026 BookmarkForge. ${copyrightMap[code]}`
  );

  return html;
}

// ── MAIN ───────────────────────────────────────────────────────────
const missing = ALL_LOCALES.filter(l => !EXISTING.has(l));
console.log(`Generating privacy pages for ${missing.length} locales: ${missing.join(", ")}`);

let generated = 0;
for (const code of missing) {
  const html = adaptForLocale(code);
  const dir = resolve(PUBLIC, code);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const outPath = resolve(dir, "privacy-and-terms.html");
  writeFileSync(outPath, html, "utf-8");
  console.log(`  ✓ ${code}/privacy-and-terms.html (${html.length} bytes)`);
  generated++;
}

console.log(`\nDone. Generated ${generated} privacy pages.`);
console.log(`Note: Content is in English - needs full localization. Meta tags, dates, and headers are localized.`);