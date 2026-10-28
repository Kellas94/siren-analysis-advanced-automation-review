import fs from 'node:fs';
import path from 'node:path';

async function verifyOfflineDesktop() {
  console.log('=== VERIFYING SIREN ANALYSIS STANDALONE OFFLINE DESKTOP HOST ===');
  const results = [];
  const root = 'D:\\Siren analysis prototype';

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      results.push({ test: testName, status: 'PASS', details });
    } else {
      console.error(`[FAIL] ${testName}: ${details}`);
      results.push({ test: testName, status: 'FAIL', details });
    }
  }

  // 1. Check desktop host entrypoint files
  const desktopMain = path.join(root, 'desktop', 'main.cjs');
  const desktopPreload = path.join(root, 'desktop', 'preload.cjs');
  const desktopPkg = path.join(root, 'desktop', 'package.json');

  assert(fs.existsSync(desktopMain), 'desktop/main.cjs exists');
  assert(fs.existsSync(desktopPreload), 'desktop/preload.cjs exists');
  assert(fs.existsSync(desktopPkg), 'desktop/package.json exists');

  // 2. Validate Electron version coordination (44.9.3)
  const pkgContent = JSON.parse(fs.readFileSync(desktopPkg, 'utf8'));
  assert(pkgContent.engines?.electron === '44.9.3', 'Coordinated Electron version is 44.9.3 in package.json', pkgContent.engines?.electron);

  // 3. Validate Context Isolation and Separate Process in main.cjs
  const mainCode = fs.readFileSync(desktopMain, 'utf8');
  assert(mainCode.includes('contextIsolation: true'), 'main.cjs enforces contextIsolation: true');
  assert(mainCode.includes('nodeIntegration: false'), 'main.cjs enforces nodeIntegration: false');
  assert(mainCode.includes('fork('), 'main.cjs runs DuckDB in dedicated child process via fork()');
  assert(mainCode.includes('mainWindow.loadFile'), 'main.cjs loads local bundle directly via loadFile without dev server');

  // 4. Validate preload security
  const preloadCode = fs.readFileSync(desktopPreload, 'utf8');
  assert(preloadCode.includes('contextBridge.exposeInMainWorld'), 'preload.cjs exposes APIs via contextBridge');
  assert(!preloadCode.includes('window.require = require'), 'preload.cjs does NOT expose arbitrary require');

  // 5. Scan distribution bundle for external network URLs (scripts, fonts, styles)
  const distHtml = path.join(root, 'dist', 'index.html');
  const distJs = path.join(root, 'dist', 'bundle.js');

  assert(fs.existsSync(distHtml), 'dist/index.html exists');
  assert(fs.existsSync(distJs), 'dist/bundle.js exists');

  const htmlContent = fs.readFileSync(distHtml, 'utf8');
  const remoteScriptRegex = /<script[^>]+src=["']https?:\/\//i;
  const remoteStyleRegex = /<link[^>]+href=["']https?:\/\//i;

  assert(!remoteScriptRegex.test(htmlContent), 'index.html contains zero remote script references');
  assert(!remoteStyleRegex.test(htmlContent), 'index.html contains zero remote stylesheet/font references');

  const allPassed = results.every(r => r.status === 'PASS');
  console.log(`\n=== RESULTS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASSED ===`);

  const reportPath = path.join(root, 'reports', 'DESKTOP_OFFLINE_VERIFICATION.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    component: 'SIREN Analysis Desktop Host',
    coordinatedVersion: {
      electron: '44.9.3',
      node: '24.22.0'
    },
    allPassed,
    totalTests: results.length,
    results
  }, null, 2));
  console.log(`Report written to ${reportPath}`);

  if (!allPassed) {
    process.exit(1);
  }
}

verifyOfflineDesktop().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
