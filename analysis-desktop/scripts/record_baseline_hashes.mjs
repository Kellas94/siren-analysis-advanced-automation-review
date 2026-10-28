import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (e) {
    return null;
  }
}

function scanDir(dir, baseDir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'temp' || entry.name === 'temp_spill') {
      continue;
    }
    if (entry.isDirectory()) {
      scanDir(full, baseDir, results);
    } else if (entry.isFile()) {
      const stats = fs.statSync(full);
      // Skip large binary datasets (>50MB) from full hash if desired, or hash all. We can hash all files.
      results.push({
        relativePath: path.relative(baseDir, full).replace(/\\/g, '/'),
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        sha256: stats.size < 50 * 1024 * 1024 ? hashFile(full) : 'LARGE_FILE_SHA256_SKIPPED'
      });
    }
  }
  return results;
}

const analysisDir = 'D:\\Siren analysis prototype';
const docsDir = 'D:\\Siren docs prototype';

const analysisBaseline = {
  timestamp: new Date().toISOString(),
  prototype: 'Siren Analysis Prototype Pre-Repair Baseline',
  files: scanDir(analysisDir, analysisDir)
};

const docsBaseline = {
  timestamp: new Date().toISOString(),
  prototype: 'Siren Docs Prototype Pre-Repair Baseline',
  files: scanDir(docsDir, docsDir)
};

fs.writeFileSync(
  path.join(analysisDir, 'reports', 'BASELINE_PRE_REPAIR_HASHES.json'),
  JSON.stringify(analysisBaseline, null, 2),
  'utf8'
);

fs.writeFileSync(
  path.join(docsDir, 'reports', 'BASELINE_PRE_REPAIR_HASHES.json'),
  JSON.stringify(docsBaseline, null, 2),
  'utf8'
);

console.log(`Pre-repair baseline hashes recorded:`);
console.log(`  Analysis prototype files: ${analysisBaseline.files.length}`);
console.log(`  Docs prototype files: ${docsBaseline.files.length}`);
