/**
 * SIREN Analysis Desktop — Context Isolation Preload Bridge
 *
 * Securely bridges renderer requests to native Electron IPC.
 * Allows running pipeline workflows, reading bounded previews,
 * and saving/opening workflows without exposing raw Node or child_process to renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

let pendingClose = null;
let closeListener = null;
let deliveredClose = null;
const validCloseId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function deliverClose() {
  if (!pendingClose || !closeListener) return;
  const callback = closeListener, requestId = pendingClose.requestId;
  // A subscription may be installed inside a React effect; its flushSync shield
  // must run after that effect has returned, never synchronously inside it.
  queueMicrotask(() => {
    if (closeListener !== callback || pendingClose?.requestId !== requestId ||
        deliveredClose?.callback === callback && deliveredClose.requestId === requestId) return;
    deliveredClose = { callback, requestId };
    callback({ requestId });
  });
}
ipcRenderer.on('siren:closeRequested', (_event, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'requestId') || !validCloseId(payload.requestId)) return;
  pendingClose = { requestId: payload.requestId };
  deliverClose();
});

contextBridge.exposeInMainWorld('sirenDesktop', {
  isElectron: true,
  chooseSourceFile: () => ipcRenderer.invoke('siren:chooseSourceFile'),
  onCloseRequested: callback => {
    if (typeof callback !== 'function') throw Error('CLOSE_LISTENER_INVALID');
    closeListener = callback;
    deliveredClose = null;
    deliverClose();
    return () => { if (closeListener === callback) closeListener = null; };
  },
  respondToClose: response => {
    if (!response || typeof response !== 'object' || Array.isArray(response) ||
        Object.keys(response).length !== 2 || !Object.hasOwn(response, 'requestId') ||
        !Object.hasOwn(response, 'decision') || !validCloseId(response.requestId) ||
        !['proceed', 'cancel'].includes(response.decision)) throw Error('CLOSE_RESPONSE_INVALID');
    const message = { requestId: response.requestId, decision: response.decision };
    if (pendingClose?.requestId === message.requestId) { pendingClose = null; deliveredClose = null; }
    return ipcRenderer.invoke('siren:respondToClose', message);
  },
  journalSnapshotsList: request => ipcRenderer.invoke('siren:journalSnapshotsList',request),
  journalSnapshotOpen: request => ipcRenderer.invoke('siren:journalSnapshotOpen',request),
  workflowHistogramRecoverableStart: request => ipcRenderer.invoke('siren:workflowHistogramRecoverableStart',request),
  workflowHistogramSnapshotStart: request => ipcRenderer.invoke('siren:workflowHistogramSnapshotStart',request),
  workflowHistogramDescribe: request => ipcRenderer.invoke('siren:workflowHistogramDescribe',request),
  workflowHistogramStart: request => ipcRenderer.invoke('siren:workflowHistogramStart',request),
  histogramStart: request => ipcRenderer.invoke('siren:histogramStart',request),
  histogramCancel: operationId => ipcRenderer.invoke('siren:histogramCancel',operationId),
  registryCapture: request => ipcRenderer.invoke('siren:registryCapture',request),
  registryList: () => ipcRenderer.invoke('siren:registryList'),
  registryGet: (resultId,expectedIntegrity) => ipcRenderer.invoke('siren:registryGet',{resultId,expectedIntegrity}),
  registryChart: request => ipcRenderer.invoke('siren:registryChart',request),
  isOffline: true,
  hostVersion: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  runPipeline: async (pipelineDef) => {
    return await ipcRenderer.invoke('siren:runPipeline', pipelineDef);
  },
  cancelJob: async (jobId) => {
    return await ipcRenderer.invoke('siren:cancelJob', jobId);
  },
  getJobStatus: async (jobId) => {
    return await ipcRenderer.invoke('siren:getJobStatus', jobId);
  },
  getPreview: async (jobId, nodeId, limit) => {
    return await ipcRenderer.invoke('siren:getPreview', { jobId, nodeId, limit });
  },
  exportToDocs: async (jobId, nodeId) => {
    return await ipcRenderer.invoke('siren:exportToDocs', { jobId, nodeId });
  },
  saveWorkflow: async (workflowObj, targetPath) => {
    return await ipcRenderer.invoke('siren:saveWorkflow', workflowObj, targetPath);
  },
  openWorkflow: async (sourcePath) => {
    return await ipcRenderer.invoke('siren:openWorkflow', sourcePath);
  },
  quitApp: async () => {
    return await ipcRenderer.invoke('siren:quitApp');
  }
});
