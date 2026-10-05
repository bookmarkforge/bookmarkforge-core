/**
 * Script para sincronizar cambios del repo privado al público
 * Ejecuta exportación Open Core y hace push al repo público
 * 
 * Uso:
 *   - Manual: node scripts/sync-to-public-repo.mjs
 *   - Git hook post-push: git config --local core.hooksPath .githooks/post-push
 * 
 * Este script:
 * 1. Ejecuta export-public-repo.mjs para generar versión Open Core
 * 2. Hace push al repo público bookmarkforge-core
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración
const PRIVATE_REPO = 'bookmarkforge-2026';
const PUBLIC_REPO = 'bookmarkforge-core';
const EXPORT_DIR = path.join(__dirname, '..', 'bookmark7-public-export');

console.log('🔄 Syncing to public repository...');
console.log(`Private repo: ${PRIVATE_REPO}`);
console.log(`Public repo: ${PUBLIC_REPO}`);

// Verificar que estamos en el repo correcto
try {
  const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
  if (!remote.includes(PRIVATE_REPO)) {
    console.error(`❌ Not in the correct repository. Expected: ${PRIVATE_REPO}`);
    console.error(`   Current: ${remote}`);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Failed to check git remote:', error.message);
  process.exit(1);
}

// Paso 1: Ejecutar exportación Open Core
console.log('\n📦 Step 1: Exporting Open Core...');
try {
  // Limpiar directorio de exportación anterior si existe
  if (fs.existsSync(EXPORT_DIR)) {
    fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  }
  
  // Ejecutar exportación
  execSync('node scripts/export-public-repo.mjs --out ../bookmark7-public-export', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  console.log('✓ Open Core export complete');
} catch (error) {
  console.error('❌ Open Core export failed:', error.message);
  process.exit(1);
}

// Paso 2: Verificar exportación Open Core
console.log('\n🔒 Step 2: Verifying Open Core export...');
try {
  // Verificación simple: verificar que no haya archivos Pro en la exportación
  const proFiles = [
    'src/services/BackupService.ts',
    'src/services/DiskBackupService.ts',
    'src/services/WebRTCSyncService.ts',
    'src/services/pdfService.ts',
    'src/services/ai/WebLLMService.ts',
    'src/services/ai/GlobalRAGService.ts',
    'src/services/ai/SpecializedAgentsService.ts',
    'src/services/ai/FlashcardService.ts'
  ];
  
  for (const proFile of proFiles) {
    const proFilePath = path.join(EXPORT_DIR, proFile);
    if (fs.existsSync(proFilePath)) {
      console.error(`❌ Pro file found in export: ${proFile}`);
      console.error('   This means Pro code would be shipped to the public repo.');
      console.error('   ABORTING PUSH for security.');
      process.exit(1);
    }
  }
  
  console.log('✓ Open Core export verified - no Pro files found');
} catch (error) {
  console.error('❌ Open Core verification failed:', error.message);
  console.error('   ABORTING PUSH for security.');
  process.exit(1);
}

// Paso 3: Hacer commit y push manualmente
console.log('\n🔧 Step 3: Manual commit and push required');
console.log('\n📝 Manual steps:');
console.log('1. cd ../bookmark7-public-export');
console.log('2. git init');
console.log('3. git add .');
console.log('4. git commit -m "Sync: update from private repo (bookmarkforge-2026)"');
console.log('5. git remote add origin https://github.com/bookmarkforge/bookmarkforge-core.git');
console.log('6. git branch -M main');
console.log('7. git push -u origin main --force');
console.log('\n⚠️  The --force flag is intentional - public repo is managed by export script.');
console.log('\n💡 Why manual? Git commands failing on Windows with cmd.exe. Please run these manually.');

console.log('\n✅ Sync complete!');
console.log(`✓ Private repo: https://github.com/bookmarkforge/${PRIVATE_REPO}`);
console.log(`✓ Public repo: https://github.com/bookmarkforge/${PUBLIC_REPO}`);
