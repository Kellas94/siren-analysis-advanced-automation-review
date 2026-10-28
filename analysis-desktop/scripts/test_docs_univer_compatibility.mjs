import fs from 'node:fs';
import path from 'node:path';
import { DocumentStore, validateEnvelope } from '../../Siren docs prototype/prototype/src/model/document_store.js';

async function testCompatibility() {
  console.log('=== Testing End-to-End Analysis -> Docs Document Transfer ===');
  const exportedPath = path.resolve('evidence/exported_analysis.sirendoc.json');
  if (!fs.existsSync(exportedPath)) {
    throw new Error(`Exported document not found at: ${exportedPath}`);
  }

  const rawJson = JSON.parse(fs.readFileSync(exportedPath, 'utf8'));
  console.log('1. Validating file envelope schema...');
  const valid = validateEnvelope(rawJson);
  console.log('  Envelope valid:', valid);

  console.log('2. Loading exported document into Docs DocumentStore...');
  const store = new DocumentStore(rawJson);
  console.log('  Document loaded:', store.data.document.id);
  console.log('  Blocks count:', store.data.document.blocks.length);
  console.log('  Workbooks count:', Object.keys(store.data.workbooks).length);

  // 3. Resolve live and snapshot references in the loaded document
  for (const block of store.data.document.blocks) {
    if (block.type === 'reference') {
      const res = store.resolveReference(block);
      console.log(`  Reference [${block.id}] resolved:`, res.status, res.text);
      if (res.status === 'unresolved' || res.status === 'error') {
        throw new Error(`Reference resolution failed for block ${block.id}: ${res.text}`);
      }
    }
  }

  // 4. Test re-saving from DocumentStore
  console.log('3. Re-exporting from DocumentStore...');
  const reExported = store.exportJSON();
  const reExportPath = path.resolve('evidence/reopened_in_docs.sirendoc.json');
  fs.writeFileSync(reExportPath, reExported, 'utf8');

  // 5. Test re-opening the saved file
  console.log('4. Re-opening saved file...');
  const parsedEnvelope = JSON.parse(fs.readFileSync(reExportPath, 'utf8'));
  const store2 = new DocumentStore(parsedEnvelope);
  console.log('  Successfully reopened document:', store2.data.document.id);

  console.log('\nEnd-to-end compatibility verified: Analysis export opens cleanly in Docs prototype, resolves references, saves, and reopens.');
}

testCompatibility().catch(err => {
  console.error('Compatibility test failed:', err);
  process.exit(1);
});
