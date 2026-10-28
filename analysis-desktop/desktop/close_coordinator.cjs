'use strict';
const { randomUUID } = require('node:crypto');
const requestIdValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = code => { throw new Error(code); };

// One window owner, one pending consent, one cleanup promise. No clock can grant consent.
class CloseCoordinator {
  constructor({ getOwner, notify, cleanup, allowExit, makeRequestId = randomUUID }) {
    this.getOwner = getOwner;
    this.notify = notify;
    this.cleanup = cleanup;
    this.allowExit = allowExit;
    this.makeRequestId = makeRequestId;
    this.pending = null;
  }
  get approved() { return this.pending?.phase === 'approved'; }
  request(owner = this.getOwner()) {
    if (!owner || owner !== this.getOwner()) fail('CLOSE_WINDOW_OWNER');
    if (this.pending) {
      if (this.pending.owner !== owner) fail('CLOSE_WINDOW_OWNER');
      if (this.pending.phase !== 'failed') return { success: true, requested: true, requestId: this.pending.requestId, phase: this.pending.phase };
      // A new explicit window/Quit request may retry failed cleanup with fresh consent.
      // Old responses remain stale; no service or job state is restored here.
      this.pending = null;
    }
    const requestId = this.makeRequestId();
    if (!requestIdValid(requestId)) fail('CLOSE_REQUEST_ID');
    const pending = { owner, requestId, phase: 'awaiting', completion: null };
    this.pending = pending;
    try { this.notify(owner, { requestId }); }
    catch (error) { this.pending = null; throw error; }
    return { success: true, requested: true, requestId, phase: pending.phase };
  }
  respond(owner, response) {
    if (!owner || owner !== this.getOwner()) fail('CLOSE_WINDOW_OWNER');
    if (!response || typeof response !== 'object' || Array.isArray(response) ||
        Object.keys(response).length !== 2 || !Object.hasOwn(response, 'requestId') ||
        !Object.hasOwn(response, 'decision') || !requestIdValid(response.requestId) ||
        !['proceed', 'cancel'].includes(response.decision)) fail('CLOSE_RESPONSE_INVALID');
    const pending = this.pending;
    if (!pending || pending.owner !== owner || pending.requestId !== response.requestId) fail('CLOSE_STALE_REQUEST');
    if (response.decision === 'cancel') {
      if (pending.phase !== 'awaiting') fail('CLOSE_ALREADY_APPROVED');
      this.pending = null;
      return { success: true, canceled: true, requestId: pending.requestId };
    }
    if (pending.phase === 'failed') fail('CLOSE_CLEANUP_FAILED');
    if (pending.completion) return pending.completion;
    pending.phase = 'cleaning';
    pending.completion = Promise.resolve().then(async () => {
      await this.cleanup();
      if (this.getOwner() !== owner || this.pending !== pending) fail('CLOSE_WINDOW_OWNER');
      pending.phase = 'approved';
      await this.allowExit(owner);
      return { success: true, approved: true, status: 'closed', requestId: pending.requestId };
    }).catch(error => {
      pending.phase = 'failed';
      const failure = new Error('CLOSE_CLEANUP_FAILED: ' + error.message);
      failure.cause = error;
      throw failure;
    });
    return pending.completion;
  }
}

// Runner.destroy currently sends SIGKILL synchronously and drops its worker ref.
// Capture/listen first; a kill request or 'exit' event alone is not child closure.
const capturedClosures = new WeakMap();
async function destroyRunnerAndWait(runner) {
  if (!runner) return;
  let captured = capturedClosures.get(runner);
  if (!captured) {
    const child = runner.worker;
    if (!child) { await runner.destroy(); return; }
    if (typeof child.once !== 'function' || typeof child.removeListener !== 'function') fail('CLOSE_WORKER_IDENTITY');
    let resolveClose;
    const closed = new Promise(resolve => { resolveClose = resolve; });
    captured = { child, closed, observed: false };
    capturedClosures.set(runner, captured);
    child.once('close', () => { captured.observed = true; resolveClose(); });
  }
  if (runner.worker && runner.worker !== captured.child) fail('CLOSE_WORKER_REPLACED');
  const child = captured.child;
  let rejectError;
  const failed = new Promise((_, reject) => { rejectError = reject; });
  const onError = error => rejectError(error);
  child.once('error', onError);
  try {
    // Attach rejection handling before destroy can synchronously emit an error.
    const destroy = Promise.resolve().then(() => runner.destroy());
    await Promise.all([destroy, Promise.race([captured.closed, failed])]);
  } finally {
    // Retain the one captured close observer across errors: destroy may already
    // have cleared runner.worker, which must not become false proof of closure.
    child.removeListener('error', onError);
  }
}

module.exports = { CloseCoordinator, destroyRunnerAndWait };
