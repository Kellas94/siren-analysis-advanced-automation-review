# Capability Matrix — SIREN Analysis and Advanced Automation

## 1. Operation Inventory & Implementation Status

| Capability / Node Type | Alteryx Equivalent | Status in Prototype | DuckDB Execution Strategy | Acceptance Criteria |
|---|---|:---:|---|---|
| **CSV / Parquet Ingest** | Input Data | **IMPLEMENTED** | `read_csv()`, `read_parquet()` with auto schema detection & projection pushdown | Validates row count, column types, preserves quotes/newlines/commas |
| **Select & Rename** | Select | **IMPLEMENTED** | `SELECT col AS new_col, CAST(c AS type)` | Renames columns, drops unselected columns without full disk rewrite |
| **Type Conversions** | Auto Field / Select | **IMPLEMENTED** | `TRY_CAST(col AS type)` with nullification of invalid entries | Identifies rejected/invalid conversions without crashing pipeline |
| **Row Filtering** | Filter | **IMPLEMENTED** | `WHERE condition` (numeric, string, boolean, NULL checks) | Evaluates complex boolean logic (`AND`, `OR`, `IN`, `BETWEEN`) |
| **Table Join** | Join | **IMPLEMENTED** | `JOIN ON left.key = right.key` (Inner, Left, Right, Full Outer) | Accurately tracks unmatched left, matched, and unmatched right |
| **Aggregation / Group By** | Summarize | **IMPLEMENTED** | `GROUP BY ... SELECT SUM, AVG, MIN, MAX, COUNT, COUNT(*)` | Computes exact sums, averages, counts; handles NULL group keys |
| **Pivot (Crosstab)** | Cross Tab | **IMPLEMENTED** | `PIVOT on upstream filtered CTE` | Converts categorical values to columns; validates cardinality limit |
| **Unpivot (Transpose)** | Transpose | **IMPLEMENTED** | `UNPIVOT ... ON (cols) INTO NAME col_name VALUE val_name` | Flattens column headers into attribute-value rows |
| **Export Result** | Output Data | **IMPLEMENTED** | `COPY ... TO 'file' (FORMAT PARQUET / CSV)` | Exports durable files with exact row counts |
| **Multi-File Ingest** | Wildcard Input | **IMPLEMENTED** | `read_parquet(['f1.parquet', 'f2.parquet'])` or glob | Ingests partitioned datasets deterministically |
| **Union / Append** | Union | **IMPLEMENTED** | `UNION ALL` / `UNION BY NAME` | Appends tables with matching or differing schemas |
| **Deduplication** | Unique | **PLANNED (T2)** | `SELECT DISTINCT` or `QUALIFY row_number() = 1` | Removes exact or key-based duplicate records |
| **Missing Values / Coalesce** | Imputation | **PLANNED (T2)** | `COALESCE(col, default_val)` | Replaces nulls cleanly with explicit indicators |
| **Calculated Columns** | Formula | **IMPLEMENTED** | `SELECT ..., (B * C) AS D, CASE WHEN ...` | Computes arithmetic and conditional logic |
| **Multi-Column Sorting** | Sort | **IMPLEMENTED** | `ORDER BY col1 ASC, col2 DESC NULLS LAST` | Deterministic sorting with disk-assisted external sort |
| **String & Date Tools** | DateTime / RegEx | **PLANNED (T2)** | `date_trunc`, `strftime`, `regexp_extract` | Formats ISO timestamps and extracts substrings |
| **Window Functions** | Multi-Row Formula | **PLANNED (T2)** | `ROW_NUMBER() OVER (...)`, `LAG`, `LEAD` | Calculates running totals, rank, and period-over-period diffs |
| **Data Quality Profiler** | Basic Data Profile | **IMPLEMENTED** | `SUMMARIZE table` / custom aggregate query | Returns count, null count, min, max, approx distinct per column |
| **Flow Parameterization** | Workflow Constants | **IMPLEMENTED** | Dynamic parameters mapped to SQL query variables | Re-runs identical pipeline graph on new input files |
| **Univer & Docs Transfer** | Report / Output | **IMPLEMENTED** | Schema v1.0.0 adapter export | Publishes aggregates and previews to Univer/Docs |
| **External DB Connectors** | Connect In-DB | **DEFERRED** | Remote ODBC/JDBC/Postgres extensions | Outside local prototype scope |
| **Arbitrary User Scripting** | Python / R Tool | **DEFERRED** | Process sandboxing / isolated runtime | Security risk; not permitted in Phase 1-3 |
| **Automated Scheduling** | Alteryx Server / Gallery | **DEFERRED** | Cron / Background daemon | Evaluated in later SIREN milestones |

---

## 2. Priority Roadmap

1. **Tier 1 (Foundation — Active Prototype)**:
   - CSV / Parquet Import, Select/Rename/Cast, Filter, Join, Group By, Pivot, Unpivot, Export, Data Quality Profiling.
2. **Tier 2 (Advanced Transformation)**:
   - Union By Name, Deduplication (`QUALIFY`), Window functions (`LAG`/`LEAD`), Date/Time manipulations, Coalesce.
3. **Tier 3 (Enterprise & Platform Integration)**:
   - External data connectors, live streaming CDC, multi-user concurrency.
