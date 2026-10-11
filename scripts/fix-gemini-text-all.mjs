#!/usr/bin/env node
/**
 * Fix Gemini provider text in ALL translation files
 * Changes all variations of "key managed by us" to "with your own key" in each language
 */

import { readFileSync, writeFileSync } from 'fs';
import { readdirSync } from 'fs';
import { join } from 'path';

const TRANSLATIONS_DIR = join(process.cwd(), 'scripts', 'translations');

// Map of patterns to replace in each language
const replacements = {
  'ar.json': [
    { old: 'Google Gemini (المفتاح يديرناه)', new: 'Google Gemini (بمفتاحك الخاص)' },
  ],
  'bg.json': [
    { old: 'Google Gemini (ключът се управлява от нас)', new: 'Google Gemini (с вашия собственен ключ)' },
  ],
  'cs.json': [
    { old: 'Google Gemini (klíč spravujeme my)', new: 'Google Gemini (s vaším vlastním klíčem)' },
  ],
  'da.json': [
    { old: 'Google Gemini (nøgle administreres af os)', new: 'Google Gemini (med din egen nøgle)' },
  ],
  'de.json': [
    { old: 'Google Gemini (Schlüssel liegt bei uns)', new: 'Google Gemini (mit deinem eigenen Schlüssel)' },
  ],
  'el.json': [
    { old: 'Google Gemini (κλειδί διαχειρίζεται από εμάς)', new: 'Google Gemini (με το δικό σας κλειδί)' },
  ],
  'en.json': [
    { old: 'Google Gemini (key managed by us)', new: 'Google Gemini (with your own key)' },
  ],
  'es.json': [
    { old: 'Google Gemini (clave gestionada por nosotros)', new: 'Google Gemini (con tu propia clave)' },
  ],
  'fi.json': [
    { old: 'Google Gemini (avain hallinnoidut meidän toimesta)', new: 'Google Gemini (omalla avaimellasi)' },
  ],
  'fr.json': [
    { old: 'Google Gemini (clé gérée par nous)', new: 'Google Gemini (avec votre propre clé)' },
  ],
  'he.json': [
    { old: 'Google Gemini (מפתח מנוהל על ידינו)', new: 'Google Gemini (עם המפתח שלך)' },
  ],
  'hi.json': [
    { old: 'Google Gemini (कुंजी हमारे द्वारा प्रबंधित)', new: 'Google Gemini (अपनी खुद की कुंजी के साथ)' },
  ],
  'hr.json': [
    { old: 'Google Gemini (ključ upravlja mi)', new: 'Google Gemini (s vlastitim ključem)' },
  ],
  'hu.json': [
    { old: 'Google Gemini (kulcsot mi kezeljük)', new: 'Google Gemini (saját kulccsal)' },
  ],
  'id.json': [
    { old: 'Google Gemini (kunci dikelola oleh kami)', new: 'Google Gemini (dengan kunci Anda sendiri)' },
  ],
  'it.json': [
    { old: 'Google Gemini (chiave gestita da noi)', new: 'Google Gemini (con la tua chiave)' },
  ],
  'ja.json': [
    { old: 'Google Gemini (キーは当社が管理)', new: 'Google Gemini (ご自身のキーで)' },
  ],
  'ko.json': [
    { old: 'Google Gemini (키는 당사가 관리)', new: 'Google Gemini (자체 키로)' },
  ],
  'nl.json': [
    { old: 'Google Gemini (sleutel beheerd door ons)', new: 'Google Gemini (met uw eigen sleutel)' },
  ],
  'no.json': [
    { old: 'Google Gemini (nøkkel administreres av oss)', new: 'Google Gemini (med din egen nøkkel)' },
  ],
  'pl.json': [
    { old: 'Google Gemini (klucz zarządzany przez nas)', new: 'Google Gemini (własnym kluczem)' },
  ],
  'pt.json': [
    { old: 'Google Gemini (chave gerida por nós)', new: 'Google Gemini (com sua própria chave)' },
  ],
  'ro.json': [
    { old: 'Google Gemini (cheie gestionată de noi)', new: 'Google Gemini (cu cheia dvs.)' },
  ],
  'ru.json': [
    { old: 'Google Gemini (ключ управляется нами)', new: 'Google Gemini (с вашим собственным ключом)' },
  ],
  'sv.json': [
    { old: 'Google Gemini (nyckel hanteras av oss)', new: 'Google Gemini (med din egen nyckel)' },
  ],
  'th.json': [
    { old: 'Google Gemini (คีย์จัดการโดยเรา)', new: 'Google Gemini (ด้วยคีย์ของคุณเอง)' },
  ],
  'tr.json': [
    { old: 'Google Gemini (anahtar bizim tarafımızdan yönetilir)', new: 'Google Gemini (kendi anahtarınızla)' },
  ],
  'uk.json': [
    { old: 'Google Gemini (ключ керується нами)', new: 'Google Gemini (з вашим власним ключем)' },
  ],
  'vi.json': [
    { old: 'Google Gemini (khóa được quản lý bởi chúng tôi)', new: 'Google Gemini (với khóa riêng của bạn)' },
  ],
  'zh.json': [
    { old: 'Google Gemini (密钥由我们管理)', new: 'Google Gemini (使用您自己的密钥)' },
  ],
};

const files = readdirSync(TRANSLATIONS_DIR).filter(f => f.endsWith('.json') && replacements[f]);

let modifiedCount = 0;

for (const file of files) {
  const filePath = join(TRANSLATIONS_DIR, file);
  const fileReplacements = replacements[file];
  
  if (!fileReplacements) continue;
  
  let content = readFileSync(filePath, 'utf-8');
  let fileModified = false;
  
  for (const { old, new: newText } of fileReplacements) {
    if (content.includes(old)) {
      content = content.replace(old, newText);
      fileModified = true;
    }
  }
  
  if (fileModified) {
    writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Fixed ${file}`);
    modifiedCount++;
  }
}

console.log(`\nTotal files modified: ${modifiedCount}`);
