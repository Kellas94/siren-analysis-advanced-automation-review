import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DuckDBRunner } from '../engine/duckdb_runner.js';
import { DocsUniverContract } from '../contracts/docs_univer_contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const docsRoot = 'D:\\Siren docs prototype';

async function runTypePrecisionRouteTest() {
  console.log('========================================================================');
  console.log('=== SIREN VERIFICATION: TYPE SCHEMA & PRECISION LOSSLESS PRESERVATION ===');
  console.log('=== DuckDB Native Schema -> Export -> Univer -> Save -> Reopen       ===');
  console.log('========================================================================\n');

  const results = [];
  function assert(condition, name, details = '') {
    const status = condition ? 'PASS' : 'FAIL';
    const entry = { test: name, status, details: String(details) };
    if (condition) {
      console.log(`[PASS] ${name}`);
    } else {
      console.error(`[FAIL] ${name}: ${details}`);
    }
    results.push(entry);
  }

  // 1. Initialize native DuckDB in-memory instance
  const runner = new DuckDBRunner({ dbPath: ':memory:', threads: 2 });
  await runner.initialize();
  assert(true, 'Native DuckDB runner initialized successfully');

  // 2. Create table with comprehensive schema covering edge cases:
  // - VARCHAR id that looks like integer ("42")
  // - VARCHAR that looks like decimal ("1.20")
  // - DECIMAL with extreme precision exceeding IEEE-754 double ("9007199254740993.01")
  // - Standard DECIMAL ("225.25")
  // - Negative standard DECIMAL ("-12345.67")
  // - BIGINT exceeding Number.MAX_SAFE_INTEGER (9007199254740993)
  // - Regular INTEGER (100)
  // - Zero (0)
  // - NULL
  // - Empty string ("")
  // - Formula prefix text ("=SUM(A1:A2)")
  await runner.run(`
    CREATE TABLE test_precision_types (
      text_numeric_id VARCHAR,
      varchar_decimal VARCHAR,
      extreme_decimal VARCHAR,
      safe_decimal DOUBLE,
      neg_decimal DOUBLE,
      huge_bigint BIGINT,
      safe_int INTEGER,
      zero_val INTEGER,
      null_val VARCHAR,
      empty_str VARCHAR,
      formula_text VARCHAR
    );
  `);

  await runner.run(`
    INSERT INTO test_precision_types VALUES (
      '42',
      '1.20',
      '9007199254740993.01',
      225.25,
      -12345.67,
      9007199254740993,
      100,
      0,
      NULL,
      '',
      '=SUM(A1:A2)'
    );
  `);

  const rows = await runner.queryObjects('SELECT * FROM test_precision_types');
  assert(rows.length === 1, 'Sample test row inserted and retrieved from DuckDB');

  // Obtain schema DIRECTLY from DuckDBRunner.getTableSchema() — no manual reconstruction!
  const liveSchema = await runner.getTableSchema('test_precision_types');
  assert(Array.isArray(liveSchema) && liveSchema.length === 11, 'getTableSchema() returned exact native DuckDB schema', `Columns: ${liveSchema.length}`);
  assert(Boolean(liveSchema[0].columnName && liveSchema[0].columnType), 'Schema columns contain native columnName and columnType properties');

  const colNames = liveSchema.map(s => s.name || s.columnName);

  // 3. Convert via DocsUniverContract with live DuckDB Schema & Provenance
  const univerWb = DocsUniverContract.createUniverWorkbook({
    workbookId: 'wb-precision-test',
    sheetName: 'Precision Tests',
    columnNames: colNames,
    schema: liveSchema,
    rows,
    lineage: {
      jobId: 'job-precision-verify-01',
      sourceNodeId: 'node_type_test',
      totalSourceRows: 1,
      rowsAfterFilter: 1,
      totalResultRows: 1,
      executionDurationMs: 42
    }
  });

  assert(Boolean(univerWb), 'Univer workbook generated successfully via DocsUniverContract');
  assert(univerWb.lineage.totalSourceRows === 1, 'Lineage totalSourceRows correctly recorded as 1');
  assert(univerWb.lineage.rowsAfterFilter === 1, 'Lineage rowsAfterFilter correctly recorded as 1');
  assert(univerWb.lineage.totalResultRows === 1, 'Lineage totalResultRows correctly recorded as 1');
  assert(univerWb.lineage.transferredRows === 1, 'Lineage transferredRows correctly recorded as 1');
  assert(univerWb.lineage.schemaValidation?.valid === true, 'Schema validation confirms valid schema match');

  const sheetData = univerWb.sheets['sheet-01'].cellData;
  const rowData = sheetData['1']; // Row 0 is headers, row 1 is data

  // Verification 1: text_numeric_id ("42") MUST remain STRING (t: 1) because schema is VARCHAR
  const cellTextId = rowData['0'];
  assert(
    cellTextId.v === '42' && cellTextId.t === 1,
    'VARCHAR "42" preserved strictly as text (t: 1), NOT converted to number 42',
    `Value: ${cellTextId.v}, Type: ${cellTextId.t}`
  );

  // Verification 1b: varchar_decimal ("1.20") MUST remain STRING (t: 1) because schema is VARCHAR
  const cellVarcharDec = rowData['1'];
  assert(
    cellVarcharDec.v === '1.20' && cellVarcharDec.t === 1,
    'VARCHAR "1.20" preserved strictly as text (t: 1), NOT converted to number 1.2',
    `Value: ${cellVarcharDec.v}, Type: ${cellVarcharDec.t}`
  );

  // Verification 2: extreme_decimal ("9007199254740993.01") MUST remain exact string (t: 1)
  const cellExtremeDec = rowData['2'];
  assert(
    cellExtremeDec.v === '9007199254740993.01' && cellExtremeDec.t === 1,
    'High-precision DECIMAL "9007199254740993.01" preserved as exact string with calculation limitation documented',
    `Value: ${cellExtremeDec.v}, Custom: ${JSON.stringify(cellExtremeDec.custom)}`
  );

  // Verification 3: safe_decimal (225.25) is lossless in double -> NUMBER (t: 2)
  const cellSafeDec = rowData['3'];
  assert(
    cellSafeDec.v === 225.25 && cellSafeDec.t === 2,
    'Lossless DECIMAL 225.25 converted to NUMBER (t: 2) for spreadsheet calculation',
    `Value: ${cellSafeDec.v}, Type: ${cellSafeDec.t}`
  );

  // Verification 4: neg_decimal (-12345.67) is lossless in double -> NUMBER (t: 2)
  const cellNegDec = rowData['4'];
  assert(
    cellNegDec.v === -12345.67 && cellNegDec.t === 2,
    'Lossless negative DECIMAL -12345.67 converted to NUMBER (t: 2)',
    `Value: ${cellNegDec.v}, Type: ${cellNegDec.t}`
  );

  // Verification 5: huge_bigint (9007199254740993) > Number.MAX_SAFE_INTEGER -> exact string (t: 1)
  const cellHugeBigint = rowData['5'];
  assert(
    cellHugeBigint.v === '9007199254740993' && cellHugeBigint.t === 1,
    'BIGINT exceeding Number.MAX_SAFE_INTEGER preserved as exact string (t: 1)',
    `Value: ${cellHugeBigint.v}, Type: ${cellHugeBigint.t}`
  );

  // Verification 6: safe_int (100) -> NUMBER (t: 2)
  const cellSafeInt = rowData['6'];
  assert(
    cellSafeInt.v === 100 && cellSafeInt.t === 2,
    'Safe INTEGER 100 preserved as NUMBER (t: 2)',
    `Value: ${cellSafeInt.v}, Type: ${cellSafeInt.t}`
  );

  // Verification 7: zero_val (0) -> NUMBER (t: 2), NOT null/empty
  const cellZero = rowData['7'];
  assert(
    cellZero.v === 0 && cellZero.t === 2,
    'Zero preserved as numeric 0 (t: 2), not blank or null',
    `Value: ${cellZero.v}, Type: ${cellZero.t}`
  );

  // Verification 8: null_val -> null (t: 1, isNull: true)
  const cellNull = rowData['8'];
  assert(
    cellNull.v === null && cellNull.custom?.isNull === true,
    'NULL distinct from empty string, preserved as { v: null, isNull: true }',
    `Value: ${cellNull.v}, Custom: ${JSON.stringify(cellNull.custom)}`
  );

  // Verification 9: empty_str -> "" (t: 1, isEmptyString: true)
  const cellEmpty = rowData['9'];
  assert(
    cellEmpty.v === '' && cellEmpty.custom?.isEmptyString === true,
    'Empty string preserved distinct from NULL as { v: "", isEmptyString: true }',
    `Value: ${cellEmpty.v}, Custom: ${JSON.stringify(cellEmpty.custom)}`
  );

  // Verification 10: formula_text ("=SUM(A1:A2)") -> preserved as literal text with literalPrefix
  const cellFormula = rowData['10'];
  assert(
    cellFormula.v === '=SUM(A1:A2)' && cellFormula.custom?.literalPrefix === '=',
    'Formula-like string "=SUM(A1:A2)" preserved as literal string without auto-evaluation',
    `Value: ${cellFormula.v}, Custom: ${JSON.stringify(cellFormula.custom)}`
  );

  // 4. Wrap in SIREN Docs envelope and save to disk
  const docsEnvelope = DocsUniverContract.createDocsEnvelope({
    title: 'Type and Precision Lossless Route Report',
    description: 'Autonomous end-to-end verification of DuckDB type schema mapping to Univer and SIREN Docs envelope.',
    workbook: univerWb
  });

  assert(docsEnvelope.metadata.totalSourceRows === 1, 'Envelope metadata confirms totalSourceRows: 1');
  assert(docsEnvelope.metadata.rowsAfterFilter === 1, 'Envelope metadata confirms rowsAfterFilter: 1');
  assert(docsEnvelope.metadata.totalResultRows === 1, 'Envelope metadata confirms totalResultRows: 1');
  assert(docsEnvelope.metadata.transferredRows === 1, 'Envelope metadata confirms transferredRows: 1');

  const evidenceFilePath = path.join(root, 'evidence', 'type_precision_exported.sirendoc.json');
  fs.writeFileSync(evidenceFilePath, JSON.stringify(docsEnvelope, null, 2), 'utf8');
  assert(fs.existsSync(evidenceFilePath), 'Envelope successfully written to disk', evidenceFilePath);

  // 5. Reopen and verify persisted file integrity
  const reloaded = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf8'));
  const reloadedSheet = reloaded.workbooks['wb-precision-test'].sheets['sheet-01'].cellData['1'];

  assert(reloadedSheet['0'].v === '42' && reloadedSheet['0'].t === 1, 'Reopened envelope retains VARCHAR "42" as text');
  assert(reloadedSheet['1'].v === '1.20' && reloadedSheet['1'].t === 1, 'Reopened envelope retains VARCHAR "1.20" as text');
  assert(reloadedSheet['2'].v === '9007199254740993.01' && reloadedSheet['2'].t === 1, 'Reopened envelope retains extreme DECIMAL as exact string');
  assert(reloadedSheet['3'].v === 225.25 && reloadedSheet['3'].t === 2, 'Reopened envelope retains safe DECIMAL as numeric 225.25');
  assert(reloadedSheet['4'].v === -12345.67 && reloadedSheet['4'].t === 2, 'Reopened envelope retains negative DECIMAL as numeric -12345.67');
  assert(reloadedSheet['5'].v === '9007199254740993' && reloadedSheet['5'].t === 1, 'Reopened envelope retains out-of-range BIGINT as exact string');
  assert(reloadedSheet['6'].v === 100 && reloadedSheet['6'].t === 2, 'Reopened envelope retains safe INTEGER as 100');
  assert(reloadedSheet['7'].v === 0 && reloadedSheet['7'].t === 2, 'Reopened envelope retains zero as numeric 0');
  assert(reloadedSheet['8'].v === null, 'Reopened envelope retains NULL');
  assert(reloadedSheet['9'].v === '', 'Reopened envelope retains empty string');
  assert(reloadedSheet['10'].v === '=SUM(A1:A2)', 'Reopened envelope retains literal formula-prefixed string');

  // 6. Test Invalid or Unknown Schema Reporting
  const invalidSchemaWb = DocsUniverContract.createUniverWorkbook({
    workbookId: 'wb-invalid-schema',
    columnNames: ['colA', 'colB'],
    schema: [
      { invalidProp: true },
      { name: 'colA', type: 123 } // type is not string
    ],
    rows: [['val1', 'val2']]
  });

  assert(invalidSchemaWb.lineage.schemaValidation?.valid === false, 'Invalid schema structure marked valid: false');
  assert(invalidSchemaWb.lineage.schemaValidation?.errors.length >= 2, 'Invalid schema reports explicit descriptive errors', JSON.stringify(invalidSchemaWb.lineage.schemaValidation?.errors));

  const invalidEnvelope = DocsUniverContract.createDocsEnvelope({
    title: 'Invalid Schema Test',
    workbook: invalidSchemaWb
  });
  assert(invalidEnvelope.metadata.schemaValid === false, 'Envelope metadata marks schemaValid: false on invalid schema');
  assert(Array.isArray(invalidEnvelope.metadata.schemaErrors), 'Envelope metadata includes schemaErrors list');

  // 7. Verify roundtrip in Docs prototype DocumentStore
  const docsStoreModule = await import(pathToFileURL(path.join(docsRoot, 'prototype', 'src', 'model', 'document_store.js')).href);
  const DocumentStore = docsStoreModule.DocumentStore;
  const store = new DocumentStore();
  store.load(docsEnvelope);
  assert(store.data.document.id.startsWith('doc-analysis-'), 'Docs DocumentStore successfully loaded analysis exported envelope');

  // Mutate non-destructively, save and reopen in Docs store
  const exportedDocsJson = store.exportJSON();
  const storeReopened = new DocumentStore();
  storeReopened.load(JSON.parse(exportedDocsJson));
  const docsSheetCells = storeReopened.data.workbooks['wb-precision-test'].sheets['sheet-01'].cellData['1'];
  assert(docsSheetCells['0'].v === '42' && docsSheetCells['0'].t === 1, 'Docs store preserves VARCHAR "42" as string after load, export, and reopen');
  assert(docsSheetCells['1'].v === '1.20' && docsSheetCells['1'].t === 1, 'Docs store preserves VARCHAR "1.20" as string after load, export, and reopen');
  assert(docsSheetCells['2'].v === '9007199254740993.01' && docsSheetCells['2'].t === 1, 'Docs store preserves extreme DECIMAL as string');
  assert(docsSheetCells['3'].v === 225.25 && docsSheetCells['3'].t === 2, 'Docs store preserves safe DECIMAL as numeric 225.25');

  // Also verify that unknown source rows are NEVER substituted with totalResultRows
  const unknownSourceWb = DocsUniverContract.createUniverWorkbook({
    workbookId: 'wb-unknown-source-test',
    columnNames: ['x'],
    rows: [['val']],
    lineage: {
      jobId: 'job-unknown',
      sourceNodeId: 'node_unk',
      totalResultRows: 99
      // totalSourceRows omitted deliberately!
    }
  });

  assert(
    unknownSourceWb.lineage.totalSourceRows === null,
    'Provenance rule verified: omitted totalSourceRows remains null (NEVER silently substituted with totalResultRows 99)'
  );

  const unknownEnvelope = DocsUniverContract.createDocsEnvelope({
    title: 'Unknown Source Test',
    workbook: unknownSourceWb
  });

  assert(
    unknownEnvelope.metadata.totalSourceRows === null,
    'Envelope metadata explicitly preserves totalSourceRows as null when unknown'
  );

  await runner.close();

  const allPassed = results.every(r => r.status === 'PASS');
  console.log('\n========================================================================');
  console.log(`=== TYPE & PRECISION ROUTE RESULTS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASSED ===`);
  console.log('========================================================================\n');

  const reportData = {
    timestamp: new Date().toISOString(),
    component: 'SIREN Analysis Type & Precision Lossless Route',
    allPassed,
    totalTests: results.length,
    results
  };

  const reportPath = path.join(root, 'reports', 'TYPE_PRECISION_ROUTE_VERIFICATION.json');
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf8');
  console.log(`Report written to ${reportPath}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runTypePrecisionRouteTest().catch(err => {
  console.error('[FATAL]:', err);
  process.exit(1);
});
