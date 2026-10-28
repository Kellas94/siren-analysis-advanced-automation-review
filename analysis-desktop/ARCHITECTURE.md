# Architecture Specification — SIREN Analysis and Advanced Automation

## 1. System Overview

The SIREN Analysis and Advanced Automation module provides visual, reproducible, and local big-data ETL/analytics pipelines inspired by Alteryx workflows, powered by native DuckDB and React Flow.

```
+---------------------------------------------------------------------------------+
|                               RENDERER / UI PROCESS                             |
|                                                                                 |
|   +-----------------------+     +--------------------+     +----------------+   |
|   |  React Flow Pipeline  | <-> |  Preview Inspector | <-> | Univer / Docs  |   |
|   |  Visual Node Graph    |     |  (Paginated <=100) |     | Transfer Bridge|   |
|   +-----------------------+     +--------------------+     +----------------+   |
+----------------------------------------^----------------------------------------+
                                         | IPC / Local HTTP JSON Protocol
                                         | (Schemas, stats, samples ONLY; NO big data)
+----------------------------------------v----------------------------------------+
|                         SEPARATE LOCAL RUNNER PROCESS                           |
|                                                                                 |
|   +-------------------+     +--------------------+     +--------------------+   |
|   | Job Controller &  | --> | Pipeline Compiler  | --> | Native DuckDB v2.0 |   |
|   | Lifecycle Manager |     | (DAG -> SQL / Views|     | Engine (@duckdb/   |   |
|   +-------------------+     +--------------------+     | node-api)          |   |
|            |                                           +---------+----------+   |
|            | Resource Monitor (RSS, CPU, Spill)                  |              |
+------------|-----------------------------------------------------|--------------+
             |                                                     |
             v                                                     v
+-----------------------------+                           +-----------------------+
|  Local NVMe Storage         |                           | Native DuckDB Temp    |
|  Parquet / CSV Data Lake    |                           | Disk Spill Buffer     |
|  (D:\Siren analysis data)   |                           | (D:\...\data\temp)    |
+-----------------------------+                           +-----------------------+
```

---

## 2. Architectural Boundaries & Data Isolation Rules

1. **Strict Data Boundary**:
   - The UI process **NEVER** loads full datasets into JavaScript arrays, React state, IPC payloads, Univer spreadsheets, or HTML DOM tables.
   - For a 100M+ row dataset, the UI receives strictly:
     - Table schema (column names, types, nullability).
     - Column summary statistics (min, max, null count, distinct count).
     - Bounded preview slices (default 50-100 rows, paginated).
     - Execution telemetry (job state, elapsed ms, peak RSS, spilled disk bytes).
2. **Dedicated Background Process**:
   - Heavy SQL and analytics execution occurs in an isolated Node child process.
   - The UI remains completely responsive during long-running 100M+ row joins and aggregations.
   - If a job exceeds resource limits or is cancelled, only the runner job is interrupted; the UI never crashes or hangs.
3. **Engine-First Philosophy**:
   - Do not implement custom JavaScript join algorithms, sorting routines, or formula interpreters.
   - Leverage native DuckDB columnar vectorized execution for all filtering, joins, aggregations, window functions, and Parquet/CSV scanning.

---

## 3. Resource Budgets & System Constraints

Measurements on the host workstation (Intel Core i9-13900HX, 32GB RAM, Windows 11 x64):

| Resource | Workstation Capacity | Prototype Baseline Budget | Large Volume (100M+) Budget |
|---|---|---|---|
| **Engine RAM (`max_memory`)** | 31.75 GB Total (~8.5 GB free) | `4 GB` | `8 GB` to `12 GB` |
| **CPU Threads (`threads`)** | 24 Cores / 32 Threads | `8` threads | `16` threads |
| **Temp Disk Spill Directory** | Drive D: 758.6 GB free | `D:\Siren analysis prototype\data\temp` | Bounded to `100 GB` |
| **UI Process Memory** | — | Max `256 MB` | Max `256 MB` (strictly bounded) |
| **Process Monitoring** | OS Task Manager / GetProcessMemoryInfo | `process.memoryUsage().rss` measured independently of DuckDB internal estimates |

> [!IMPORTANT]
> `max_memory` in DuckDB limits DuckDB's internal buffer manager cache, but does **not** cap the entire operating system process footprint. The runner process monitors external OS RSS to guarantee the host machine remains stable.

---

## 4. Pipeline Compilation & Execution Lifecycle

1. **DAG Validation**: Visual nodes (Source, Select, Filter, Join, Aggregate, Pivot, Export) form a Directed Acyclic Graph (DAG). Cycles are rejected immediately before execution.
2. **SQL Transformation Compiler**:
   - Each node compiles into a deterministic SQL common table expression (`WITH node_1 AS (...), node_2 AS (...)`) or temporary DuckDB view.
   - Avoids unnecessary intermediate disk writes for linear pipeline steps.
   - Materializes intermediate tables only when explicit checkpoints, caching, or large multi-pass joins require it.
3. **Job Lifecycle States**:
   - `queued`: Job validated and waiting in execution queue.
   - `running`: Actively executing query in DuckDB worker. Telemetry polled.
   - `completed`: Successfully finished; result view/file registered and ready for preview/export.
   - `failed`: Terminated with error message, step attribution, and retained diagnostic log.
   - `cancelled`: User requested abort; DuckDB query interrupted; temporary files cleaned.

---

## 5. Pivot & Unpivot Architectural Considerations

1. **DuckDB PIVOT Semantics**:
   - DuckDB supports native `PIVOT` and `UNPIVOT` statements.
   - *Known DuckDB Quirk*: In certain DuckDB versions, filters inside `USING` clauses of `PIVOT` can be bypassed. **Design Rule**: All filtering is applied in an explicit upstream CTE / view prior to the `PIVOT` node.
2. **Cardinality & Dimension Explosion**:
   - Pivoting unbounded distinct strings (e.g., millions of unique IDs) into columns causes metadata explosion and crashes columnar catalog limits.
   - The Pivot node inspects categorical cardinality (`APPROX_COUNT_DISTINCT`) before execution and requires explicit column enumeration or limits (max 100 columns by default).
3. **Analytic Pivot vs Excel PivotTable**:
   - An analytic pivot flattens categorical dimensions into fixed columnar data on disk. It is distinct from Excel dynamic interactive OLAP hierarchies.

---

## 6. Integration Contract with Univer & Docs

- **Transfer to Univer**: Publishes aggregated summaries or limited filtered extracts (typically <10,000 cells) into native Univer sheets with full type fidelity (numbers as numbers, text as text, dates as dates).
- **Transfer to Docs**: Packages the analysis into a SIREN Docs v1.0.0 file envelope (`.sirendoc.json`), embedding narrative blocks, the aggregated table block, and result reference pills pointing to computed values.
- **Provenance & Immutability**: Exported snapshots retain pipeline ID, source data hash, execution timestamp, and SQL definition. Later edits inside Univer or Docs do not mutate the underlying data pipeline.
