/**
 * SIREN Analysis & Advanced Automation — Transfer Contract to SIREN Docs & Univer
 *
 * Implements strict data isolation & lossless type preservation:
 * - Big data remains exclusively on disk (Parquet/CSV).
 * - Univer receives aggregated metrics, pivot tables, or bounded previews.
 * - Explicitly distinguishes NULL from empty string "".
 * - Explicitly separates:
 *     1. totalSourceRowsProcessed (raw rows processed by pipeline sources)
 *     2. totalResultRows (exact row count of the computed node output)
 *     3. transferredRows (exact count of rows embedded in the Univer sheet)
 *     4. transferStatus ('COMPLETE' | 'SAMPLED' | 'TRUNCATED')
 * - fullFileExportAvailable is verified against physical file existence on disk (never inferred from string path!).
 * - Conforms to SIREN Docs file envelope schema v1.0.0.
 */

import fs from 'node:fs';

export class DocsUniverContract {
  /**
   * Converts a tabular result into a Univer-compatible workbook structure.
   *
   * @param {Object} params
   * @param {string} params.workbookId Unique workbook ID
   * @param {string} params.sheetName Display name for the sheet
   * @param {string[]} params.columnNames Column headers
   * @param {Array<Array<any>>} params.rows Data rows (row-major matrix)
   * @param {Object} [params.lineage] Pipeline traceability metadata
   * @returns {Object} Univer workbook descriptor
   */
  static createUniverWorkbook({
    workbookId = 'wb-analysis-01',
    sheetName = 'Analysis Result',
    columnNames,
    schema = [],
    rows = [],
    lineage = {}
  }) {
    if (!columnNames || !Array.isArray(columnNames)) {
      throw new Error('Contract Error: columnNames must be an array of strings');
    }

    const MAX_UNIVER_ROWS = 1000;
    const transferredRows = rows ? rows.length : 0;

    // 1. totalResultRows: Total rows in the computed result of this node
    const totalResultRows = (lineage.totalResultRows !== undefined && lineage.totalResultRows !== null)
      ? Number(lineage.totalResultRows)
      : (lineage.totalAvailableRows !== undefined && lineage.totalAvailableRows !== null ? Number(lineage.totalAvailableRows) : transferredRows);

    // 2. totalSourceRows: Total raw rows processed across pipeline sources
    // STRICT RULE: Never substitute totalSourceRows with totalResultRows if unknown!
    // Leave explicitly null if not provided in lineage.
    let totalSourceRows = null;
    if (lineage.totalSourceRows !== undefined && lineage.totalSourceRows !== null) {
      totalSourceRows = Number(lineage.totalSourceRows);
    } else if (lineage.totalSourceRowsProcessed !== undefined && lineage.totalSourceRowsProcessed !== null) {
      totalSourceRows = Number(lineage.totalSourceRowsProcessed);
    }

    // 3. rowsAfterFilter: Rows remaining after filtering stage
    const rowsAfterFilter = (lineage.rowsAfterFilter !== undefined && lineage.rowsAfterFilter !== null)
      ? Number(lineage.rowsAfterFilter)
      : null;

    // 4. Determine Transfer Status strictly:
    // - COMPLETE: transferred rows equals total result rows (and <= 1000)
    // - TRUNCATED: total result rows exceeds Univer limit (>1000) and transferred is capped at 1000
    // - SAMPLED: transferred rows is a subset of total result rows (e.g. 50 preview rows transferred when total is 51 or 1M)
    let transferStatus;
    let isTruncated = false;
    let isSampled = false;

    if (totalResultRows === 0) {
      transferStatus = 'COMPLETE';
    } else if (totalResultRows > MAX_UNIVER_ROWS && transferredRows >= MAX_UNIVER_ROWS) {
      transferStatus = 'TRUNCATED';
      isTruncated = true;
    } else if (transferredRows < totalResultRows) {
      transferStatus = 'SAMPLED';
      isSampled = true;
    } else {
      transferStatus = 'COMPLETE';
    }

    const boundedRows = (rows || []).slice(0, MAX_UNIVER_ROWS);

    // 5. Physical Full File Verification
    // Never declare fullFileExportAvailable: true just because a string was constructed!
    // Stale files from previous jobs/sessions do NOT qualify current export!
    let fullFileExportAvailable = false;
    let verifiedExportPath = null;
    if (lineage.fullExportPath && typeof lineage.fullExportPath === 'string') {
      try {
        if (fs.existsSync(lineage.fullExportPath)) {
          const st = fs.statSync(lineage.fullExportPath);
          const jobStartedAt = lineage.jobStartedAt ? new Date(lineage.jobStartedAt).getTime() : 0;
          if (st.size > 0 && (jobStartedAt === 0 || st.mtimeMs >= (jobStartedAt - 2000))) {
            fullFileExportAvailable = true;
            verifiedExportPath = lineage.fullExportPath;
          }
        }
      } catch (e) {
        fullFileExportAvailable = false;
        verifiedExportPath = null;
      }
    }

    // Build schema type lookup map (columnName -> uppercase DuckDB type) with strict validation
    const typeMap = new Map();
    const schemaValidation = {
      valid: true,
      errors: [],
      declaredTypes: {}
    };

    if (Array.isArray(schema)) {
      for (let i = 0; i < schema.length; i++) {
        const col = schema[i];
        if (!col || typeof col !== 'object') {
          schemaValidation.valid = false;
          schemaValidation.errors.push(`Column at index ${i} is not a valid schema object`);
          continue;
        }
        const colName = col.columnName || col.name;
        const colType = col.columnType || col.type;
        if (!colName || typeof colName !== 'string') {
          schemaValidation.valid = false;
          schemaValidation.errors.push(`Column at index ${i} is missing a string name/columnName`);
          continue;
        }
        if (!colType || typeof colType !== 'string') {
          schemaValidation.valid = false;
          schemaValidation.errors.push(`Column "${colName}" at index ${i} is missing a string type/columnType`);
          continue;
        }
        const normalizedType = colType.trim().toUpperCase();
        typeMap.set(colName, normalizedType);
        schemaValidation.declaredTypes[colName] = normalizedType;
      }
    } else if (schema !== undefined && schema !== null) {
      schemaValidation.valid = false;
      schemaValidation.errors.push(`Invalid schema format: expected array of column definitions, got ${typeof schema}`);
    }

    // Verify all requested columnNames against the declared schema
    if (typeMap.size > 0) {
      for (const colName of columnNames) {
        if (!typeMap.has(colName)) {
          schemaValidation.valid = false;
          schemaValidation.errors.push(`Column "${colName}" not found in declared schema`);
        }
      }
    }

    const sheetId = 'sheet-01';
    const cellData = {};

    // Row 0: Column Headers
    cellData[0] = {};
    for (let c = 0; c < columnNames.length; c++) {
      cellData[0][c] = {
        v: columnNames[c],
        t: 1, // STRING
        s: {
          b: 1, // Bold
          bg: { rgb: '#F1F5F9' },
          cl: { rgb: '#0F172A' }
        }
      };
    }

    // Prominent Notice Banner Row for TRUNCATED or SAMPLED
    let currentRowOffset = 1;
    if (isTruncated) {
      cellData[1] = {
        0: {
          v: `⚠️ [TRUNCATED]: Afișează 1.000 din ${totalResultRows.toLocaleString()} rânduri ale rezultatului. ${fullFileExportAvailable ? `Setul complet salvat pe disc: ${verifiedExportPath}` : 'Fișier complet nesalvat pe disc.'}`,
          t: 1,
          s: { b: 1, cl: { rgb: '#B91C1C' }, bg: { rgb: '#FEF2F2' } }
        }
      };
      currentRowOffset = 2;
    } else if (isSampled) {
      cellData[1] = {
        0: {
          v: `ℹ️ [SAMPLED]: Eșantion previzualizare de ${transferredRows} rânduri din ${totalResultRows.toLocaleString()} rânduri totale ale rezultatului. ${fullFileExportAvailable ? `Fișier complet pe disc: ${verifiedExportPath}` : ''}`,
          t: 1,
          s: { b: 1, cl: { rgb: '#D97706' }, bg: { rgb: '#FFFBEB' } }
        }
      };
      currentRowOffset = 2;
    }

    // Helper: Determine if a decimal string can be losslessly represented in IEEE-754 double (53-bit mantissa)
    function isLosslessDouble(strVal) {
      if (typeof strVal !== 'string') return false;
      const num = Number(strVal);
      if (!Number.isFinite(num)) return false;
      const clean = strVal.replace('-', '');
      const parts = clean.split('.');
      // If integer part digits exceed safe integer threshold (~15 digits), precision is compromised
      if (parts[0].length > 15) return false;
      // Significant digits count (excluding leading zeros)
      const sigDigits = clean.replace('.', '').replace(/^0+/, '');
      if (sigDigits.length > 15) return false;
      if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return false;
      // Precision check by roundtripping to the same decimal scale
      if (parts.length > 1) {
        const formatted = num.toFixed(parts[1].length);
        if (formatted !== strVal && Math.abs(Number(formatted) - Number(strVal)) > 0) {
          return false;
        }
      }
      return true;
    }

    // Populate data cells with strict schema & type preservation:
    // - DuckDB column types are transferred directly; types are NOT deduced purely from text appearance.
    // - VARCHAR/TEXT/CHAR remains literal text (t: 1), even if value is "42" or numeric.
    // - DECIMAL exceeding IEEE-754 double precision (e.g. "9007199254740993.01") is preserved as exact string with calculation limitation documented.
    // - BIGINT exceeding Number.MAX_SAFE_INTEGER is preserved as exact string (t: 1).
    // - Lossless decimals/integers within safe precision become NUMBER (t: 2) so Univer calculates them.
    // - NULL is { v: null, t: 1, custom: { isNull: true } }.
    // - Empty string is { v: '', t: 1, custom: { isEmptyString: true } }.
    // - Zero is numeric 0 (t: 2).
    // - Strings starting with '=' are preserved as literal text without formula evaluation.
    for (let r = 0; r < boundedRows.length; r++) {
      const rowIndex = r + currentRowOffset;
      cellData[rowIndex] = {};
      const row = boundedRows[r];

      for (let c = 0; c < columnNames.length; c++) {
        const colName = columnNames[c];
        const declaredType = typeMap.get(colName) || '';

        let val;
        if (Array.isArray(row)) {
          val = row[c];
        } else if (row && typeof row === 'object') {
          val = row[colName] !== undefined ? row[colName] : row[c];
        } else {
          val = row;
        }

        // Unwrap { val: ... } or { v: ... } cell objects if provided
        if (val !== null && typeof val === 'object' && ('val' in val || 'v' in val)) {
          val = 'val' in val ? val.val : val.v;
        }

        if (val === null || val === undefined) {
          cellData[rowIndex][c] = {
            v: null,
            t: 1,
            custom: { isNull: true, dbType: declaredType || undefined }
          };
        } else if (val === '') {
          cellData[rowIndex][c] = {
            v: '',
            t: 1,
            custom: { isEmptyString: true, dbType: declaredType || undefined }
          };
        } else if (typeof val === 'string' && val.startsWith('=')) {
          // Text starting with '=': preserve as literal text without formula evaluation
          cellData[rowIndex][c] = {
            v: val,
            t: 1,
            custom: { literalPrefix: '=', dbType: declaredType || undefined }
          };
        } else if (declaredType && (declaredType.includes('VARCHAR') || declaredType.includes('TEXT') || declaredType.includes('CHAR') || declaredType.includes('STRING') || declaredType.includes('BLOB'))) {
          // Explicit DuckDB VARCHAR/TEXT: MUST remain string (t: 1), even if value is "42" or numeric!
          cellData[rowIndex][c] = {
            v: String(val),
            t: 1,
            custom: { dbType: declaredType }
          };
        } else if (val === 0 || val === 0n) {
          // Numeric zero is a real number, never empty/null
          cellData[rowIndex][c] = { v: 0, t: 2, custom: { dbType: declaredType || 'INTEGER' } };
        } else if (typeof val === 'boolean') {
          cellData[rowIndex][c] = { v: val ? 'TRUE' : 'FALSE', t: 1, custom: { dbType: declaredType || 'BOOLEAN' } };
        } else if (typeof val === 'bigint' || declaredType === 'BIGINT' || declaredType === 'INT8') {
          const strVal = String(val);
          try {
            const b = BigInt(strVal);
            if (b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER)) {
              cellData[rowIndex][c] = { v: Number(b), t: 2, custom: { isBigInt: true, raw: strVal, dbType: declaredType || 'BIGINT' } };
            } else {
              // Beyond safe integer: preserve exact string to prevent truncation/precision loss
              cellData[rowIndex][c] = {
                v: strVal,
                t: 1,
                custom: {
                  isBigInt: true,
                  raw: strVal,
                  dbType: declaredType || 'BIGINT',
                  precisionPreservedAsString: true,
                  formulaLimitation: 'Exceeds IEEE-754 Number.MAX_SAFE_INTEGER; preserved as exact string to prevent arithmetic corruption in spreadsheet engine'
                }
              };
            }
          } catch (e) {
            cellData[rowIndex][c] = { v: strVal, t: 1, custom: { dbType: declaredType || 'BIGINT' } };
          }
        } else if (declaredType && (declaredType.startsWith('DECIMAL') || declaredType.startsWith('NUMERIC'))) {
          const strVal = String(val);
          if (isLosslessDouble(strVal)) {
            cellData[rowIndex][c] = {
              v: Number(strVal),
              t: 2,
              custom: { isDecimal: true, raw: strVal, dbType: declaredType }
            };
          } else {
            // Cannot be represented faithfully in IEEE-754 double: keep exact string representation!
            cellData[rowIndex][c] = {
              v: strVal,
              t: 1,
              custom: {
                isDecimal: true,
                raw: strVal,
                dbType: declaredType,
                precisionPreservedAsString: true,
                formulaLimitation: 'Exceeds IEEE-754 double precision limit (~15 significant decimal digits); preserved as exact string to prevent arithmetic corruption in spreadsheet engine'
              }
            };
          }
        } else if (typeof val === 'number') {
          if (Number.isNaN(val) || !Number.isFinite(val)) {
            cellData[rowIndex][c] = { v: null, t: 1, custom: { isNaN: true, dbType: declaredType || undefined } };
          } else {
            cellData[rowIndex][c] = { v: val, t: 2, custom: { dbType: declaredType || 'DOUBLE' } };
          }
        } else if (typeof val === 'string') {
          // Strict Rule: Never deduce numeric types solely from string content!
          // Strings remain literal text (t: 1) unless the column is explicitly declared as a numeric type (DECIMAL/INT/DOUBLE)
          cellData[rowIndex][c] = {
            v: val,
            t: 1,
            custom: { dbType: declaredType || 'VARCHAR' }
          };
        } else {
          cellData[rowIndex][c] = { v: String(val), t: 1 };
        }
      }
    }

