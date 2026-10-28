/**
 * SIREN Analysis & Advanced Automation — Standalone Offline Main Process
 *
 * Coordinated Electron Version: 44.9.3 (Chromium 152.0.7977.167, Node 24.22.0, ABI 149)
 *
 * Invariants:
 * - 100% offline runtime: zero internet requests, zero remote CDN scripts/fonts.
 * - Dedicated DuckDB worker process: queries execute in an isolated child process.
 * - Reuses verified RunnerService for queue, worker identity, and cancellation.
 * - Context isolation enabled, nodeIntegration disabled.
 * - Strict Content Security Policy enforcement (connect-src 'self' file:).
 * - UI loads purely from local compiled bundle (dist/index.html) via loadFile().
 */

const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { CloseCoordinator, destroyRunnerAndWait } = require('./close_coordinator.cjs');
const { atomicSaveWorkflow } = require('./atomic_workflow_save.cjs');

let registryBridge = null;
let histogramService = null;
let histogramServicePromise = null;
let histogramClosing = false;
let savedJournalPromise = null;
async function getSavedJournalStore(){
  if(histogramClosing)throw Error('JOURNAL_STOPPING');
  if(!savedJournalPromise)savedJournalPromise=(async()=>{const {pathToFileURL}=require('node:url');let modulePath=path.resolve(__dirname,'../histogram/saved_journal.js');if(!fs.existsSync(modulePath))modulePath=path.resolve(__dirname,'histogram/saved_journal.js');const {SavedJournalStore}=await import(pathToFileURL(modulePath).href);return new SavedJournalStore({profileDir:app.getPath('userData')});})().catch(e=>{savedJournalPromise=null;throw e});
  return savedJournalPromise;
}
async function savedJournalRequest(event,request,method){
  requireHistogramOwner(event);
  if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.requestId))throw Error('JOURNAL_REQUEST_ID');
  const {requestId,...args}=JSON.parse(JSON.stringify(request));const value=await (await getSavedJournalStore())[method](args);
  if(histogramClosing)throw Error('JOURNAL_STOPPING');requireHistogramOwner(event);return {requestId,...value};
}
async function getHistogramService(){
  if(histogramClosing)throw Error('HISTOGRAM_STOPPING');
  if(!histogramServicePromise)histogramServicePromise=(async()=>{const {pathToFileURL}=require('node:url');let modulePath=path.resolve(__dirname,'../histogram/recoverable_service.js');if(!fs.existsSync(modulePath))modulePath=path.resolve(__dirname,'histogram/recoverable_service.js');const {RecoverableHistogramService}=await import(pathToFileURL(modulePath).href);const bridge=await getRegistryBridge();if(histogramClosing||!mainWindow)throw Error('HISTOGRAM_STOPPING');return histogramService=new RecoverableHistogramService({bridge,getJob:jobId=>runnerService?.getJob(jobId),workDir:path.join(app.getPath('userData'),'histogram-work'),exportDir:path.join(app.getPath('userData'),'histogram-snapshots')})})().catch(e=>{histogramServicePromise=null;throw e});
  return histogramServicePromise;
}
function requireHistogramOwner(event){if(!mainWindow||event.sender!==mainWindow.webContents)throw Error('HISTOGRAM_WINDOW_OWNER')}
async function getRegistryBridge() {
  if (!registryBridge) {
    const {pathToFileURL}=require('node:url');
    let modulePath=path.resolve(__dirname,'../registry/bridge.js');
    if(!fs.existsSync(modulePath))modulePath=path.resolve(__dirname,'registry/bridge.js');
    const {createRegistryBridge}=await import(pathToFileURL(modulePath).href);
    registryBridge=createRegistryBridge({storageDir:path.join(app.getPath('userData'),'analysis-results-v2'),exportDir:path.join(app.getPath('userData'),'chart-snapshots-v2')});
  }
  return registryBridge;
}

let mainWindow = null;
let runnerService = null;
let DocsUniverContract = null;
let safeJsonStringify = null;
let docsExporterPromise = null;
async function getDocsExporter() {
  if (histogramClosing) throw Error('DOCS_EXPORT_STOPPING');
  if (!docsExporterPromise) docsExporterPromise = (async () => {
    const { pathToFileURL } = require('node:url');
    let modulePath = path.resolve(__dirname, '../docs_exports/index.js');
    if (!fs.existsSync(modulePath)) modulePath = path.resolve(__dirname, 'docs_exports/index.js');
    const { VersionedDocsExporter } = await import(pathToFileURL(modulePath).href);
    if (histogramClosing) throw Error('DOCS_EXPORT_STOPPING');
    return new VersionedDocsExporter({ exportDir: path.join(app.getPath('userData'), 'docs-exports') });
  })().catch(error => { docsExporterPromise = null; throw error; });
  return docsExporterPromise;
}

