'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function fileIdentity(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || typeof stat.dev !== 'bigint' ||
      typeof stat.ino !== 'bigint' || stat.ino <= 0n || typeof stat.birthtimeNs !== 'bigint') {
    throw new Error('WORKFLOW_SAVE_IDENTITY: regular file identity is unavailable');
  }
  return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
}
function sameIdentity(stat, owner) {
  const actual = fileIdentity(stat);
  return actual.dev === owner.dev && actual.ino === owner.ino && actual.birthtimeNs === owner.birthtimeNs;
}
function contentRevision(stat) {
  if (typeof stat.mtimeNs !== 'bigint' || typeof stat.ctimeNs !== 'bigint') {
    throw new Error('WORKFLOW_SAVE_VERIFY: content timestamps are unavailable');
  }
  return { mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
}
function requireOwnStage(stage, owner, size, revision) {
  const stat = fs.lstatSync(stage, { bigint: true });
  if (!sameIdentity(stat, owner) || stat.size !== BigInt(size)) {
    throw new Error('WORKFLOW_SAVE_IDENTITY: staged path changed before publication');
  }
  if (revision && (stat.mtimeNs !== revision.mtimeNs || stat.ctimeNs !== revision.ctimeNs)) {
    throw new Error('WORKFLOW_SAVE_VERIFY: staged content changed during verification');
  }
  return stat;
}

// The destination is touched only by the final same-directory rename. A failed
// private stage must never turn a previously saved workflow into a partial file.
function atomicSaveWorkflow(filePath, workflow) {
  const bytes = Buffer.from(JSON.stringify(workflow, null, 2), 'utf8');
  const target = path.resolve(filePath);
  const stage = path.join(path.dirname(target), `.siren-workflow-save-${randomUUID()}.tmp`);
  let fd;
  let owner;
  try {
    fd = fs.openSync(stage, 'wx', 0o600);
    owner = fileIdentity(fs.fstatSync(fd, { bigint: true }));
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(written) || written <= 0 || written > bytes.length - offset) {
        throw new Error('WORKFLOW_SAVE_WRITE: staged write did not make valid progress');
      }
      offset += written;
    }
    fs.fsyncSync(fd);
    const flushed = fs.fstatSync(fd, { bigint: true });
    if (!sameIdentity(flushed, owner) || flushed.size !== BigInt(bytes.length)) {
      throw new Error('WORKFLOW_SAVE_IDENTITY: flushed file changed');
    }
    requireOwnStage(stage, owner, bytes.length, contentRevision(flushed));
    fs.closeSync(fd);
    fd = undefined;
    // Closing the last write handle may finalize timestamps. Pin the closed
    // file's revision, then require an unchanged revision around byte readback.
    const revision = contentRevision(requireOwnStage(stage, owner, bytes.length));
    const actual = fs.readFileSync(stage);
    requireOwnStage(stage, owner, bytes.length, revision);
    if (!Buffer.isBuffer(actual) || !actual.equals(bytes)) {
      throw new Error('WORKFLOW_SAVE_VERIFY: staged workflow bytes differ');
    }
    // One commit point. In particular, do not delete an existing target if a
    // Windows rename refuses replacement. All validation precedes this call.
    requireOwnStage(stage, owner, bytes.length, revision);
    fs.renameSync(stage, target);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    // A created pathname alone is not ownership: another file may replace it.
    // Preserve that replacement and the primary error if identity is unknown.
    if (owner) {
      try { if (sameIdentity(fs.lstatSync(stage, { bigint: true }), owner)) fs.unlinkSync(stage); } catch {}
    }
    throw error;
  }
}

module.exports = { atomicSaveWorkflow };
