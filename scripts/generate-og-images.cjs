const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'og-images');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const DEFAULT_SVG_TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#00aeef;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0066cc;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <text x="600" y="280" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white">{{TITLE}}</text>
  <text x="600" y="350" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="white" opacity="0.9">{{SUBTITLE}}</text>
  <text x="1150" y="590" text-anchor="end" font-family="Arial, sans-serif" font-size="20" fill="white" opacity="0.7">BookmarkForge</text>
</svg>`;

function generateOgImage(title, subtitle, filename) {
  let svg = DEFAULT_SVG_TEMPLATE;
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const safeSubtitle = subtitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  svg = svg.replace('{{TITLE}}', safeTitle).replace('{{SUBTITLE}}', safeSubtitle);
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), svg, 'utf-8');
  console.log('Generated:', filename);
}

function generateDefaultImages() {
  generateOgImage('Everything stays on your computer.', 'Pay once. Private. AI-powered.', 'og-landing.svg');
  generateOgImage('The Private Pocket Alternative', 'Your bookmarks, encrypted locally.', 'og-pocket-alternative.svg');
  generateOgImage('BookmarkForge Help Center', 'Documentation & Guides', 'og-help.svg');
}

function generateLocalizedImages() {
  const localizations = {
    es: { title: 'Todo se queda en tu computadora', subtitle: 'Paga una vez. Privado. Con IA.' },
    fr: { title: 'Tout reste sur votre ordinateur', subtitle: 'Payez une fois. Privé. Avec IA.' },
    de: { title: 'Alles bleibt auf Ihrem Computer', subtitle: 'Einmal zahlen. Privat. Mit KI.' },
  };
  for (const [lang, content] of Object.entries(localizations)) {
    generateOgImage(content.title, content.subtitle, `og-landing-${lang}.svg`);
  }
}

function main() {
  console.log('Generating OG images...');
  generateDefaultImages();
  generateLocalizedImages();
  
  const files = fs.readdirSync(OUTPUT_DIR);
  console.log('Generated ' + files.length + ' OG images');
}

main();
