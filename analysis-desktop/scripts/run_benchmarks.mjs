import { DuckDBRunner } from '../engine/duckdb_runner.js';
import { DataGenerator } from '../engine/data_generator.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';

async function main() {
  console.log('===============================================================');
  console.log('   SIREN Analysis & Automation: Comprehensive Volume Benchmarks ');
  console.log('===============================================================');

  const benchmarkReportDir = path.resolve('reports');
  const dataDir = path.resolve('data');
  const tempDir = path.join(dataDir, 'temp');
  if (!fs.existsSync(benchmarkReportDir)) fs.mkdirSync(benchmarkReportDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const hostSpecs = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    totalRamGB: (os.totalmem() / (1024 ** 3)).toFixed(2),
    freeRamGB: (os.freemem() / (1024 ** 3)).toFixed(2)
  };
  console.log('Host specifications:', hostSpecs);

  const engineConfig = {
    dbPath: ':memory:',
    maxMemory: '6GB',
    threads: 8,
    tempDirectory: tempDir
  };

  const runner = new DuckDBRunner(engineConfig);
  const initInfo = await runner.initialize();
  console.log('DuckDB Runner initialized with:', initInfo);

  const generator = new DataGenerator(runner);

  // Background monitor for temp directory usage and RSS
  function startResourceMonitor(targetDir) {
    let peakTempBytes = 0;
    let peakRssMB = 0;
    const interval = setInterval(() => {
      // Monitor process RSS
      const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));
      if (rss > peakRssMB) peakRssMB = rss;

      // Monitor temp files
      try {
        if (fs.existsSync(targetDir)) {
          const files = fs.readdirSync(targetDir);
          let b = 0;
          for (const f of files) {
            try {
              b += fs.statSync(path.join(targetDir, f)).size;
            } catch (e) {}
          }
          if (b > peakTempBytes) peakTempBytes = b;
        }
      } catch (e) {}
    }, 25);

    return {
      stop: () => {
        clearInterval(interval);
        return { peakTempBytes, peakTempMB: (peakTempBytes / (1024 * 1024)).toFixed(2), peakRssMB };
      }
    };
  }

  const benchmarkResults = {
    metadata: {
      timestamp: new Date().toISOString(),
      engineVersion: initInfo.version,
      engineConfig,
      hostSpecs
    },
    tiers: []
  };

  // Helper to run a benchmark workload on a generated Parquet dataset
  async function runTierWorkload(tierId, tierName, rowCount, schemaType, parquetPath, customerDimPath = null) {
    console.log(`\n---------------------------------------------------------------`);
    console.log(`Executing Tier [${tierId}]: ${tierName} (${rowCount.toLocaleString()} rows)`);
    console.log(`---------------------------------------------------------------`);

    // 1. Generation Phase (Materialized to disk)
    console.log(`[Phase 1] Materializing Parquet dataset to disk: ${parquetPath}...`);
    const genInfo = await generator.generateParquetDataset(rowCount, parquetPath, schemaType);
    console.log(`  Generated ${rowCount.toLocaleString()} rows in ${(genInfo.generationDurationMs / 1000).toFixed(2)}s (${genInfo.fileSizeMB} MB on disk)`);

    // 2. Query Workloads Phase
    const workloads = [];
    const normPath = parquetPath.replace(/\\/g, '/');

    // Workload A: Projection & Filter
    {
      const monitor = startResourceMonitor(tempDir);
      const t0 = Date.now();
      const sql = `
        SELECT COUNT(*)::BIGINT AS matched_rows, SUM(amount)::DECIMAL(16,2) AS total_matched_amt
        FROM read_parquet('${normPath}')
        WHERE status = 'COMPLETED' AND amount > 50.00;
      `;
      const rows = await runner.queryRows(sql);
      const durationMs = Date.now() - t0;
      const resStats = monitor.stop();
      workloads.push({
        workload: 'Filter_And_Projection',
        description: `WHERE status = 'COMPLETED' AND amount > 50.00`,
        durationMs,
        resultRows: Number(rows[0][0]),
        resultSummary: { count: Number(rows[0][0]), totalAmt: String(rows[0][1]) },
        telemetry: resStats
      });
      console.log(`  [Workload A - Filter]: ${durationMs}ms | Matched: ${rows[0][0].toLocaleString()} rows | Peak RSS: ${resStats.peakRssMB} MB`);
    }

    // Workload B: Multi-dimensional Aggregation (Group By)
    {
      const monitor = startResourceMonitor(tempDir);
      const t0 = Date.now();
      const sql = `
        SELECT 
          category,
          status,
          COUNT(*)::BIGINT AS tx_count,
          SUM(amount)::DECIMAL(16,2) AS category_revenue,
          ROUND(AVG(amount), 2)::DOUBLE AS avg_ticket
        FROM read_parquet('${normPath}')
        GROUP BY category, status
        ORDER BY category_revenue DESC;
      `;
      const rows = await runner.queryRows(sql);
      const durationMs = Date.now() - t0;
      const resStats = monitor.stop();
      workloads.push({
        workload: 'Multi_Dimensional_Aggregation',
        description: `GROUP BY category, status with COUNT, SUM, AVG`,
        durationMs,
        resultRows: rows.length,
        telemetry: resStats
      });
      console.log(`  [Workload B - Aggregation]: ${durationMs}ms | Groups: ${rows.length} | Peak RSS: ${resStats.peakRssMB} MB`);
    }

    // Workload C: Dimension Join (if customerDimPath provided)
    if (customerDimPath) {
      const monitor = startResourceMonitor(tempDir);
      const t0 = Date.now();
      const normCustPath = customerDimPath.replace(/\\/g, '/');
      const sql = `
        SELECT 
          c.segment,
          c.territory,
          COUNT(*)::BIGINT AS tx_count,
          SUM(t.amount)::DECIMAL(16,2) AS total_segment_revenue
        FROM read_parquet('${normPath}') AS t
        INNER JOIN read_parquet('${normCustPath}') AS c ON t.cust_id = c.cust_id
        GROUP BY c.segment, c.territory
        ORDER BY total_segment_revenue DESC;
      `;
      const rows = await runner.queryRows(sql);
      const durationMs = Date.now() - t0;
      const resStats = monitor.stop();
      workloads.push({
        workload: 'Dimension_Hash_Join',
        description: `INNER JOIN on cust_id with segment & territory grouping`,
        durationMs,
        resultRows: rows.length,
        telemetry: resStats
      });
      console.log(`  [Workload C - Join]: ${durationMs}ms | Join Groups: ${rows.length} | Peak RSS: ${resStats.peakRssMB} MB`);
    }

    // Workload D: Analytical Pivot (Pre-filtered view + PIVOT)
    {
      const monitor = startResourceMonitor(tempDir);
      const t0 = Date.now();
      // Pre-filter view to ensure DuckDB USING filter consistency
      await runner.run(`
        CREATE OR REPLACE VIEW v_pivot_src_${tierId} AS 
        SELECT category, status, amount 
        FROM read_parquet('${normPath}')
        WHERE status IN ('COMPLETED', 'PENDING', 'CANCELLED');
      `);
      const pivotSql = `
        PIVOT v_pivot_src_${tierId}
        ON category IN ('Hardware', 'Software', 'Services', 'Support')
        USING SUM(amount)::DECIMAL(16,2)
        GROUP BY status;
      `;
      const rows = await runner.queryObjects(pivotSql);
      const durationMs = Date.now() - t0;
      const resStats = monitor.stop();
      workloads.push({
        workload: 'Analytical_Pivot',
        description: `PIVOT ON category USING SUM(amount) GROUP BY status`,
        durationMs,
        resultRows: rows.length,
        sampleOutput: rows,
        telemetry: resStats
      });
      console.log(`  [Workload D - Pivot]: ${durationMs}ms | Pivot Rows: ${rows.length} | Peak RSS: ${resStats.peakRssMB} MB`);
    }

    const tierRecord = {
      tierId,
      tierName,
      rowCount,
      schemaType,
      datasetStats: {
        filePath: parquetPath,
        fileSizeBytes: genInfo.fileSizeBytes,
        fileSizeMB: genInfo.fileSizeMB,
        generationDurationMs: genInfo.generationDurationMs
      },
      workloads
    };

    benchmarkResults.tiers.push(tierRecord);
    return tierRecord;
  }

  // Generate Customer Dimension for Joins
  console.log('\n[Setup] Generating Customer Dimension for scale Joins (500k customers)...');
  const custDimPath = path.join(dataDir, 'bench_customers_500k.parquet');
  const custSizeBytes = await generator.generateCustomerDimension(500000, custDimPath);
  console.log(`Customer dimension created: ${(custSizeBytes / (1024 * 1024)).toFixed(2)} MB`);

  // TIER 1: 1 Million Rows
  await runTierWorkload('TIER_1M', '1 Million Rows Baseline', 1000000, 'narrow', path.join(dataDir, 'bench_1m.parquet'), custDimPath);

  // TIER 2: 10 Million Rows
  await runTierWorkload('TIER_10M', '10 Million Rows Medium Scale', 10000000, 'narrow', path.join(dataDir, 'bench_10m.parquet'), custDimPath);

  // TIER 3: 100 Million Rows
  await runTierWorkload('TIER_100M', '100 Million Rows Target Scale', 100000000, 'narrow', path.join(dataDir, 'bench_100m.parquet'), custDimPath);

  // TIER 4: 120 Million Rows (Exceeding 100 Million Target)
  await runTierWorkload('TIER_120M', '120 Million Rows High Scale (>100M)', 120000000, 'narrow', path.join(dataDir, 'bench_120m.parquet'), custDimPath);

  // TIER 5: Physical Disk Spill Verification
  console.log(`\n---------------------------------------------------------------`);
  console.log(`Executing Tier [TIER_SPILL]: Physical Disk Spill Demonstration`);
  console.log(`---------------------------------------------------------------`);
  {
    // Configure low memory instance: 256MB limit on 10M rows to force disk spill
    const spillTempDir = path.join(dataDir, 'temp_spill');
    if (!fs.existsSync(spillTempDir)) fs.mkdirSync(spillTempDir, { recursive: true });

    const spillRunner = new DuckDBRunner({
      dbPath: ':memory:',
      maxMemory: '256MB',
      threads: 4,
      tempDirectory: spillTempDir
    });
    await spillRunner.initialize();

    const monitor = startResourceMonitor(spillTempDir);
    const t0 = Date.now();
    const norm10mPath = path.join(dataDir, 'bench_10m.parquet').replace(/\\/g, '/');

    // Heavy sort and distinct aggregation on 10M rows with 500,000 distinct customer keys
    const spillSql = `
      SELECT 
        cust_id,
        COUNT(*)::BIGINT AS orders,
        SUM(amount)::DECIMAL(16,2) AS total_val,
        AVG(amount)::DOUBLE AS avg_val
      FROM read_parquet('${norm10mPath}')
      GROUP BY cust_id
      ORDER BY total_val DESC;
    `;
    const rows = await spillRunner.queryRows(spillSql);
    const durationMs = Date.now() - t0;
    const stats = monitor.stop();

    console.log(`Spill query completed in ${(durationMs / 1000).toFixed(2)}s | Distinct Groups: ${rows.length.toLocaleString()}`);
    console.log(`Observed Peak Temp Disk Usage: ${stats.peakTempMB} MB (${stats.peakTempBytes.toLocaleString()} bytes)`);
    console.log(`Observed Peak RSS: ${stats.peakRssMB} MB (Engine capped at 256MB)`);

    benchmarkResults.tiers.push({
      tierId: 'TIER_SPILL',
      tierName: 'Physical Disk Spill Verification',
      rowCount: 10000000,
      engineConfig: { maxMemory: '256MB', threads: 4, tempDirectory: spillTempDir },
      query: `GROUP BY cust_id ORDER BY total_val DESC over 10M rows`,
      durationMs,
      resultRows: rows.length,
      peakTempDiskBytes: stats.peakTempBytes,
      peakTempDiskMB: stats.peakTempMB,
      spillObserved: stats.peakTempBytes > 0,
      peakRssMB: stats.peakRssMB
    });

    await spillRunner.close();
  }

  // Save complete report
  const outJsonPath = path.join(benchmarkReportDir, 'BENCHMARK_RESULTS.json');
  fs.writeFileSync(outJsonPath, JSON.stringify(benchmarkResults, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2), 'utf8');
  console.log(`\n===============================================================`);
  console.log(`All volume benchmarks completed successfully!`);
  console.log(`Detailed JSON results written to: ${outJsonPath}`);
  console.log(`===============================================================`);

  await runner.close();
}

main().catch(err => {
  console.error('Fatal error during volume benchmarks:', err);
  process.exit(1);
});
