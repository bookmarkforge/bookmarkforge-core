/**
 * Script para generar PDFs legales para Whop
 * 
 * Genera 4 documentos PDF requeridos por Whop:
 * 1. Términos de servicio (Terms of Service)
 * 2. Política de privacidad (Privacy Policy)
 * 3. Política de devoluciones (Refund Policy)
 * 4. EULA (End User License Agreement)
 * 
 * Uso:
 *   node scripts/generate-legal-pdfs.mjs
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'legal-pdfs');

// Crear directorio de salida si no existe
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Contenido de la política de devoluciones (basada en Whop)
const REFUND_POLICY_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Refund Policy | BookmarkForge</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    h1 {
      color: #1a1a1a;
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 10px;
    }
    h2 {
      color: #1a1a1a;
      margin-top: 30px;
    }
    p {
      margin-bottom: 15px;
    }
    ul {
      margin-bottom: 15px;
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
    .last-updated {
      color: #666;
      font-style: italic;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <p class="last-updated"><strong>Last Updated:</strong> October 5, 2026</p>

  <h1>Refund Policy</h1>

  <h2>1. 30-Day Money-Back Guarantee</h2>
  <p>BookmarkForge offers a 30-day money-back guarantee on all Lifetime license purchases. If you are not satisfied with your purchase, you may request a full refund within 30 days of your original purchase date.</p>

  <h2>2. How to Request a Refund</h2>
  <p>To request a refund, please contact us through Whop with:</p>
  <ul>
    <li>Your order number</li>
    <li>The email address used for purchase</li>
    <li>A brief explanation of why you are requesting a refund</li>
  </ul>

  <h2>3. Refund Processing</h2>
  <p>Refunds are processed through Whop. Once approved, the refund will be issued to your original payment method within 5-10 business days. The exact timing depends on your payment provider.</p>

  <h2>4. Eligibility</h2>
  <p>To be eligible for a refund:</p>
  <ul>
    <li>The request must be made within 30 days of purchase</li>
    <li>You must not have violated the Terms of Service</li>
    <li>You must not have engaged in fraudulent activity</li>
  </ul>

  <h2>5. Non-Refundable Situations</h2>
  <p>Refunds may be denied if:</p>
  <ul>
    <li>The 30-day period has elapsed</li>
    <li>There is evidence of Terms of Service violations</li>
    <li>There is evidence of fraudulent activity</li>
    <li>The license has been transferred or shared in violation of the agreement</li>
  </ul>

  <h2>6. License Deactivation</h2>
  <p>Upon approval of a refund, your license will be deactivated and you will no longer have access to Pro features. However, your data remains yours and you can continue using the Free tier.</p>

  <h2>7. Contact</h2>
  <p>If you have questions about this refund policy, please contact us through Whop or at support@bookmarkforgeapp.com.</p>

  <h2>8. Changes to This Policy</h2>
  <p>We reserve the right to modify this refund policy at any time. Changes will be posted on this page with an updated revision date.</p>
</body>
</html>
`;

// Contenido del EULA
const EULA_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>End User License Agreement | BookmarkForge</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    h1 {
      color: #1a1a1a;
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 10px;
    }
    h2 {
      color: #1a1a1a;
      margin-top: 30px;
    }
    p {
      margin-bottom: 15px;
    }
    ul {
      margin-bottom: 15px;
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
    .last-updated {
      color: #666;
      font-style: italic;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <p class="last-updated"><strong>Last Updated:</strong> October 5, 2026</p>

  <h1>End User License Agreement (EULA)</h1>

  <p>This End User License Agreement ("EULA") is a legal agreement between you ("Licensee") and BookmarkForge ("Licensor") for the BookmarkForge software application.</p>

  <h2>1. License Grant</h2>
  <p>Subject to the terms of this EULA, Licensor grants you a non-exclusive, non-transferable, perpetual license to use BookmarkForge Pro features for the lifetime of version 1.x.</p>

  <h2>2. Permitted Uses</h2>
  <p>You may:</p>
  <ul>
    <li>Install and use BookmarkForge on up to 5 devices simultaneously</li>
    <li>Use the software for personal or commercial purposes</li>
    <li>Export your data at any time in supported formats</li>
    <li>Use the Free tier features without a license</li>
  </ul>

  <h2>3. Restrictions</h2>
  <p>You may not:</p>
  <ul>
    <li>Reverse engineer, decompile, or disassemble the software</li>
    <li>Remove or alter any proprietary notices on the software</li>
    <li>Distribute, sell, or share your license key</li>
    <li>Use the software for illegal purposes</li>
    <li>Attempt to bypass license verification or security measures</li>
  </ul>

  <h2>4. License Key</h2>
  <p>Your license key is unique to you and must not be shared. Sharing your license key may result in revocation of your license without refund.</p>

  <h2>5. Updates and Support</h2>
  <p>Your Lifetime license includes:</p>
  <ul>
    <li>All minor updates within version 1.x (e.g., 1.0 → 1.1 → 1.2)</li>
    <li>12 months of feature updates from the date of purchase</li>
    <li>Security updates for the lifetime of version 1.x</li>
    <li>Email support (48-hour response time, Monday-Friday)</li>
  </ul>
  <p>Major version updates (e.g., v2.0) may require an additional purchase, with a 60% discount for existing v1 license holders.</p>

  <h2>6. Data Ownership</h2>
  <p>Your data remains yours at all times. BookmarkForge stores your data locally on your device with client-side encryption. You have the right to export your data at any time.</p>

  <h2>7. Termination</h2>
  <p>This license is effective until terminated. Your rights under this EULA will terminate automatically without notice if you fail to comply with any of its terms. Upon termination, you must cease all use of the software.</p>

  <h2>8. Disclaimer of Warranty</h2>
  <p>The software is provided "AS IS" without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>

  <h2>9. Limitation of Liability</h2>
  <p>In no event shall Licensor be liable for any indirect, incidental, special, or consequential damages arising out of the use or inability to use the software, even if advised of the possibility of such damages.</p>

  <h2>10. Governing Law</h2>
  <p>This EULA is governed by the laws of the jurisdiction in which the operator is established. Any disputes shall be resolved in the courts of that jurisdiction.</p>

  <h2>11. Entire Agreement</h2>
  <p>This EULA constitutes the entire agreement between you and Licensor regarding the use of the software and supersedes all prior agreements.</p>

  <h2>12. Contact</h2>
  <p>For questions about this EULA, contact us at support@bookmarkforgeapp.com.</p>
</body>
</html>
`;

// Función para generar PDF desde HTML
async function generatePDF(html, outputPath, title) {
  console.log(`Generating ${title}...`);
  
  const browser = await puppeteer.launch({ 
    headless: 'new',
    protocolTimeout: 120000 // Aumentar timeout a 2 minutos
  });
  const page = await browser.newPage();
  
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
  
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20px',
      right: '20px',
      bottom: '20px',
      left: '20px'
    }
  });
  
  await browser.close();
  console.log(`✓ Generated: ${outputPath}`);
}

// Función principal
async function main() {
  console.log('📄 Generating legal PDFs for Whop...\n');
  
  // Leer el archivo HTML existente
  const privacyTermsPath = path.join(PUBLIC_DIR, 'privacy-and-terms.html');
  const privacyTermsHTML = fs.readFileSync(privacyTermsPath, 'utf-8');
  
  // Buscar las secciones de forma más robusta
  const privacyMatch = privacyTermsHTML.match(/<h1>Privacy Policy<\/h1>[\s\S]*?(?=<h1[^>]*>Terms of Service<\/h1>)/);
  const termsMatch = privacyTermsHTML.match(/<h1[^>]*>Terms of Service<\/h1>[\s\S]*?(?=<\/main>)/);
  
  if (!privacyMatch || !termsMatch) {
    console.error('Privacy match:', privacyMatch ? 'found' : 'not found');
    console.error('Terms match:', termsMatch ? 'found' : 'not found');
    throw new Error('Could not find Privacy Policy or Terms of Service sections');
  }
  
  const privacyContent = privacyMatch[0];
  const termsContent = termsMatch[0];
  
  const privacyHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy | BookmarkForge</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    h1 {
      color: #1a1a1a;
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 10px;
    }
    h2 {
      color: #1a1a1a;
      margin-top: 30px;
    }
    p {
      margin-bottom: 15px;
    }
    ul {
      margin-bottom: 15px;
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }
    .last-updated {
      color: #666;
      font-style: italic;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <p class="last-updated"><strong>Last Updated:</strong> October 5, 2026</p>
  ${privacyContent}
</body>
</html>
`;
  
  const termsHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service | BookmarkForge</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    h1 {
      color: #1a1a1a;
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 10px;
    }
    h2 {
      color: #1a1a1a;
      margin-top: 30px;
    }
    p {
      margin-bottom: 15px;
    }
    ul {
      margin-bottom: 15px;
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }
    .last-updated {
      color: #666;
      font-style: italic;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <p class="last-updated"><strong>Last Updated:</strong> October 5, 2026</p>
  ${termsContent}
</body>
</html>
`;
  
  // Generar los 4 PDFs
  await generatePDF(privacyHTML, path.join(OUTPUT_DIR, 'Privacy-Policy.pdf'), 'Privacy Policy');
  await generatePDF(termsHTML, path.join(OUTPUT_DIR, 'Terms-of-Service.pdf'), 'Terms of Service');
  await generatePDF(REFUND_POLICY_CONTENT, path.join(OUTPUT_DIR, 'Refund-Policy.pdf'), 'Refund Policy');
  await generatePDF(EULA_CONTENT, path.join(OUTPUT_DIR, 'EULA.pdf'), 'EULA');
  
  console.log('\n✅ All legal PDFs generated successfully!');
  console.log(`📁 Output directory: ${OUTPUT_DIR}`);
  console.log('\nFiles generated:');
  console.log('  - Privacy-Policy.pdf');
  console.log('  - Terms-of-Service.pdf');
  console.log('  - Refund-Policy.pdf');
  console.log('  - EULA.pdf');
  console.log('\nYou can now upload these PDFs to Whop.');
}

main().catch(error => {
  console.error('Error generating PDFs:', error);
  process.exit(1);
});
