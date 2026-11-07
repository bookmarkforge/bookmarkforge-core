#!/usr/bin/env node
/**
 * scripts/og-image-locale-gen.mjs
 *
 * Regenerates the localized Open Graph share cards
 *   public/og-image-<lang>.png   (es, fr, de, pt, it)
 *
 * from the same SVG template as public/og-image.png
 * (public/og-image.svg), reusing its embedded logo data-URI so the brand
 * mark stays byte-for-byte identical across every card. Only the tagline
 * <text> line differs per language.
 *
 * The tagline strings must stay in sync with the matching landing's
 * og:description — enforced by scripts/check-brand-logo-consistency.mjs
 * Guard 3 (localized-card rule) and by scripts/check-seo.mjs's
 * OG_IMAGE_POLICY (og:image must be og-image-<lang>.png per page).
 *
 * Usage:
 *   node scripts/og-image-locale-gen.mjs
 *
 * Requires: sharp (already in package.json devDependencies).
 * Run from repo root: node scripts/og-image-locale-gen.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = process.cwd();
const SVG = path.resolve(ROOT, 'public', 'og-image.svg');
const OUT_DIR = path.resolve(ROOT, 'public');

const W = 1200;
const H = 630;
const BG = '#0f1c2e';
const ACCENT = '#00aeef';

const LOGO_W = 180;
const LOGO_X = 510;
const LOGO_Y = 110;
const NAME_Y = 420;
const SLOGAN_Y = 470;


const LOCALES = [
  {
    lang: 'es',
    tagline: 'Tus marcadores, cerrados en tu ordenador',
    ogDescription:
      'Raindrop guarda tus marcadores en sus servidores y te cobra cada año. BookmarkForge los guarda en tu ordenador, cerrados para que ni siquiera nosotros podamos leerlos. 59 dólares una vez. Gratis: 1.000 marcadores.',
  },
  {
    lang: 'fr',
    tagline: 'Vos favoris, verrouillés sur votre ordinateur',
    ogDescription:
      'Raindrop garde vos favoris sur ses serveurs et vous facture chaque année. BookmarkForge les garde sur votre ordinateur, verrouillés pour que même pas nous puissions les lire. 59 dollars une fois. Gratuit : 1 000 favoris.',
  },
  {
    lang: 'de',
    tagline: 'Deine Lesezeichen, gesperrt auf deinem Computer',
    ogDescription:
      'Raindrop legt deine Lesezeichen auf seinen Servern und kassiert jedes Jahr. BookmarkForge bewahrt sie auf deinem Computer auf, gesperrt, sodass nicht mal wir sie lesen können. 59 Dollar einmalig. Kostenlos: 1.000 Lesezeichen.',
  },
  {
    lang: 'pt',
    tagline: 'Os seus marcadores, fechados no seu computador',
    ogDescription:
      'O Raindrop guarda os seus marcadores nos servidores dele e cobra-lhe todos os anos. O BookmarkForge guarda-os no seu computador, fechados para que nem nós os consigamos ler. 59 dólares uma vez. Grátis: 1.000 marcadores.',
  },
  {
    lang: 'it',
    tagline: 'I tuoi segnalibri, bloccati sul tuo computer',
    ogDescription:
      'Raindrop tiene i tuoi segnalibri sui suoi server e ti fa pagare ogni anno. BookmarkForge li tiene sul tuo computer, bloccati così nemmeno noi possiamo leggerli. 59 dollari una volta. Gratis: 1.000 segnalibri.',
  },
];

function svgForTagline(_tagline) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    `  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`,
    '>',
    `  <rect width="${W}" height="${H}" fill="${BG}"/>`,
    `  <rect x="0" y="0" width="${W}" height="4" fill="${ACCENT}"/>`,
    `  <rect x="0" y="${H - 4}" width="${W}" height="4" fill="${ACCENT}"/>`,
    `  <image x="${LOGO_X}" y="${LOGO_Y}" width="${LOGO_W}" height="${LOGO_W}"`,
    '    href="data:image/png;base64,{{LOGO}}"',
    '/>',
    `  <text x="600" y="${NAME_Y}"`,
    '    font-family="system-ui, -apple-system, sans-serif"',
    '    font-size="64" font-weight="700" fill="#ffffff"',
    '    text-anchor="middle" letter-spacing="-1"',
    '  >BookmarkForge</text>',
    `  <text x="600" y="${SLOGAN_Y}"`,
    '    font-family="system-ui, -apple-system, sans-serif"',
    '    font-size="22" fill="#a1a1aa"',
    '    text-anchor="middle" letter-spacing="0.5"',
    '  >{{TAGLINE}}</text>',
    '</svg>',
  ].join('\n');
}

async function main() {
  const svgText = fs.readFileSync(SVG, 'utf8');
  const logoMatch = svgText.match(
    /href=["']data:image\/png;base64,([A-Za-z0-9+\/=]+)["']/
  );
  if (!logoMatch) {
    console.error(
      'FAIL: cannot locate the embedded logo data-URI in public/og-image.svg'
    );
    process.exitCode = 1;
    return;
  }
  const logoB64 = logoMatch[1];

  for (const { lang, tagline } of LOCALES) {
    const svg = svgForTagline(tagline)
      .replace('{{LOGO}}', logoB64)
      .replace('{{TAGLINE}}', tagline);
    const png = await sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
    const outFile = path.resolve(OUT_DIR, `og-image-${lang}.png`);
    fs.writeFileSync(outFile, png);
      console.log(
      `wrote ${path.relative(ROOT, outFile)}  ${png.length} bytes  ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
    );
  }
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
