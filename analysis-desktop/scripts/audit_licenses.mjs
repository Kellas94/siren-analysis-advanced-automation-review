import fs from 'node:fs';
import path from 'node:path';

function auditDirectory(spikeDir) {
  const lockfilePath = path.join(spikeDir, 'package-lock.json');
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`Lockfile not found at ${lockfilePath}`);
  }
  const lock = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  const pkgJson = JSON.parse(fs.readFileSync(path.join(spikeDir, 'package.json'), 'utf8'));
  const devDeps = new Set(Object.keys(pkgJson.devDependencies || {}));

  const results = [];
  const packages = lock.packages || {};

  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (pkgPath === '') continue; // root
    const cleanName = pkgPath.replace(/^node_modules\//, '');
    let pkgLicense = meta.license || 'UNKNOWN';
    let repo = 'UNKNOWN';
    let integrity = meta.integrity || 'UNKNOWN';
    let version = meta.version || 'UNKNOWN';

    const installedPkgJsonPath = path.join(spikeDir, pkgPath, 'package.json');
    if (fs.existsSync(installedPkgJsonPath)) {
      try {
        const installedPkg = JSON.parse(fs.readFileSync(installedPkgJsonPath, 'utf8'));
        if (installedPkg.license) {
          pkgLicense = installedPkg.license;
        } else if (Array.isArray(installedPkg.licenses)) {
          pkgLicense = installedPkg.licenses.map(l => l.type || l).join(' OR ');
        }
        if (installedPkg.repository) {
          repo = typeof installedPkg.repository === 'string' ? installedPkg.repository : (installedPkg.repository.url || 'UNKNOWN');
        }
      } catch (e) {}
    }

    const isDev = Boolean(meta.dev) || devDeps.has(cleanName);
    const classification = isDev ? 'build/test' : 'runtime';

    results.push({
      packageName: cleanName,
      version,
      license: typeof pkgLicense === 'object' ? JSON.stringify(pkgLicense) : pkgLicense,
      classification,
      repository: repo,
      integrity
    });
  }
  return results;
}

const rootDir = 'D:\\Siren analysis prototype';
const audit = auditDirectory(rootDir);

const csvHeader = 'Package,Version,License,Classification,Repository,Integrity\n';
const csvRows = audit.map(r =>
  `"${r.packageName}","${r.version}","${r.license}","${r.classification}","${r.repository.replace(/"/g, '""')}","${r.integrity}"`
).join('\n');

fs.writeFileSync(path.join(rootDir, 'DEPENDENCIES.csv'), csvHeader + csvRows, 'utf8');

console.log(`Audited ${audit.length} packages for Siren Analysis Prototype.`);
console.log('Sample licenses:', [...new Set(audit.map(x => x.license))].join(', '));

const copyleft = ['GPL', 'AGPL', 'SSPL', 'PROPRIETARY'];
for (const item of audit) {
  if (item.classification === 'runtime') {
    for (const cl of copyleft) {
      if (item.license.toUpperCase().includes(cl)) {
        console.warn(`WARNING: Restrictive runtime license detected: ${item.packageName} (${item.license})`);
      }
    }
  }
}