async function initRunner() {
  if (histogramClosing) throw Error('APP_CLOSING');
  if (runnerService) return runnerService;

  let serverPath = path.resolve(__dirname, '../server/runner_service.js');
  let contractPath = path.resolve(__dirname, '../contracts/docs_univer_contract.js');
  let duckdbPath = path.resolve(__dirname, '../engine/duckdb_runner.js');

  if (!fs.existsSync(serverPath)) serverPath = path.resolve(__dirname, 'server/runner_service.js');
  if (!fs.existsSync(contractPath)) contractPath = path.resolve(__dirname, 'contracts/docs_univer_contract.js');
  if (!fs.existsSync(duckdbPath)) duckdbPath = path.resolve(__dirname, 'engine/duckdb_runner.js');

  const { pathToFileURL } = require('node:url');
  const runnerMod = await import(pathToFileURL(serverPath).href);
  const contractMod = await import(pathToFileURL(contractPath).href);
  const duckdbMod = await import(pathToFileURL(duckdbPath).href);

  const RunnerService = runnerMod.RunnerService;
  DocsUniverContract = contractMod.DocsUniverContract;
  safeJsonStringify = duckdbMod.safeJsonStringify;

  let dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) dataDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(dataDir)) dataDir = path.resolve(__dirname, '../../../data');
  if (!fs.existsSync(dataDir)) dataDir = path.resolve(process.cwd(), 'data');
  const tempDir = path.resolve(dataDir, 'temp');

  runnerService = new RunnerService({
    dataDir,
    tempDir,
    maxMemory: '4GB',
    threads: 4
  });

  return runnerService;
}

