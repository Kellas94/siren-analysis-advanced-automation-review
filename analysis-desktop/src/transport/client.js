/**
 * SIREN Analysis & Advanced Automation — Unified Transport Client
 *
 * Automatically detects whether running inside the Electron Desktop Host
 * (via window.sirenDesktop) or a Web development environment.
 * When in desktop mode, operates 100% via Electron preload IPC with ZERO HTTP traffic.
 */

export function isDesktopEnvironment() {
  return typeof window !== 'undefined' && Boolean(window.sirenDesktop && window.sirenDesktop.isElectron);
}

export const transportClient = {
  isDesktop: isDesktopEnvironment(),

  async runWorkflow(pipelineDef) {
    if (isDesktopEnvironment()) {
      return await window.sirenDesktop.runPipeline(pipelineDef);
    }
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineDef })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  },

  async getJobStatus(jobId) {
    if (isDesktopEnvironment()) {
      return await window.sirenDesktop.getJobStatus(jobId);
    }
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return null;
    return await res.json();
  },

  async cancelJob(jobId) {
    if (isDesktopEnvironment()) {
      return await window.sirenDesktop.cancelJob(jobId);
    }
    const res = await fetch(`/api/jobs/${jobId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    return data;
  },

  async getPreview(jobId, nodeId, limit = 50) {
    if (isDesktopEnvironment()) {
      return await window.sirenDesktop.getPreview(jobId, nodeId, limit);
    }
    const res = await fetch(`/api/preview?jobId=${jobId}&nodeId=${nodeId}&limit=${limit}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  },

  async exportToDocs(jobId, nodeId) {
    if (isDesktopEnvironment()) {
      return await window.sirenDesktop.exportToDocs(jobId, nodeId);
    }
    const res = await fetch('/api/export-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, nodeId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  },

  async saveWorkflow(workflowObj, targetPath) {
    if (isDesktopEnvironment() && window.sirenDesktop.saveWorkflow) {
      return await window.sirenDesktop.saveWorkflow(workflowObj, targetPath);
    }
    return null; // Fallback to browser blob download
  },

  async openWorkflow(sourcePath) {
    if (isDesktopEnvironment() && window.sirenDesktop.openWorkflow) {
      return await window.sirenDesktop.openWorkflow(sourcePath);
    }
    return null; // Fallback to browser file input
  }
};
