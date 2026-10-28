import { DuckDBInstance } from '@duckdb/node-api';

async function main() {
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  const desc = await conn.run("DESCRIBE SELECT * FROM read_parquet('data/bench_120m.parquet')");
  console.log('Columns:', await desc.getRowObjectsJson());

  console.log('Computing 120M invariants...');
  const t0 = Date.now();
  const res = await conn.run(`
    SELECT 
      count(*)::BIGINT AS total_count,
      round(sum(amount), 2) AS sum_amount,
      round(avg(amount), 4) AS avg_amount,
      min(amount) AS min_amount,
      max(amount) AS max_amount
    FROM read_parquet('data/bench_120m.parquet')
  `);
  const rows = await res.getRowObjectsJson();
  console.log('Result in', (Date.now() - t0), 'ms:');
  console.log(rows);
}

main().catch(console.error);