function createWindow() {
  // Enforce strict Content-Security-Policy at the session webRequest layer
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' file:; " +
          "script-src 'self' 'unsafe-inline' file:; " +
          "style-src 'self' 'unsafe-inline' file:; " +
          "img-src 'self' data: file:; " +
          "font-src 'self' data: file:; " +
          "connect-src 'self' file:;" // Strictly local communication
        ]
      }
    });
  });

  // Block any attempt to connect to external internet
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url.toLowerCase();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
        console.warn(`[BLOCKED EXTERNAL NETWORK ATTEMPT]: ${details.url}`);
        callback({ cancel: true });
        return;
      }
    }
    callback({ cancel: false });
  });

  mainWindow = new BrowserWindow({
    width: 1550,
    height: 950,
    minWidth: 1100,
    minHeight: 750,
    title: 'SIREN Analysis & Advanced Automation (Standalone Desktop)',
    backgroundColor: '#0F172A',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // Strictly isolated per SIREN baseline requirements
      webSecurity: true
    }
  });

  let indexPath = path.join(__dirname, '../dist/index.html');
  if (!fs.existsSync(indexPath)) indexPath = path.join(__dirname, 'dist/index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const ownedWindow = mainWindow;
  ownedWindow.on('close', event => {
    if (closeCoordinator.approved) return;
    event.preventDefault();
    if (mainWindow !== ownedWindow) return;
    try { closeCoordinator.request(ownedWindow.webContents); }
    catch (error) { console.error('[Close request refused]:', error.message); }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function currentCloseOwner() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return null;
  return mainWindow.webContents;
}
function requireCloseOwner(event) {
  const owner = currentCloseOwner();
  if (!owner || event.sender !== owner) throw Error('CLOSE_WINDOW_OWNER');
  return owner;
}
let approvedShutdown = null;
async function cleanupApprovedClose() {
  if (!approvedShutdown) approvedShutdown = (async () => {
    // This function is reachable only after the current renderer approved its token.
    histogramClosing = true;
    if (histogramServicePromise) await (await histogramServicePromise).destroy();
    const capturedRunner = runnerService;
    await destroyRunnerAndWait(capturedRunner);
    if (runnerService === capturedRunner) runnerService = null;
  })().catch(error => { approvedShutdown = null; throw error; });
  return approvedShutdown;
}
const closeCoordinator = new CloseCoordinator({
  getOwner: currentCloseOwner,
  notify: (owner, payload) => owner.send('siren:closeRequested', payload),
  cleanup: cleanupApprovedClose,
  allowExit: () => app.quit()
});

// --- IPC Handlers (Full Desktop Analysis Contract) ---

// 1. Submit pipeline workflow (fast HTTP 202-equivalent async acceptance)
ipcMain.handle('siren:runPipeline', async (event, pipelineDef) => {
  await initRunner();
  if (!pipelineDef || !Array.isArray(pipelineDef.nodes)) {
    throw new Error('Invalid pipeline definition: missing nodes array');
  }

  const job = runnerService.createJob(pipelineDef);
  // Start job asynchronously in background worker
  runnerService.runJob(job.jobId).catch(err => {
    console.error(`[Desktop Job ${job.jobId} Error]:`, err.message);
  });

  return {
    success: true,
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt
  };
});

// 2. Poll job status
ipcMain.handle('siren:getJobStatus', async (event, jobId) => {
  if (!runnerService) return null;
  const job = runnerService.getJob(jobId);
  if (!job) return null;
  return JSON.parse(safeJsonStringify(job));
});

// 3. Cancel running or queued job
ipcMain.handle('siren:cancelJob', async (event, jobId) => {
  if (!runnerService) return { success: false, message: 'Runner not initialized' };
  return runnerService.cancelJob(jobId);
});

// 4. Get bounded preview (<=50 rows) for a node
ipcMain.handle('siren:getPreview', async (event, { jobId, nodeId, limit }) => {
  if (!runnerService) throw new Error('Runner not initialized');
  return runnerService.getBoundedPreview(jobId, nodeId, limit || 50);
});

// 5. Export completed node output to SIREN Docs envelope v1.0.0
ipcMain.handle('siren:exportToDocs', async (event, { jobId, nodeId }) => {
  requireHistogramOwner(event);
  if (histogramClosing) throw Error('DOCS_EXPORT_STOPPING');
  if (!runnerService) throw new Error('Runner not initialized');
  const job = runnerService.getJob(jobId);
  if (!job) throw new Error(`Job "${jobId}" not found`);
  if (job.status !== 'completed') throw new Error(`Job "${jobId}" is not in completed state (current: "${job.status}")`);

  const nodeOutput = job.nodeOutputs?.[nodeId];
  if (!nodeOutput) throw new Error(`Node "${nodeId}" has no computed output`);
  if (nodeOutput.isOutdated) throw new Error(`Node "${nodeId}" output is outdated`);

  const previewRows = nodeOutput.preview || [];
  const columns = (nodeOutput.schema || []).map(c => c.columnName || c.name);
  if (!columns.length || columns.some(c => typeof c !== 'string' || !c)) throw new Error('Exact result schema is required for Docs export');

  // Supply simple primitive values as contract expects (never wrap in {cell, val} objects)
  const matrixRows = previewRows.map(row => columns.map(c => row[c]));

  // Verify physical export file existence strictly for THIS job and result (never qualify stale files)
  let verifiedExportPath = null;
  const nodeDef = job.pipelineDef?.nodes?.find(n => n.id === nodeId);
  if (nodeDef && nodeDef.type === 'export' && nodeDef.data?.path) {
    const candidate = path.resolve(runnerService.options.dataDir, nodeDef.data.path);
    if (fs.existsSync(candidate)) {
      try {
        const st = fs.statSync(candidate);
        const jobStartedAt = job.startedAt ? new Date(job.startedAt).getTime() : 0;
        if (st.size > 0 && (jobStartedAt === 0 || st.mtimeMs >= (jobStartedAt - 2000))) {
          verifiedExportPath = candidate;
        }
      } catch (e) {}
    }
  }

  const totalResultRows = nodeOutput.rowCount;
  const totalSourceRows = (job.telemetry?.totalSourceRows !== undefined && job.telemetry?.totalSourceRows !== null)
    ? job.telemetry.totalSourceRows
    : (nodeOutput.nodeType === 'input' ? totalResultRows : null);
  const rowsAfterFilter = (job.telemetry?.rowsAfterFilter !== undefined && job.telemetry?.rowsAfterFilter !== null)
    ? job.telemetry.rowsAfterFilter
    : null;
  const schema = nodeOutput.schema || [];

  const univerWb = DocsUniverContract.createUniverWorkbook({
    workbookId: `wb-${job.jobId}-${nodeId}`,
    sheetName: `Analysis_${nodeId.substring(0, 15)}`,
    columnNames: columns,
    schema, // Pass exact DuckDB column types!
    rows: matrixRows,
    lineage: {
      sourceNodeId: nodeId,
      nodeId,
      jobId: job.jobId,
      jobStartedAt: job.startedAt,
      totalSourceRows,
      rowsAfterFilter,
      totalResultRows,
      executionDurationMs: job.telemetry?.durationMs || 0,
      fullExportPath: verifiedExportPath
    }
  });

  const docsEnvelope = DocsUniverContract.createDocsEnvelope({
    title: `SIREN Analysis Export — Node [${nodeId}]`,
    description: `Analysis workflow job "${job.jobId}" produced ${totalResultRows.toLocaleString()} result rows in native DuckDB. Source rows recorded for this job: ${totalSourceRows === null ? 'unknown' : totalSourceRows.toLocaleString()}. Output transferred to SIREN Docs v1.0.0 format.`,
    workbook: univerWb,
    lineage: {
      sourceNodeId: nodeId,
      nodeId,
      jobId: job.jobId,
      jobStartedAt: job.startedAt,
      totalSourceRows,
      rowsAfterFilter,
      totalResultRows,
      executionDurationMs: job.telemetry?.durationMs || 0,
      fullExportPath: verifiedExportPath
    }
  });

  const expectedBytes = Buffer.from(JSON.stringify(docsEnvelope, null, 2), 'utf8');
  const expectedSha256 = crypto.createHash('sha256').update(expectedBytes).digest('hex');
  const exporter = await getDocsExporter();
  requireHistogramOwner(event);
  if (histogramClosing) throw Error('DOCS_EXPORT_STOPPING');
  const receipt = await exporter.exportEnvelope(docsEnvelope);
  requireHistogramOwner(event);
  if (histogramClosing) throw Error('DOCS_EXPORT_STOPPING');
  if (receipt.success !== true || receipt.jobId !== job.jobId || receipt.nodeId !== nodeId ||
      receipt.schemaVersion !== docsEnvelope.schemaVersion || receipt.transferStatus !== univerWb.lineage.transferStatus ||
      receipt.transferredRows !== matrixRows.length || receipt.totalResultRows !== totalResultRows ||
      receipt.byteCount !== expectedBytes.length || receipt.sha256 !== expectedSha256 ||
      typeof receipt.absoluteFilePath !== 'string' || !path.isAbsolute(receipt.absoluteFilePath) ||
      path.dirname(receipt.absoluteFilePath) !== path.join(app.getPath('userData'), 'docs-exports')) throw Error('DOCS_EXPORT_RECEIPT_MISMATCH');
  const outFilePath = receipt.absoluteFilePath;

  return {
    success: true,
    jobId: job.jobId,
    nodeId,
    filePath: outFilePath,
    absoluteFilePath: outFilePath,
    byteCount: receipt.byteCount,
    sha256: receipt.sha256,
    schemaVersion: '1.0.0',
    transferredRows: matrixRows.length,
    totalResultRows,
    transferStatus: univerWb.lineage.transferStatus,
    fullFileExportAvailable: univerWb.lineage.fullFileExportAvailable
  };
});

// 6. Native workflow file save & open
let sourceDialogPending = false;
ipcMain.handle('siren:chooseSourceFile', async event => {
  const owner = requireCloseOwner(event);
  if (event.senderFrame !== owner.mainFrame) throw Error('SOURCE_WINDOW_FRAME');
  if (histogramClosing) throw Error('APP_CLOSING');
  if (sourceDialogPending) throw Error('SOURCE_PICKER_BUSY');
  sourceDialogPending = true;
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Analysis source file',
      buttonLabel: 'Choose source',
      filters: [{ name: 'CSV or Parquet', extensions: ['csv', 'parquet'] }],
      properties: ['openFile', 'dontAddToRecent']
    });
    if (requireCloseOwner(event) !== owner || event.senderFrame !== owner.mainFrame) throw Error('SOURCE_WINDOW_OWNER');
    if (histogramClosing) throw Error('APP_CLOSING');
    if (result.canceled === true) return { canceled: true };
    const files = result.filePaths;
    if (result.canceled !== false || !Array.isArray(files) || files.length !== 1 ||
        typeof files[0] !== 'string' || files[0].includes('\0') || !path.isAbsolute(files[0])) throw Error('SOURCE_SELECTION_INVALID');
    const filePath = files[0], extension = path.extname(filePath).toLowerCase();
    if (!['.csv', '.parquet'].includes(extension)) throw Error('Choose a CSV or Parquet file.');
    if (!fs.statSync(filePath).isFile()) throw Error('Choose an existing file.');
    return { canceled: false, filePath, format: extension.slice(1) };
  } finally { sourceDialogPending = false; }
});

