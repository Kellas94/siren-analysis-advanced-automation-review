import { DuckDBRunner, formatDuckDBDecimal, safeJsonStringify } from '../engine/duckdb_runner.js';
import fs from 'node:fs';
import path from 'node:path';

async function runDecimalTests() {
  console.log('=== STARTING DECIMAL SERIALIZATION TESTS ===');
  const results = [];

  function assert(condition, testName, details) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      results.push({ test: testName, status: 'PASS', details });
    } else {
      console.error(`[FAIL] ${testName}: ${details}`);
      results.push({ test: testName, status: 'FAIL', details });
    }
  }

  // 1. Direct unit tests for formatDuckDBDecimal
  const unitCases = [
    { input: { scale: 2, value: -1n }, expected: '-0.01', name: 'Negative subunitary (-0.01)' },
    { input: { scale: 2, value: -50n }, expected: '-0.50', name: 'Negative subunitary (-0.50)' },
    { input: { scale: 4, value: -5n }, expected: '-0.0005', name: 'Negative subunitary 4 decimals (-0.0005)' },
    { input: { scale: 2, value: 0n }, expected: '0.00', name: 'Zero with scale 2 (0.00)' },
    { input: { scale: 0, value: 0n }, expected: '0', name: 'Zero with scale 0 (0)' },
    { input: { scale: 2, value: 1234n }, expected: '12.34', name: 'Positive decimal (12.34)' },
    { input: { scale: 2, value: -1234n }, expected: '-12.34', name: 'Negative multi-digit decimal (-12.34)' },
    { input: { scale: 2, value: -99999999999999n }, expected: '-999999999999.99', name: 'Large negative decimal' },
    { input: { scale: 6, value: 123456789n }, expected: '123.456789', name: 'High precision positive' },
    { input: { scale: 6, value: -123456789n }, expected: '-123.456789', name: 'High precision negative' }
  ];

  for (const tc of unitCases) {
    const formatted = formatDuckDBDecimal(tc.input);
    assert(formatted === tc.expected, `Unit: ${tc.name}`, `Got "${formatted}", expected "${tc.expected}"`);
  }

  // 2. Real DuckDB Instance query test with DECIMAL columns
  const runner = new DuckDBRunner({ dbPath: ':memory:' });
  try {
    await runner.initialize();
    console.log('[INFO] DuckDB initialized for decimal test.');

    const sql = `
      SELECT 
        -0.01::DECIMAL(12,2) AS neg_sub,
        -0.50::DECIMAL(12,2) AS neg_half,
        -0.0005::DECIMAL(12,4) AS neg_tiny,
        0.00::DECIMAL(12,2) AS zero_val,
        12.34::DECIMAL(12,2) AS pos_val,
        -9999999999.99::DECIMAL(18,2) AS large_neg,
        -123456.789012::DECIMAL(18,6) AS neg_high_scale,
        42::BIGINT AS big_int,
        DATE '2026-10-25' AS date_val,
        NULL AS null_val,
        'Hello DuckDB' AS text_val
    `;

    const rowObjects = await runner.queryObjects(sql);
    console.log('[INFO] Query objects returned:', rowObjects);

    // Verify safeJsonStringify does NOT throw on BigInt or Decimal
    let serialized = '';
    let parsed = null;
    try {
      serialized = safeJsonStringify(rowObjects);
      parsed = JSON.parse(serialized);
      assert(true, 'safeJsonStringify does not throw on Decimal/BigInt/Date/Null', 'Serialized successfully');
    } catch (e) {
      assert(false, 'safeJsonStringify does not throw on Decimal/BigInt/Date/Null', e.message);
    }

    if (parsed && parsed.length > 0) {
      const row = parsed[0];
      console.log('[INFO] Parsed serialized row:', row);

      assert(row.neg_sub === '-0.01', 'DuckDB query: neg_sub formatted to -0.01', `Got: ${row.neg_sub}`);
      assert(row.neg_half === '-0.50', 'DuckDB query: neg_half formatted to -0.50', `Got: ${row.neg_half}`);
      assert(row.neg_tiny === '-0.0005', 'DuckDB query: neg_tiny formatted to -0.0005', `Got: ${row.neg_tiny}`);
      assert(row.zero_val === '0.00', 'DuckDB query: zero_val formatted to 0.00', `Got: ${row.zero_val}`);
      assert(row.pos_val === '12.34', 'DuckDB query: pos_val formatted to 12.34', `Got: ${row.pos_val}`);
      assert(row.large_neg === '-9999999999.99', 'DuckDB query: large_neg formatted to -9999999999.99', `Got: ${row.large_neg}`);
      assert(row.neg_high_scale === '-123456.789012', 'DuckDB query: neg_high_scale formatted to -123456.789012', `Got: ${row.neg_high_scale}`);
      assert(row.big_int === '42', 'DuckDB query: big_int formatted to string "42"', `Got: ${row.big_int}`);
      assert(row.null_val === null, 'DuckDB query: null_val preserved as null', `Got: ${row.null_val}`);
      assert(row.text_val === 'Hello DuckDB', 'DuckDB query: text_val preserved as text', `Got: ${row.text_val}`);
    }

    await runner.close();
  } catch (err) {
    assert(false, 'DuckDB decimal integration execution', err.message);
  }

  const allPassed = results.every(r => r.status === 'PASS');
  console.log(`\n=== RESULTS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASSED ===`);

  const reportPath = path.resolve('reports/DECIMAL_SERIALIZATION_REPORT.json');
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

runDecimalTests();
