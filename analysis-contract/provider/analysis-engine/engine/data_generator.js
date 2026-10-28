import fs from 'node:fs';
import path from 'node:path';

export class DataGenerator {
  constructor(duckdbRunner) {
    this.runner = duckdbRunner;
  }

  /**
   * Generates comprehensive correctness edge-case files:
   * 1. CSV with quotes, newlines, commas inside fields, nulls, leading zeros, BigInt.
   * 2. Secondary lookup table with unmatched rows and duplicate keys.
   */
  async generateCorrectnessFixtures(outputDir) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const txCsvPath = path.join(outputDir, 'correctness_transactions.csv');
    const custCsvPath = path.join(outputDir, 'correctness_customers.csv');

    // Build raw CSV content with deliberate edge cases:
    // Columns: trans_id,cust_code,amount,raw_date,note,qty,status
    const txLines = [
      'trans_id,cust_code,amount,raw_date,note,qty,status',
      // Row 1: Normal standard row
      '1,00010,100.25,2026-10-01,Standard record,5,COMPLETED',
      // Row 2: NULL amount (empty field), empty string note, zero qty
      '2,00020,,2026-10-02,"",0,PENDING',
      // Row 3: Leading zeros identifier "00030", BigInt > 2^53 (9007199254740993)
      '9007199254740993,00030,250.50,2026-10-03,"Note with leading zeros",1,COMPLETED',
      // Row 4: Quoted field with comma inside
      '4,00010,50.00,2026-10-04,"București, Sector 1",2,COMPLETED',
      // Row 5: Quoted field with embedded newline inside field
      '5,00040,12.75,2026-10-05,"Linie 1\nLinie 2 pe rand nou",3,SHIPPED',
      // Row 6: Quoted field with escaped quotes
      '6,00010,99.99,2026-10-06,"Clientul a spus: ""Urgent""",1,COMPLETED',
      // Row 7: Romanian Unicode diacritice: ș, ț, ă, î, â
      '7,00050,45.10,2026-10-07,"Factură cu diacritice: școală, țară, pâine",4,COMPLETED',
      // Row 8: Invalid date and non-numeric string in amount (for TRY_CAST validation)
      '8,00060,INVALID_AMT,bad-date-format,"Corrupt input row",-1,REJECTED',
      // Row 9: Duplicate key for join (cust_code 00010 appears multiple times)
      '9,00010,75.00,2026-10-08,"Altă tranzacție cust 00010",2,COMPLETED',
      // Row 10: Unmatched customer (cust_code 00999 not in customer table)
      '10,00999,300.00,2026-10-09,"Client neexistent în baza secundară",10,COMPLETED'
    ];

    fs.writeFileSync(txCsvPath, txLines.join('\n'), 'utf8');

    // Customer table: cust_code,customer_name,tier,discount
    const custLines = [
      'cust_code,customer_name,tier,discount',
      '00010,Alfa Logistics,Gold,0.15',
      '00020,Beta Retail,Silver,0.10',
      '00030,Gamma Tech,Platinum,0.20',
      '00040,Delta Construct,Bronze,0.05',
      '00050,România Est SRL,Gold,0.15',
      // Duplicate customer row to test duplicate key detection in join
      '00050,România Est SRL - Sucursala,Gold,0.15',
      // Customer with no transactions (testing RIGHT / FULL OUTER JOIN)
      '00088,Zeta Inactive,Bronze,0.00'
    ];

    fs.writeFileSync(custCsvPath, custLines.join('\n'), 'utf8');

