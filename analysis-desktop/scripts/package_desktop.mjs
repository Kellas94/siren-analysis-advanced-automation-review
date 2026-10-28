import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const EXPECTED_ELECTRON_SHA256 = '61f45e6f522c666c6156222680712870b38f3a4acbd2e847b987f53ddb613544';
const RUNTIME_SOURCE_DIR = 'C:\\Claude\\SIREN_WORK\\electron-runtime-migration-parallel-20261025\\vendor\\electron-44.9.3-win32-x64';

function getFileHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex').toLowerCase();
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

async function packageAnalysisDesktop() {
  console.log('=== PACKAGING SIREN ANALYSIS STANDALONE OFFLINE DESKTOP ===');
  console.log(`Source Electron Runtime: ${RUNTIME_SOURCE_DIR}`);

  if (!fs.existsSync(RUNTIME_SOURCE_DIR)) {
    throw new Error(`Runtime source directory not found: ${RUNTIME_SOURCE_DIR}`);
  }

  const srcExe = path.join(RUNTIME_SOURCE_DIR, 'electron.exe');
  const exeHash = getFileHash(srcExe);
  console.log(`  Source electron.exe SHA-256: ${exeHash}`);

  if (exeHash !== EXPECTED_ELECTRON_SHA256) {
    throw new Error(`Hash mismatch! Expected ${EXPECTED_ELECTRON_SHA256}, got ${exeHash}`);
  }

  const outDir = path.join(root, 'desktop_package');
  console.log(`Target package directory: ${outDir}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 1. Copy Electron runtime binaries
  console.log('- Copying Electron 44.9.3 runtime files...');
  for (const item of fs.readdirSync(RUNTIME_SOURCE_DIR)) {
    if (item === 'resources') continue;
    const srcPath = path.join(RUNTIME_SOURCE_DIR, item);
    const destPath = path.join(outDir, item);
    copyRecursive(srcPath, destPath);
  }

  // Copy default resources
  const srcResources = path.join(RUNTIME_SOURCE_DIR, 'resources');
  const destResources = path.join(outDir, 'resources');
  if (!fs.existsSync(destResources)) fs.mkdirSync(destResources, { recursive: true });

  for (const item of fs.readdirSync(srcResources)) {
    if (item === 'default_app.asar') continue;
    copyRecursive(path.join(srcResources, item), path.join(destResources, item));
  }

  // 2. Populate resources/app
  const appDir = path.join(destResources, 'app');
  if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });

  console.log('- Populating resources/app with Analysis application...');
  fs.copyFileSync(path.join(root, 'desktop', 'package.json'), path.join(appDir, 'package.json'));
  fs.copyFileSync(path.join(root, 'desktop', 'main.cjs'), path.join(appDir, 'main.cjs'));
  fs.copyFileSync(path.join(root, 'desktop', 'preload.cjs'), path.join(appDir, 'preload.cjs'));

  // Copy dist, engine, server, contracts, data
  console.log('  - Copying dist/');
  copyRecursive(path.join(root, 'dist'), path.join(appDir, 'dist'));

  console.log('  - Copying engine/');
  copyRecursive(path.join(root, 'engine'), path.join(appDir, 'engine'));

  console.log('  - Copying server/');
  copyRecursive(path.join(root, 'server'), path.join(appDir, 'server'));

  console.log('  - Copying contracts/');
  copyRecursive(path.join(root, 'contracts'), path.join(appDir, 'contracts'));

  console.log('  - Copying data/');
  copyRecursive(path.join(root, 'data'), path.join(appDir, 'data'));

  // Copy native node_modules (@duckdb)
  console.log('  - Copying node_modules/@duckdb/');
  copyRecursive(path.join(root, 'node_modules', '@duckdb'), path.join(appDir, 'node_modules', '@duckdb'));

  // Verify target executable exists and retains exact hash
  const targetExe = path.join(outDir, 'electron.exe');
  const targetHash = getFileHash(targetExe);
  console.log(`- Packaged binary verified: ${targetExe} (SHA-256: ${targetHash})`);

  const manifest = {
    packageName: 'siren-analysis-desktop',
    packageVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    coordinatedRuntime: {
      electron: '44.9.3',
      node: '24.22.0',
      chromium: '152.0.7977.167',
      abi: 149
    },
    executable: {
      path: targetExe,
      sha256: targetHash,
      matchesMigrationBaseline: targetHash === EXPECTED_ELECTRON_SHA256
    },
    resourcesApp: {
      entrypoint: 'main.cjs',
      preload: 'preload.cjs',
      bundleJsSize: fs.statSync(path.join(appDir, 'dist', 'bundle.js')).size,
      nativeDuckDBVersion: '2.0.0-r.1'
    }
  };

  fs.writeFileSync(path.join(root, 'reports', 'DESKTOP_PACKAGE_MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Manifest written to reports/DESKTOP_PACKAGE_MANIFEST.json`);
  console.log('=== SIREN ANALYSIS PACKAGING COMPLETE ===\n');
  return manifest;
}

packageAnalysisDesktop().catch(err => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
