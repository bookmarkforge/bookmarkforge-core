import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

const altText = 'BookmarkForge — private AI-powered bookmark and notes app';

const htmlFiles = globSync('public/**/*.html');

let modifiedCount = 0;

for (const file of htmlFiles) {
  const content = readFileSync(file, 'utf-8');

  // Check if file has og:image but not og:image:alt
  if (content.includes('og:image') && !content.includes('og:image:alt')) {
    // Find the og:image line and add og:image:alt after it
    const ogImagePattern = /(<meta property="og:image"[^>]*>)/;
    const newContent = content.replace(ogImagePattern, `$1\n    <meta property="og:image:alt" content="${altText}">`);
    
    if (newContent !== content) {
      writeFileSync(file, newContent, 'utf-8');
      modifiedCount++;
      console.log(`✓ Modified: ${file}`);
    }
  }
}

console.log(`\nTotal files modified: ${modifiedCount}`);