    const effectiveRowCount = Math.max(boundedRows.length + currentRowOffset + 5, 20);
    const effectiveColCount = Math.max(columnNames.length, 10);

    return {
      id: workbookId,
      name: sheetName,
      appVersion: '1.2.0',
      sheetOrder: [sheetId],
      sheets: {
        [sheetId]: {
          id: sheetId,
          name: sheetName,
          rowCount: effectiveRowCount,
          columnCount: effectiveColCount,
          cellData
        }
      },
      lineage: {
        jobId: lineage.jobId || 'unknown',
        sourceNodeId: lineage.sourceNodeId || lineage.nodeId || 'unknown',
        totalSourceRows,
        totalSourceRowsProcessed: totalSourceRows,
        rowsAfterFilter,
        totalResultRows,
        transferredRows: boundedRows.length,
        transferStatus, // 'COMPLETE' | 'TRUNCATED' | 'SAMPLED'
        fullFileExportAvailable,
        fullExportPath: verifiedExportPath,
        schemaValidation: {
          valid: schemaValidation.valid,
          errors: schemaValidation.errors,
          columnCount: columnNames.length,
          mappedColumns: typeMap.size
        },
        executionDurationMs: lineage.executionDurationMs || 0,
        exportedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Generates a complete, validated SIREN Docs document envelope (Schema v1.0.0)
   * embedding narrative documentation and the Univer workbook.
   */
  static createDocsEnvelope({ title, description, workbook, lineage = {} }) {
    if (!workbook || !workbook.id) {
      throw new Error('createDocsEnvelope requires a valid Univer workbook object');
    }

    const docId = `doc-analysis-${Date.now()}`;
    const tableBlockId = 'block-table-01';
    const lin = workbook.lineage || lineage;

    const narrativeParagraphs = [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: description || 'Acest document conține rezultate sintetizate de motorul de analiză SIREN.'
          }
        ]
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Trasabilitate Linie: Job "${lin.jobId}" | Nod "${lin.sourceNodeId}" | Sursă procesată: ${lin.totalSourceRows !== null && lin.totalSourceRows !== undefined ? `${Number(lin.totalSourceRows).toLocaleString()} rânduri` : '[NECUNOSCUTĂ / NESPECIFICATĂ]'} | După filtrare: ${lin.rowsAfterFilter !== null && lin.rowsAfterFilter !== undefined ? `${Number(lin.rowsAfterFilter).toLocaleString()} rânduri` : 'N/A'} | Rezultat total: ${Number(lin.totalResultRows || 0).toLocaleString()} rânduri | Transferat în document: ${Number(lin.transferredRows || 0).toLocaleString()} rânduri (${lin.transferStatus}) la ${lin.exportedAt || new Date().toISOString()}.`
          }
        ]
      }
    ];

    if (lin.transferStatus === 'TRUNCATED') {
      narrativeParagraphs.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Notificare Trunchiere: Tabelul este limitat la ${lin.transferredRows.toLocaleString()} rânduri pentru afișare documentară. ${lin.fullFileExportAvailable ? `Setul complet fizic este verificat pe disc la: ${lin.fullExportPath}` : 'Fișierul complet fizic nu a fost exportat pe disc.'}`
          }
        ]
      });
    } else if (lin.transferStatus === 'SAMPLED') {
      narrativeParagraphs.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Notificare Eșantionare: Tabelul conține doar o previzualizare de ${lin.transferredRows.toLocaleString()} rânduri din totalul de ${lin.totalResultRows.toLocaleString()} rânduri ale rezultatului. ${lin.fullFileExportAvailable ? `Setul complet verificat pe disc: ${lin.fullExportPath}` : ''}`
          }
        ]
      });
    }

    return {
      $schema: 'https://siren.local/schemas/docs/v1.json',
      schemaVersion: '1.0.0',
      prototypeVersion: '1.0.0',
      engineName: 'univer',
      engineVersion: '1.2.0',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      metadata: {
        generator: 'SIREN Analysis and Advanced Automation',
        jobId: lin.jobId,
        sourcePipelineNode: lin.sourceNodeId,
        schemaVersion: '1.0.0',
        schemaValid: lin.schemaValidation ? lin.schemaValidation.valid : true,
        schemaErrors: (lin.schemaValidation && lin.schemaValidation.errors && lin.schemaValidation.errors.length > 0) ? lin.schemaValidation.errors : undefined,
        totalSourceRows: lin.totalSourceRows !== undefined ? lin.totalSourceRows : null,
        totalSourceRowsProcessed: lin.totalSourceRows !== undefined ? lin.totalSourceRows : null,
        rowsAfterFilter: lin.rowsAfterFilter !== undefined ? lin.rowsAfterFilter : null,
        totalResultRows: lin.totalResultRows,
        transferredRows: lin.transferredRows,
        transferStatus: lin.transferStatus,
        fullFileExportAvailable: lin.fullFileExportAvailable,
        fullExportPath: lin.fullExportPath,
        queryExecutionDurationMs: lin.executionDurationMs || 0
      },
      document: {
        id: docId,
        title: title || 'Raport Analiză Automatizată SIREN',
        blocks: [
          {
            id: 'block-narrative-header',
            type: 'narrative',
            content: {
              type: 'doc',
              content: narrativeParagraphs
            }
          },
          {
            id: tableBlockId,
            type: 'table',
            title: workbook.name || 'Matrice Rezultate Analiză',
            workbookId: workbook.id,
            sheetId: workbook.sheetOrder[0]
          }
        ]
      },
      workbooks: {
        [workbook.id]: workbook
      },
      referenceMetadata: {
        // A generated table does not define a principal metric. References are
        // authored explicitly in Docs, with their actual target and label.
        referencesByWorkbook: {}
      }
    };
  }
}
