import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {observeWindowsProcesses} from '../../docs-measured-qa-review-v1/candidate/scripts/native_admission.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),version=process.argv[2]||'final-v1';
if(!/^[a-z0-9-]+$/.test(version))throw Error('Explicit observation version required');
const out=path.join(root,'evidence/process-check-'+version+'.json');
if(fs.existsSync(out))throw Error('Preserve previous observation');
let observation;try{observation=await observeWindowsProcesses();}catch(error){fs.writeFileSync(out,JSON.stringify({valid:false,reason:error.message,utc:new Date().toISOString()})+'\n');throw error;}
const needle=root.toLowerCase();
const owned=observation.records.filter(r=>r.pid!==process.pid&&/^(node|electron)\.exe$/i.test(path.win32.basename(r.executablePath||''))&&String(r.commandLine||'').toLowerCase().includes(needle));
const result={utc:observation.observedAt,scope:'Visible Node/Electron command lines under this own lot only; inaccessible metadata is unknown, not global absence',observed:observation.records.length,unavailableBothFields:observation.records.filter(r=>!r.executablePath&&!r.commandLine).length,visibleOwned:owned};
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(owned.length)process.exitCode=1;