ipcMain.handle('siren:saveWorkflow', async (event, workflowObj, targetPath) => {
  if (workflowObj && workflowObj.__forceCancel) return { canceled: true };
  let filePath = (typeof targetPath === 'string' && targetPath) ? targetPath : (workflowObj && workflowObj.__targetPath ? workflowObj.__targetPath : null);
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save SIREN Analysis Workflow',
      defaultPath: `workflow_${Date.now()}.json`,
      filters: [{ name: 'JSON Workflow', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    filePath = result.filePath;
  }
  try {
    atomicSaveWorkflow(filePath, workflowObj);
    return { canceled: false, filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

ipcMain.handle('siren:openWorkflow', async (event, sourcePath) => {
  if (sourcePath && sourcePath.forceCancel) return { canceled: true };
  let filePath = (typeof sourcePath === 'string' && sourcePath) ? sourcePath : (sourcePath && sourcePath.filePath ? sourcePath.filePath : null);
  if (!filePath) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open SIREN Analysis Workflow',
      filters: [{ name: 'JSON Workflow', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    filePath = result.filePaths[0];
  }
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { canceled: false, filePath, content };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

ipcMain.handle('siren:registryCapture',async(event,{jobId,nodeId,definition})=>{
  await initRunner();const job=runnerService.getJob(jobId);if(!job)throw new Error('JOB_NOT_FOUND');return (await getRegistryBridge()).capture(job,nodeId,definition,runnerService.options.dataDir);
});
ipcMain.handle('siren:registryList',async()=> (await getRegistryBridge()).list());
ipcMain.handle('siren:registryGet',async(event,{resultId,expectedIntegrity})=> (await getRegistryBridge()).open(resultId,expectedIntegrity));
ipcMain.handle('siren:registryChart',async(event,request)=> (await getRegistryBridge()).chart(request));

ipcMain.handle('siren:workflowHistogramDescribe',async(event,request)=>{requireHistogramOwner(event);return (await getHistogramService()).describe(request)});
ipcMain.handle('siren:journalSnapshotsList',async(event,request)=>savedJournalRequest(event,request,'list'));
ipcMain.handle('siren:journalSnapshotOpen',async(event,request)=>savedJournalRequest(event,request,'open'));
ipcMain.handle('siren:workflowHistogramRecoverableStart',async(event,request)=>{requireHistogramOwner(event);return (await getHistogramService()).startRecoverableDirect(request)});
ipcMain.handle('siren:workflowHistogramSnapshotStart',async(event,request)=>{requireHistogramOwner(event);return (await getHistogramService()).startSnapshotWorkflow(request)});
ipcMain.handle('siren:workflowHistogramStart',async(event,request)=>{requireHistogramOwner(event);return (await getHistogramService()).startWorkflow(request)});
ipcMain.handle('siren:histogramStart',async(event,request)=>{requireHistogramOwner(event);return (await getHistogramService()).start(request)});
ipcMain.handle('siren:histogramCancel',async(event,id)=>{requireHistogramOwner(event);return (await getHistogramService()).cancel(id)});
ipcMain.handle('siren:quitApp', event => closeCoordinator.request(requireCloseOwner(event)));
ipcMain.handle('siren:respondToClose', (event, response) => closeCoordinator.respond(requireCloseOwner(event), response));

app.whenReady().then(async () => {
  await initRunner();
  createWindow();
});

app.on('before-quit', event => {
  if (closeCoordinator.approved) return;
  event.preventDefault();
  try { closeCoordinator.request(); }
  catch (error) { console.error('[Quit request refused]:', error.message); }
});

app.on('window-all-closed', () => {
  // Cleanup already completed through the approved token; never destroy on dismissal.
  if (process.platform !== 'darwin' && closeCoordinator.approved) app.quit();
});
