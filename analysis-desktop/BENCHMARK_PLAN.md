# Benchmark & Scale Verification Plan — SIREN Analysis

## 1. Scale Tiers & Objectives

The goal is to demonstrate deterministic, local, and reproducible processing across increasing volume thresholds without blowing up process memory, freezing the user interface, or corrupting data types.

| Tier | Target Rows | Schema Archetype | File Format | Disk Est. | Primary Evaluation Goal |
|---|---:|---|:---:|---:|---|
| **Tier 0 (Correctness)** | 1,000 | Comprehensive edge-case set (quoted CSV, nulls, leading zeros, currency) | CSV + Parquet | < 1 MB | Arithmetic & data correctness validation |
| **Tier 1 (Small Scale)** | 1,000,000 | 8 columns: Transaction ledger with customer dimension | Parquet | ~30 MB | Baseline vectorized execution & join speed |
| **Tier 2 (Medium Scale)**| 10,000,000 | 10 columns: Sales transactions & regional lookup | Parquet | ~300 MB | Multi-threaded aggregation and memory stability |
| **Tier 3 (Large Scale)** | 100,000,000 | 6 columns: High-velocity event logs | Parquet | ~2.5 GB | Vectorized scanning and group-by at 100M scale |
| **Tier 4 (Stress Scale)**| 120,000,000 | 6 columns: Extended event stream | Parquet | ~3.0 GB | Verification exceeding 100M rows requirement |
| **Tier 5 (Spill Proof)** | 10,000,000+ | Join & Aggregation with constrained memory (`512MB`) | Parquet | ~300 MB | Demonstration of physical disk spill to temp folder |

---

## 2. Dataset Synthesis Strategy

1. **Deterministic Batch Generation**:
   - Synthesized using pseudorandom PRNG with fixed seed (`seed = 42`).
   - Materialized directly into partitioned Parquet files on Drive D: (`data/raw/`).
   - *Rule*: Generation time is recorded and reported **separately** from query/pipeline execution time.
2. **Data Characteristics & Skew**:
   - Primary keys: sequential integers and zero-padded string identifiers (`"00001234"`).
   - Foreign keys: Zipfian/skewed distribution (80% of transactions concentrated across 20% of customer IDs) to stress hash join buckets.
   - Values: exact decimals (monetary amounts with 2 decimal places), high-cardinality timestamps, low-cardinality category strings.
   - Nulls: deterministic null injection rate (2% null amounts, 1% missing foreign keys).

---

## 3. Metrics Captured Per Benchmark Run

For each scale tier, the benchmarking harness automatically measures and logs:
- `rowCount` and `columnCount`
- `diskSizeBytes`: Size of source files on disk.
- `generationDurationMs`: Time to synthesize and write dataset.
- `queryDurationMs`: Time from query dispatch until final output materialized.
- `peakRssMemoryBytes`: Maximum OS resident set size of runner process (`process.memoryUsage().rss`).
- `peakDuckDbMemoryBytes`: Internal DuckDB buffer manager memory reported by engine metrics.
- `tempDiskBytes`: Maximum temporary bytes written to `data/temp/` during query execution (measuring disk spill).
- `correctnessStatus`: Validated by independent assertion against expected aggregates.

---

## 4. Disk Spill Demonstration Protocol

DuckDB is designed to handle out-of-core data larger than physical RAM by spilling intermediate hash tables and sort buffers to disk.

1. Configure temporary spill directory:
   ```sql
   SET temp_directory = 'D:\Siren analysis prototype\data\temp';
   ```
2. Constrain memory budget below dataset working set:
   ```sql
   SET max_memory = '512MB';
   ```
3. Execute a memory-intensive query (e.g. multi-column GROUP BY with high cardinality or heavy Join on 10M+ rows).
4. Inspect `temp_directory` during and immediately following execution to capture spill file creation and volume.
5. Verify that the query completes with 100% correct results despite the constrained memory limit.
