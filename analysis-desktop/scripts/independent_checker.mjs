import fs from 'node:fs';
import path from 'node:path';
import { DuckDBRunner } from '../engine/duckdb_runner.js';

async function runIndependentCheck() {
  console.log('===============================================================');
  console.log('   SIREN Analysis & Automation — Enhanced Physical Dataset Checker');
  console.log('===============================================================');

  const baseDir = path.resolve('.');
  const reportsDir = path.join(baseDir, 'reports');
  const dataDir = path.join(baseDir, 'data');
  const evidenceDir = path.join(baseDir, 'evidence');

  const checkResults = {
    checkerTimestamp: new Date().toISOString(),
    status: 'PASS',
    checks: [],
    negativeControls: []
  };

  function recordCheck(code, title, pass, details = {}) {
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${code}: ${title}`);
    if (!pass) console.error('  Details:', details);
    checkResults.checks.push({ code, title, passed: pass, details });
    if (!pass) checkResults.status = 'FAIL';
  }

  // 1. Audit Deliverable Documentation
  const requiredDocs = [
    'STATUS.md',
    'WORK_LOG.md',
    'ARCHITECTURE.md',
    'CAPABILITY_MATRIX.md',
    'DEPENDENCIES.csv',
    'BENCHMARK_PLAN.md',
    'HANDOFF.md',
    'RECOMMENDATION_REPORT.md'
  ];
  for (const doc of requiredDocs) {
    const p = path.join(baseDir, doc);
    const exists = fs.existsSync(p) && fs.statSync(p).size > 100;
    recordCheck(`DOC-${doc.replace(/[^a-zA-Z0-9]/g, '_')}`, `Document "${doc}" exists and is populated`, exists);
  }

  // 2. Audit Correctness Report
  const corrReportPath = path.join(reportsDir, 'CORRECTNESS_REPORT.json');
  let corrJson = null;
  if (fs.existsSync(corrReportPath)) {
    try {
      corrJson = JSON.parse(fs.readFileSync(corrReportPath, 'utf8'));
    } catch (e) {}
  }
  const corrPassed = corrJson && corrJson.summary?.status === 'ALL_TESTS_PASS' && corrJson.summary?.failed === 0;
  recordCheck('VERIF-CORR-01', 'Correctness Suite executed with 100% pass rate (14/14)', corrPassed, corrJson?.summary);

  // 3. Connect to DuckDB native runner to inspect physical files directly on disk
  console.log('\n[Physical Dataset Invariant Assertions via DuckDB native queries]');
  const runner = new DuckDBRunner({ dbPath: ':memory:', maxMemory: '4GB', threads: 4 });
  await runner.initialize();

  try {
    // A. bench_1m.parquet
    const p1m = path.join(dataDir, 'bench_1m.parquet').replace(/\\/g, '/');
    if (fs.existsSync(p1m)) {
      const [{ count: c1m }] = await runner.queryObjects(`SELECT COUNT(*)::BIGINT AS count FROM read_parquet('${p1m}')`);
      recordCheck('PHYS-1M-COUNT', 'bench_1m.parquet exact row count === 1,000,000', Number(c1m) === 1000000, { rowCount: Number(c1m) });

      const statusRows1m = await runner.queryObjects(`SELECT status, COUNT(*)::BIGINT AS cnt FROM read_parquet('${p1m}') GROUP BY status ORDER BY status`);
      const statusMap1m = Object.fromEntries(statusRows1m.map(r => [r.status, Number(r.cnt)]));
      const hasAllStatuses1m = statusMap1m['CANCELLED'] === 50000 && statusMap1m['PENDING'] === 50000 && statusMap1m['COMPLETED'] === 900000;
      recordCheck('PHYS-1M-STATUS', 'bench_1m.parquet reachability of CANCELLED, PENDING, COMPLETED', hasAllStatuses1m, statusMap1m);
    } else {
      recordCheck('PHYS-1M-EXISTS', 'bench_1m.parquet file exists', false);
    }

    // B. bench_10m_wide.parquet
    const p10mWide = path.join(dataDir, 'bench_10m_wide.parquet').replace(/\\/g, '/');
    if (fs.existsSync(p10mWide)) {
      const [{ count: c10m }] = await runner.queryObjects(`SELECT COUNT(*)::BIGINT AS count FROM read_parquet('${p10mWide}')`);
      recordCheck('PHYS-10M-WIDE-COUNT', 'bench_10m_wide.parquet exact row count === 10,000,000', Number(c10m) === 10000000, { rowCount: Number(c10m) });

      const [{ depts: distinctDepts }] = await runner.queryObjects(`SELECT COUNT(DISTINCT dept_code)::BIGINT AS depts FROM read_parquet('${p10mWide}')`);
      recordCheck('PHYS-10M-HIGH-CARD', 'bench_10m_wide.parquet has 50 distinct high-cardinality departments', Number(distinctDepts) === 50, { distinctDepts: Number(distinctDepts) });

      const [{ null_discounts: nullDiscounts }] = await runner.queryObjects(`SELECT COUNT(*)::BIGINT AS null_discounts FROM read_parquet('${p10mWide}') WHERE discount_pct IS NULL`);
      recordCheck('PHYS-10M-NULLS', 'bench_10m_wide.parquet contains genuine numeric NULLs', Number(nullDiscounts) > 0, { nullDiscounts: Number(nullDiscounts) });
    }

    // C. bench_100m.parquet
    const p100m = path.join(dataDir, 'bench_100m.parquet').replace(/\\/g, '/');
    if (fs.existsSync(p100m)) {
      const [{ count: c100m }] = await runner.queryObjects(`SELECT COUNT(*)::BIGINT AS count FROM read_parquet('${p100m}')`);
      recordCheck('PHYS-100M-COUNT', 'bench_100m.parquet exact row count === 100,000,000', Number(c100m) === 100000000, { rowCount: Number(c100m) });

      const statusRows100m = await runner.queryObjects(`SELECT status, COUNT(*)::BIGINT AS cnt FROM read_parquet('${p100m}') GROUP BY status ORDER BY status`);
      const statusMap100m = Object.fromEntries(statusRows100m.map(r => [r.status, Number(r.cnt)]));
      const hasAllStatuses100m = statusMap100m['CANCELLED'] === 5000000 && statusMap100m['PENDING'] === 5000000 && statusMap100m['COMPLETED'] === 90000000;
      recordCheck('PHYS-100M-STATUS', 'bench_100m.parquet reachability: CANCELLED (5M), PENDING (5M), COMPLETED (90M)', hasAllStatuses100m, statusMap100m);
    } else {
      recordCheck('PHYS-100M-EXISTS', 'bench_100m.parquet file exists', false);
    }

    // D. correctness_transactions.csv
    const pTxCsv = path.join(dataDir, 'correctness_transactions.csv').replace(/\\/g, '/');
    if (fs.existsSync(pTxCsv)) {
      const [{ count: cTx }] = await runner.queryObjects(`SELECT COUNT(*)::BIGINT AS count FROM read_csv('${pTxCsv}', all_varchar=true)`);
      recordCheck('PHYS-TX-CSV-COUNT', 'correctness_transactions.csv has exactly 10 rows', Number(cTx) === 10, { count: Number(cTx) });

      // Verify BigInt ID 9007199254740993 preservation
      const bigIntRows = await runner.queryObjects(`SELECT trans_id FROM read_csv('${pTxCsv}', all_varchar=true) WHERE trans_id = '9007199254740993'`);
      recordCheck('PHYS-TX-BIGINT', 'BigInt ID 9007199254740993 (>2^53) preserved without IEEE-754 truncation', bigIntRows.length === 1);

      // Verify NULL amount on row 2
      const nullRows = await runner.queryObjects(`SELECT trans_id FROM read_csv('${pTxCsv}', all_varchar=true) WHERE trans_id = '2' AND (amount IS NULL OR amount = '')`);
      recordCheck('PHYS-TX-NULL-AMT', 'Empty field in CSV parsed as empty/null amount on row 2', nullRows.length === 1);

      // Verify Romanian diacritics
      const diacriticsRows = await runner.queryObjects(`SELECT note FROM read_csv('${pTxCsv}', all_varchar=true) WHERE trans_id = '7'`);
      const diacriticsValid = diacriticsRows.length > 0 && diacriticsRows[0].note.includes('școală, țară, pâine');
      recordCheck('PHYS-TX-UNICODE', 'Unicode diacritics preserved intact in CSV', diacriticsValid);
    } else {
      recordCheck('PHYS-TX-CSV-EXISTS', 'correctness_transactions.csv exists', false);
    }

    // E. correctness_customers.csv
    const pCustCsv = path.join(dataDir, 'correctness_customers.csv').replace(/\\/g, '/');
    if (fs.existsSync(pCustCsv)) {
      const [{ count: cCust }] = await runner.queryObjects(`SELECT COUNT(*)::BIGINT AS count FROM read_csv('${pCustCsv}', all_varchar=true)`);
      recordCheck('PHYS-CUST-CSV-COUNT', 'correctness_customers.csv has exactly 7 rows', Number(cCust) === 7, { count: Number(cCust) });

      // Verify duplicate key 00050 exists exactly twice
      const dupRows = await runner.queryObjects(`SELECT cust_code, COUNT(*)::BIGINT AS c FROM read_csv('${pCustCsv}', all_varchar=true) WHERE cust_code = '00050' GROUP BY cust_code`);
      recordCheck('PHYS-CUST-DUP-KEY', 'Duplicate customer code 00050 exists for join fan-out validation', dupRows.length === 1 && Number(dupRows[0].c) === 2);
    }

    // 4. Negative Controls on Physical Data Querying
    console.log('\n[Negative Controls on Dataset Integrity]');
    
    // Negative Control 1: Query non-existent column must reject with error
    try {
      await runner.queryRows(`SELECT nonexistent_column FROM read_parquet('${p1m}') LIMIT 1`);
      checkResults.negativeControls.push({ name: 'Nonexistent column query', pass: false });
      console.log('  [FAIL] Negative Control 1: Nonexistent column did not fail as expected');
    } catch (err) {
      checkResults.negativeControls.push({ name: 'Nonexistent column query', pass: true });
      console.log('  [PASS] Negative Control 1: Nonexistent column rejected with Binder Error');
    }

    // Negative Control 2: Corrupted numeric cast without TRY_CAST must throw error
    try {
      await runner.queryRows(`SELECT CAST('CORRUPT_NOT_A_NUMBER' AS DECIMAL(12,2))`);
      checkResults.negativeControls.push({ name: 'Strict cast corrupt input', pass: false });
      console.log('  [FAIL] Negative Control 2: Strict cast on corrupted input did not fail');
    } catch (err) {
      checkResults.negativeControls.push({ name: 'Strict cast corrupt input', pass: true });
      console.log('  [PASS] Negative Control 2: Strict cast on corrupted input rejected with Conversion Error');
    }

  } finally {
    await runner.close();
  }

  // 5. Audit Docs + Univer Contract Transfer Artifact
  const sirendocPath = path.join(evidenceDir, 'exported_analysis.sirendoc.json');
  let sirendocJson = null;
  if (fs.existsSync(sirendocPath)) {
    try {
      sirendocJson = JSON.parse(fs.readFileSync(sirendocPath, 'utf8'));
    } catch (e) {}
  }
  const sirendocValid = sirendocJson && sirendocJson.schemaVersion === '1.0.0' && sirendocJson.engineName === 'univer' && Array.isArray(sirendocJson.document?.blocks);
  recordCheck('VERIF-DOCS-01', 'SIREN Docs export envelope v1.0.0 validated', sirendocValid, {
    schemaVersion: sirendocJson?.schemaVersion,
    blocks: sirendocJson?.document?.blocks?.length
  });

  // 6. Audit Visual Editor UI Bundle
  const bundleJs = path.join(baseDir, 'dist', 'bundle.js');
  const bundleHtml = path.join(baseDir, 'dist', 'index.html');
  const uiBuilt = fs.existsSync(bundleJs) && fs.existsSync(bundleHtml) && fs.statSync(bundleJs).size > 50000;
  recordCheck('VERIF-UI-01', 'React Flow UI editor bundled and ready in dist/', uiBuilt, {
    jsBytes: fs.existsSync(bundleJs) ? fs.statSync(bundleJs).size : 0
  });

  // Final instrument-control gate: failed corruption controls invalidate the verdict.
  if (checkResults.negativeControls.some(control => control.pass !== true)) checkResults.status = 'FAIL';

  // Save independent verification report
  const outPath = path.join(reportsDir, 'INDEPENDENT_CHECK_REPORT.json');
  fs.writeFileSync(outPath, JSON.stringify(checkResults, null, 2), 'utf8');
  console.log('\n===============================================================');
  console.log(`Independent verification finished: ${checkResults.status}`);
  console.log(`Report written to: ${outPath}`);
  console.log('===============================================================');

  if (checkResults.status !== 'PASS') {
    process.exit(1);
  }
}

runIndependentCheck().catch(err => {
  console.error('Fatal checker error:', err);
  process.exit(1);
});
