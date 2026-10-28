import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CDPClient } from './cdp_helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function getFileHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex').toLowerCase();
}

async function verifyRealAnalysisDesktopRuntime() {
  console.log('=== VERIFYING REAL RUNTIME EXECUTION OF PACKAGED ANALYSIS DESKTOP ===');
  const results = [];
  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`[PASS] ${name}`);
      results.push({ test: name, status: 'PASS', details });
    } else {
      console.error(`[FAIL] ${name}: ${details}`);
      results.push({ test: name, status: 'FAIL', details });
    }
  }

  const exePath = path.join(root, 'desktop_package', 'electron.exe');
  assert(fs.existsSync(exePath), 'Packaged executable exists on disk', exePath);

  const exeHash = getFileHash(exePath);
  console.log(`  Executable SHA-256: ${exeHash}`);
  assert(exeHash === '61f45e6f522c666c6156222680712870b38f3a4acbd2e847b987f53ddb613544', 'Executable hash matches coordinated Electron 44.9.3 baseline');

  const profileDir = path.join(root, 'data', 'temp_analysis_desktop_test_profile');
  if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  const cdpPort = 9932;
  console.log(`Starting packaged desktop executable in isolated test profile on port ${cdpPort}...`);

  const proc = spawn(exePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check'
  ], {
    cwd: path.join(root, 'desktop_package'),
    stdio: 'ignore'
  });

  assert(Boolean(proc.pid), 'Electron desktop process spawned successfully', `PID: ${proc.pid}`);

  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 100));
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (res.ok) {
        const pages = await res.json();
        const page = pages.find(p => p.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      }
    } catch (e) {}
  }

  assert(Boolean(wsUrl), 'Discovered inspectable page in packaged Electron desktop host');

  const client = new CDPClient(wsUrl);
  await client.connect();

  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');

  const networkRequests = [];
  client.on('Network.requestWillBeSent', (params) => {
    networkRequests.push(params.request.url);
  });

  const pageErrors = [];
  client.on('Runtime.exceptionThrown', (params) => {
    pageErrors.push(params.exceptionDetails.text);
  });

  // Wait for document and window.sirenDesktop
  let desktopApiReady = false;
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    const ready = await client.evaluate('Boolean(window.sirenDesktop && window.sirenDesktop.isElectron)');
    if (ready) {
      desktopApiReady = true;
      break;
    }
  }
  assert(desktopApiReady, 'window.sirenDesktop preload bridge is active in renderer');

  // Verify actual versions inside live renderer
  const runtimeVersions = await client.evaluate('window.sirenDesktop.hostVersion');
  console.log('  Live Host Versions:', runtimeVersions);
  assert(runtimeVersions?.electron === '44.9.3', 'Live Electron version is 44.9.3', runtimeVersions?.electron);
  assert(runtimeVersions?.node === '24.22.0', 'Live Node version is 24.22.0', runtimeVersions?.node);
  assert(runtimeVersions?.chrome === '152.0.7977.167', 'Live Chromium version is 152.0.7977.167', runtimeVersions?.chrome);

  // Execute pipeline via desktop IPC directly from live application
  console.log('Triggering pipeline execution via window.sirenDesktop.runPipeline in live application...');
  const runRes = await client.evaluate(`
    (async () => {
      const pipelineDef = {
        nodes: [
          {
            id: 'in_tx',
            type: 'input',
            data: { format: 'csv', path: 'data/correctness_transactions.csv', header: true }
          },
          {
            id: 'sel_tx',
            type: 'select',
            data: { columns: [{ name: 'trans_id', alias: 'id' }] }
          }
        ],
        edges: [{ source: 'in_tx', target: 'sel_tx' }]
      };
      const submit = await window.sirenDesktop.runPipeline(pipelineDef);
      return submit;
    })()
  `);

  assert(runRes?.success === true && Boolean(runRes?.jobId), 'runPipeline accepted job via Electron IPC', runRes?.jobId);

  // Poll for completion via getJobStatus
  let completedJob = null;
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 80));
    const status = await client.evaluate(`window.sirenDesktop.getJobStatus('${runRes.jobId}')`);
    if (status && status.status === 'completed') {
      completedJob = status;
      break;
    }
  }
  assert(completedJob !== null, 'Job completed successfully in background DuckDB worker');
  assert(completedJob?.nodeOutputs?.sel_tx?.rowCount > 0, 'Computed rows verified in output', completedJob?.nodeOutputs?.sel_tx?.rowCount);

  // Verify zero external network requests
  const externalRequests = networkRequests.filter(u => u.startsWith('http://') || u.startsWith('https://'));
  assert(externalRequests.length === 0, 'Zero external network requests attempted or executed', `Total external: ${externalRequests.length}`);
  assert(pageErrors.length === 0, 'Zero runtime exceptions or preload errors', pageErrors);

  // Clean application shutdown
  console.log('Closing packaged desktop application...');
  client.close();
  proc.kill('SIGTERM');

  await new Promise(r => setTimeout(r, 500));
  let isProcAlive = false;
  try {
    process.kill(proc.pid, 0);
    isProcAlive = true;
  } catch (e) {
    isProcAlive = false;
  }
  assert(!isProcAlive, 'Desktop process terminated cleanly without hanging');

  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}

  const allPassed = results.every(r => r.status === 'PASS');
  console.log(`\n=== RESULTS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASSED ===`);

  const reportPath = path.join(root, 'reports', 'REAL_DESKTOP_RUNTIME_VERIFICATION.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    component: 'SIREN Analysis Real Desktop Runtime',
    executable: {
      path: exePath,
      sha256: exeHash,
      pid: proc.pid
    },
    liveRuntimeVersions: runtimeVersions,
    executedJob: {
      jobId: runRes?.jobId,
      status: completedJob?.status,
      rowCount: completedJob?.nodeOutputs?.sel_tx?.rowCount,
      durationMs: completedJob?.telemetry?.durationMs
    },
    networkAudit: {
      totalRequests: networkRequests.length,
      externalRequests: externalRequests.length
    },
    allPassed,
    totalTests: results.length,
    results
  }, null, 2));
  console.log(`Report written to ${reportPath}`);

  if (!allPassed) process.exit(1);
}

verifyRealAnalysisDesktopRuntime().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
