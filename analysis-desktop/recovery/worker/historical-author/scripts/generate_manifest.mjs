/**
 * Canonical Manifest Generator for SIREN Analysis Snapshot Worker Recovery
 *
 * Scans all delivered source, test, contract, report, and script files,
 * computes SHA-256 hashes and file sizes, and writes reports/MANIFEST.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const includeExtensions = new Set(['.js', '.mjs', '.json', '.md']);
const excludeDirs = new Set(['.git', 'node_modules', 'storage']);
const excludeFiles = new Set(['MANIFEST.json']);

function scanFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (!excludeDirs.has(entry.name)) {
        results.push(...scanFiles(fullPath));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (includeExtensions.has(ext) && !excludeFiles.has(entry.name)) {
        results.push({ fullPath, relPath });
      }
    }
  }
  return results;
}

function computeSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex')
  };
}

export function generateManifest() {
  const files = scanFiles(rootDir);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const manifest = {
    timestamp: new Date().toISOString(),
    component: 'SIREN Analysis Snapshot Worker Recovery & Persistent Catalog',
    packageVersion: '1.0.0',
    reviewStatus: 'CANDIDAT_PENTRU_VERIFICARE_INDEPENDENTA',
    independentReviewNote: 'Testele proprii nu constituie review independent.',
    totalFiles: files.length,
    files: files.map((f) => {
      const { size, sha256 } = computeSha256(f.fullPath);
      return {
        path: f.relPath,
        size,
        sha256
      };
    })
  };

  const reportsDir = path.join(rootDir, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const manifestPath = path.join(reportsDir, 'MANIFEST.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`Manifest sealed with ${files.length} files at ${manifestPath}`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateManifest();
}
