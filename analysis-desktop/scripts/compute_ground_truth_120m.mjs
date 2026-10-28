import { DuckDBInstance } from '@duckdb/node-api';

async function main() {
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  
  console.log('Calculating ground truth invariants for 120M pipeline...');
  const t0 = Date.now();
  const sql = `
    WITH filt AS (
      SELECT * FROM read_parquet('data/bench_120m.parquet')
      WHERE status = 'COMPLETED' AND amount > 50.0
    )
    SELECT 
      category,
      ROUND(SUM(amount), 2) AS cat_sum,
      COUNT(*)::BIGINT AS cat_count,
      ROUND(AVG(amount), 2) AS cat_avg,
      MIN(amount) AS cat_min,
      MAX(amount) AS cat_max
    FROM filt
    GROUP BY category
    ORDER BY category;
  `;
  const res = await conn.run(sql);
  const rows = await res.getRowObjectsJson();
  console.log('Ground truth computed in', (Date.now() - t0), 'ms:');
  console.log(JSON.stringify(rows, null, 2));

  const totalFilteredCountRes = await conn.run(`
    SELECT count(*)::BIGINT AS total_filtered_rows, ROUND(SUM(amount), 2) AS total_filtered_amount 
    FROM read_parquet('data/bench_120m.parquet') 
    WHERE status = 'COMPLETED' AND amount > 50.0
  `);
  console.log('Overall totals:', await totalFilteredCountRes.getRowObjectsJson());
}

main().catch(console.error);
