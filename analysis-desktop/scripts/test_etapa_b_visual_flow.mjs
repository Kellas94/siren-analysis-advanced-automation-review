import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChrome, CDPClient } from './cdp_helper.mjs';
import { server, runnerService } from '../server/index.js';

async function runEtapaBFlowTest() {
  console.log('=== STARTING ETAPA B VISUAL & FUNCTIONAL FLOW VERIFICATION ===');
  const results = [];

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      results.push({ test: testName, status: 'PASS', details });
    } else {
      console.error(`[FAIL] ${testName}: ${details}`);
      results.push({ test: testName, status: 'FAIL', details });
    }
  }

  const address = server.address();
  const port = address ? address.port : 3001;
  const url = `http://127.0.0.1:${port}/index.html`;
  console.log(`Launching Chrome to test visual flow at ${url}...`);

  const { chromeProcess, wsUrl } = await launchChrome(9877, 'about:blank');
  const client = new CDPClient(wsUrl);
  await client.connect();

  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('DOM.enable');

  client.on('Runtime.consoleAPICalled', (params) => {
    const text = (params.args || []).map(a => a.value || a.description).join(' ');
    console.log(`[Browser Console]: ${text}`);
  });

  client.on('Runtime.exceptionThrown', (params) => {
    console.error(`[Browser Exception]:`, params.exceptionDetails?.text, params.exceptionDetails?.exception?.description);
  });

  // Explicitly navigate
  await client.send('Page.navigate', { url });

  // Wait for React Flow and UI to mount
  let appReady = false;
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 150));
    const title = await client.evaluate('document.querySelector("h1")?.innerText || ""');
    if (title.includes('SIREN')) {
      appReady = true;
      break;
    }
  }
  assert(appReady, 'React Flow application mounted successfully in Chrome');

  // Verify initial nodes render on canvas
  const nodeCount = await client.evaluate('document.querySelectorAll(".react-flow__node").length');
  assert(nodeCount >= 7, 'Visual canvas renders pipeline nodes', `Rendered ${nodeCount} nodes`);

  // Verify Node Inspector renders
  const inspectorTitle = await client.evaluate('document.querySelector("h3")?.innerText || ""');
  assert(inspectorTitle.length > 0, 'Node Inspector header is rendered', inspectorTitle);

  // Trigger Initial Run Workflow via Run button
  console.log('Clicking "Run Workflow" button in UI...');
  const runClickRes = await client.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const runBtn = btns.find(b => b.innerText.includes('Run Workflow'));
      if (runBtn) {
        runBtn.click();
        return true;
      }
      return false;
    })()
  `);
  assert(runClickRes === true, 'Found and clicked "Run Workflow" button');

  // Poll for completion in the UI
  console.log('Waiting for UI status to transition to COMPLETED...');
  let completed = false;
  let statusText = '';
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 200));
    statusText = await client.evaluate('document.querySelector("footer")?.innerText || ""');
    if (statusText.includes('STATUS: COMPLETED')) {
      completed = true;
      break;
    }
  }
  assert(completed, 'UI workflow transitioned to STATUS: COMPLETED via async job polling', statusText);

  // Verify bounded preview table populated
  const tableRows = await client.evaluate('document.querySelectorAll("table tbody tr").length');
  assert(tableRows > 0, 'Bounded preview table renders real computed rows', `Found ${tableRows} rows`);

  // Click on Filter Node on canvas to inspect it
  console.log('Selecting filter node on canvas...');
  await client.evaluate(`
    (() => {
      const nodeEl = document.querySelector('[data-id="node_3_filt_valid"]');
      if (nodeEl) nodeEl.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 200));

  const filterHeader = await client.evaluate('document.querySelector("h3")?.innerText || ""');
  assert(filterHeader.includes('Filter Valid Rows'), 'Node Inspector updated to Filter Valid Rows', filterHeader);

  // Test Inspector editing and downstream invalidation
  console.log('Testing parameter editing in Node Inspector...');
  const invalidationRes = await client.evaluate(`
    (() => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      const condInput = inputs.find(inp => inp.value.includes('REJECTED'));
      if (!condInput) return { success: false, reason: 'Condition input not found' };

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(condInput, "tx_status != 'REJECTED'");
      condInput.dispatchEvent(new Event('input', { bubbles: true }));
      condInput.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true };
    })()
  `);
  assert(invalidationRes.success === true, 'Modified parameter in Node Inspector');

  await new Promise(r => setTimeout(r, 300));

  // Verify downstream nodes marked OUTDATED
  const outdatedBadges = await client.evaluate(`
    (() => {
      const allText = document.body.innerText;
      return allText.includes('OUTDATED') || allText.includes('Parameters modified');
    })()
  `);
  assert(outdatedBadges, 'Downstream nodes and inspector reflect OUTDATED state upon parameter change');

  // Re-run workflow to clear outdated state
  console.log('Re-running workflow with modified condition...');
  await client.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const runBtn = btns.find(b => b.innerText.includes('Run Workflow'));
      if (runBtn) runBtn.click();
    })()
  `);

  let reCompleted = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 200));
    const st = await client.evaluate('document.querySelector("footer")?.innerText || ""');
    if (st.includes('STATUS: COMPLETED')) {
      reCompleted = true;
      break;
    }
  }
  assert(reCompleted, 'Workflow successfully re-executed with updated parameters');

  // Test Export to Docs button
  console.log('Clicking "Export Node to Docs" button in UI...');
  await client.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const expBtn = btns.find(b => b.innerText.includes('Export Node to Docs'));
      if (expBtn) expBtn.click();
    })()
  `);

  // Wait for alert banner confirming export
  let exportSuccess = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 100));
    const bannerText = await client.evaluate('document.body.innerText || ""');
    if (bannerText.includes('Export Succeeded!') || bannerText.includes('sirendoc.json')) {
      exportSuccess = true;
      break;
    }
  }
  assert(exportSuccess, 'UI confirms SIREN Docs envelope export success');

  // Verify exported envelope file physically on disk
  const exportedPath = path.resolve('evidence/exported_analysis.sirendoc.json');
  assert(fs.existsSync(exportedPath), 'Exported SIREN Docs envelope file exists on disk', exportedPath);
  if (fs.existsSync(exportedPath)) {
    const envelope = JSON.parse(fs.readFileSync(exportedPath, 'utf8'));
    assert(envelope.schemaVersion === '1.0.0', 'Envelope schemaVersion is 1.0.0');
    assert(envelope.workbooks && Object.keys(envelope.workbooks).length > 0, 'Envelope contains valid workbook data');
  }

  // Teardown
  client.close();
  chromeProcess.kill();
  runnerService.destroy();
  server.close();

  const allPassed = results.every(r => r.status === 'PASS');
  console.log(`\n=== RESULTS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASSED ===`);

  const reportPath = path.resolve('reports/ETAPA_B_FLOW_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    allPassed,
    totalTests: results.length,
    results
  }, null, 2));
  console.log(`Report written to ${reportPath}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runEtapaBFlowTest().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
