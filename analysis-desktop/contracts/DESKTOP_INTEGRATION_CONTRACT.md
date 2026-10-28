# SIREN Analysis & Advanced Automation — Standalone Offline Desktop Integration Contract

## 1. Scope & Purpose
This contract defines the architecture, environment requirements, process topology, and security standards for hosting **SIREN Analysis & Advanced Automation** inside an isolated, standalone, completely offline Electron desktop application.

## 2. Coordinated Host Environment
The host environment is coordinated with the SIREN runtime migration baseline:
- **Host Runtime**: Electron **44.9.3**
- **Chromium Baseline**: **152.0.7977.167**
- **Node.js**: **24.22.0** (or Node 24.x LTS)
- **Native ABI**: **149**
- **Operating Systems**: Windows 11 / Windows 10 x64, macOS 14+, Linux x64

> [!IMPORTANT]
> The main SIREN application's Electron runtime is managed by a separate migration task. The Analysis prototype does not modify or reconfigure the main SIREN Electron package. All host scripts, preloads, and harnesses are strictly isolated in this repository.

## 3. Dedicated Process Topology
1. **Renderer Process (UI)**:
   - Runs React Flow visual node editor and Bounded Preview Inspector.
   - `contextIsolation: true`, `nodeIntegration: false`.
   - Never holds large datasets in memory (bounded to 50 rows).
2. **Dedicated Background DuckDB Worker Process**:
   - Native DuckDB runs inside a dedicated, isolated child process via `node:child_process.fork()`.
   - Long-running analytics, heavy joins, pivots, and Parquet/CSV scanning never block the UI thread.
   - Worker termination (SIGTERM/SIGKILL) terminates orphaned queries immediately on cancellation.
3. **Electron Main Process**:
   - Manages window lifecycle, session security, and IPC message routing.

## 4. Strict Offline & Security Policies
1. **Zero Remote Dependencies**:
   - 100% offline runtime.
   - No downloads of remote scripts, styles, web fonts, or telemetry.
   - Content Security Policy: `connect-src 'self' file:` strictly blocks unauthorized outbound internet traffic.
2. **Local Asset Protocol**:
   - Loads compiled static files directly from `dist/index.html` via `loadFile()`.
   - Operates without any external web browser or development server.

## 5. Verification Deliverables
Acceptance requires automated verification that:
- [x] Application loads completely offline without dev server.
- [x] Native DuckDB executes in dedicated separate worker process.
- [x] Context isolation and CSP are active.
- [x] Cancellation terminates worker and restarts clean instance without hanging.
- [x] Export to SIREN Docs v1.0.0 format functions offline.