    return { txCsvPath, custCsvPath };
  }

  /**
   * Generates deterministic Parquet datasets of arbitrary row count directly on disk.
   * Separation of generation time from analysis time is strictly recorded.
   */
  async generateParquetDataset(rowCount, outParquetPath, schemaType = 'narrow') {
    const dir = path.dirname(outParquetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const normPath = outParquetPath.replace(/\\/g, '/');
    const t0 = Date.now();

    let sql;
    if (schemaType === 'narrow') {
      // 6 columns: id, cust_id, amount, category, tx_date, status
      // Note: Condition order fixed so CANCELLED (range % 20 = 0) is evaluated BEFORE PENDING (range % 10 = 0)
      sql = `
COPY (
  SELECT 
    range::BIGINT AS id,
    printf('CUST_%07d', (range % 500000)) AS cust_id,
    (10.0 + (range % 1000) * 0.25)::DECIMAL(12,2) AS amount,
    CASE WHEN range % 4 = 0 THEN 'Hardware'
         WHEN range % 4 = 1 THEN 'Software'
         WHEN range % 4 = 2 THEN 'Services'
         ELSE 'Support' END AS category,
    '2026-01-01'::DATE + (range % 365)::INT AS tx_date,
    CASE WHEN range % 20 = 0 THEN 'CANCELLED'
         WHEN range % 10 = 0 THEN 'PENDING'
         ELSE 'COMPLETED' END AS status
  FROM range(${rowCount})
) TO '${normPath}' (FORMAT PARQUET, COMPRESSION 'ZSTD');
      `;
    } else {
      // Robust Wide Dataset (14 columns)
      // Features: variable length text, skewed distribution, genuine NULLs, high-cardinality pivot dimension
      sql = `
COPY (
  SELECT 
    range::BIGINT AS id,
    printf('CUST_%07d', (range % 250000)) AS cust_id,
    printf('TX_HASH_%012x', range * 31) AS tx_hash,
    (5.0 + (range % 2500) * 0.12)::DECIMAL(12,2) AS unit_price,
    (1 + (range % 20))::INT AS quantity,
    ((5.0 + (range % 2500) * 0.12) * (1 + (range % 20)))::DECIMAL(14,2) AS total_amount,
    -- Skewed distribution (80/20 rule)
    CASE WHEN range % 100 < 55 THEN 'North'
         WHEN range % 100 < 80 THEN 'Central'
         WHEN range % 100 < 92 THEN 'South'
         WHEN range % 100 < 98 THEN 'East'
         ELSE 'West' END AS region,
    -- High cardinality dimension (50 departments) for stress testing Pivot
    printf('DEPT_%02d', (range % 50)) AS dept_code,
    CASE WHEN range % 3 = 0 THEN 'Online'
         WHEN range % 3 = 1 THEN 'Store'
         ELSE 'Partner' END AS channel,
    '2026-01-01'::DATE + (range % 365)::INT AS order_date,
    '2026-01-02 08:00:00'::TIMESTAMP + to_seconds(range % 86400) AS event_time,
    -- Genuine NULLs in numeric field (every 23rd record is NULL)
    CASE WHEN range % 23 = 0 THEN NULL ELSE (range % 100)::DOUBLE END AS discount_pct,
    -- Genuine NULLs in text status
    CASE WHEN range % 37 = 0 THEN NULL
         WHEN range % 20 = 0 THEN 'CANCELLED'
         WHEN range % 10 = 0 THEN 'PENDING'
         ELSE 'COMPLETED' END AS status,
    -- Variable length text (from 5 chars to ~120 chars)
    CASE WHEN range % 7 = 0 
         THEN 'Notă detaliată: Tranzacție specială volum mare înregistrată în fluxul de analiză SIREN Docs/Analysis #' || range
         WHEN range % 3 = 0 
         THEN 'Observație standard #' || range
         ELSE 'OK' END AS notes
  FROM range(${rowCount})
) TO '${normPath}' (FORMAT PARQUET, COMPRESSION 'ZSTD');
      `;
    }

    await this.runner.run(sql);
    const generationDurationMs = Date.now() - t0;
    const stats = fs.statSync(outParquetPath);

    return {
      rowCount,
      filePath: outParquetPath,
      fileSizeBytes: stats.size,
      fileSizeMB: Math.round(stats.size / (1024 * 1024)),
      generationDurationMs,
      schemaType
    };
  }

  /**
   * Generates customer lookup dimension table for joins at scale.
   */
  async generateCustomerDimension(customerCount, outParquetPath) {
    const normPath = outParquetPath.replace(/\\/g, '/');
    const sql = `
COPY (
  SELECT 
    printf('CUST_%07d', range) AS cust_id,
    'Customer Organization ' || range AS org_name,
    CASE WHEN range % 4 = 0 THEN 'Enterprise'
         WHEN range % 4 = 1 THEN 'Mid-Market'
         WHEN range % 4 = 2 THEN 'Small-Business'
         ELSE 'Consumer' END AS segment,
    CASE WHEN range % 3 = 0 THEN 'EMEA'
         WHEN range % 3 = 1 THEN 'APAC'
         ELSE 'AMER' END AS territory,
    (range % 5 = 0) AS is_vip
  FROM range(${customerCount})
) TO '${normPath}' (FORMAT PARQUET, COMPRESSION 'ZSTD');
    `;
    await this.runner.run(sql);
    return fs.statSync(outParquetPath).size;
  }
}
