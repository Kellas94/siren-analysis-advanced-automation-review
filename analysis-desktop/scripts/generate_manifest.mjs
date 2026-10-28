import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function main() {
  const baseDir = path.resolve('.');
  const filesToTrack = [
    'STATUS.md',
    'WORK_LOG.md',
    'ARCHITECTURE.md',
    'CAPABILITY_MATRIX.md',
    'DEPENDENCIES.csv',
    'BENCHMARK_PLAN.md',
    'HANDOFF.md',
    'RECOMMENDATION_REPORT.md',
    'REPAIR_REPORT.md',
    'package.json',
    'package-lock.json',
    'build.mjs',
    'desktop/package.json',
    'desktop/main.cjs',
    'desktop/preload.cjs',
    'desktop_package/electron.exe',
    'engine/duckdb_runner.js',
    'engine/pipeline_compiler.js',
    'engine/data_generator.js',
    'engine/worker_process.js',
    'server/runner_service.js',
    'server/index.js',
    'contracts/docs_univer_contract.js',
    'src/App.jsx',
    'src/main.jsx',
    'src/index.html',
    'src/components/CustomNodes.jsx',
    'src/utils/dagValidation.js',
    'dist/bundle.js',
    'dist/bundle.css',
    'dist/index.html',
    'reports/CORRECTNESS_REPORT.json',
    'reports/BENCHMARK_RESULTS.json',
    'reports/LIFECYCLE_CONTRACT_REPORT.json',
    'reports/INDEPENDENT_CHECK_REPORT.json',
    'reports/BASELINE_PRE_REPAIR_HASHES.json',
    'reports/VOLUME_100M_REVALIDATION.json',
    'reports/DESKTOP_PACKAGE_MANIFEST.json',
    'reports/DESKTOP_SCALE_120M_VERIFICATION.json',
    'reports/DESKTOP_FULL_E2E_FLOW_VERIFICATION.json',
    'reports/TYPE_PRECISION_ROUTE_VERIFICATION.json',
    'reports/DESKTOP_CONTRACT_VERIFICATION.json',
    'reports/REPAIR_REPORT_PHASE2.md',
    'evidence/exported_analysis.sirendoc.json',
    'evidence/sample_exported_analysis.sirendoc.json',
    'evidence/type_precision_exported.sirendoc.json',
    'scripts/package_desktop.mjs',
    'scripts/test_desktop_scale_120m.mjs',
    'scripts/test_desktop_full_e2e_flow.mjs',
    'scripts/test_type_precision_route.mjs',
    'scripts/test_desktop_analysis_contract.mjs',
    'scripts/test_transfer_completeness.mjs',
    'scripts/test_runner_lifecycle.mjs',
    'scripts/test_analysis_repairs.mjs',
    'scripts/test_compiler_fixes.mjs',
    'scripts/test_docs_univer_compatibility.mjs',
    'scripts/revalidate_volume_100m.mjs',
    'scripts/independent_checker.mjs',
    'scripts/generate_manifest.mjs'
  ];

  const keySources = [
    'desktop/main.cjs',
    'desktop/preload.cjs',
    'contracts/docs_univer_contract.js',
    'engine/worker_process.js',
    'engine/duckdb_runner.js',
    'engine/pipeline_compiler.js',
    'server/runner_service.js',
    'dist/bundle.js',
    'desktop_package/electron.exe'
  ];

  const sourceIntegrityHashes = {};
  for (const src of keySources) {
    const fp = path.join(baseDir, src);
    if (fs.existsSync(fp)) {
      sourceIntegrityHashes[src] = {
        bytes: fs.statSync(fp).size,
        sha256: hashFile(fp)
      };
    }
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    project: 'SIREN Analysis and Advanced Automation Prototype',
    author: 'Antigravity Autonomous Engineering',
    independentVerificationStatus: 'INDEPENDENT_REVIEW_READY',
    reviewerTarget: 'INDEPENDENT_EXTERNAL_REVIEWER',
    sourceIntegrityHashes,
    files: []
  };

  for (const relPath of filesToTrack) {
    const fullPath = path.join(baseDir, relPath);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      manifest.files.push({
        path: relPath.replace(/\\/g, '/'),
        sizeBytes: stats.size,
        sha256: hashFile(fullPath)
      });
    }
  }

  const outPath = path.join(baseDir, 'reports', 'MANIFEST.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Manifest created with ${manifest.files.length} tracked files at: ${outPath}`);
}

main();
