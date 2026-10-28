import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function getFiles(dir, base = '') {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === 'node_modules' || file === '.git' || file === 'MANIFEST.json') continue;
    const fullPath = path.join(dir, file);
    const relPath = path.join(base, file).replace(/\\/g, '/');
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFiles(fullPath, relPath));
    } else {
      results.push({ fullPath, relPath, size: stat.size });
    }
  }
  return results;
}

const allFiles = getFiles(root);
const manifestEntries = allFiles.map(f => {
  const content = fs.readFileSync(f.fullPath);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  return {
    path: f.relPath,
    size: f.size,
    sha256
  };
});

manifestEntries.sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  timestamp: new Date().toISOString(),
  component: 'SIREN Analysis -> Charts Minimal Adapter',
  totalFiles: manifestEntries.length,
  files: manifestEntries
};

const reportsDir = path.join(root, 'reports');
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

fs.writeFileSync(path.join(reportsDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Manifest created with ${manifestEntries.length} files at: ${path.join(reportsDir, 'MANIFEST.json')}`);
