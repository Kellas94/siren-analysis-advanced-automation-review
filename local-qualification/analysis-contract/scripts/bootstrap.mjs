// Trusted Analysis-owner bootstrap. No history path/grant/publish administration in RPC.
import fs from 'node:fs';import path from 'node:path';
import {AnalysisProvider,sha} from '../provider/src/provider.mjs';
import {CONTRACT,fail} from '../provider/src/contract.mjs';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);if(entry.isSymbolicLink())fail('HISTORY_EXECUTOR_MISMATCH','Reparse entry in executor');return entry.isDirectory()?walk(file):entry.isFile()?[file]:[];});
export function trustedHistory(config,base){
 if(!config.history)return null;
 const h=config.history,root=fs.realpathSync(config.workDir),provider=fs.realpathSync(config.providerRoot);
 if(provider!==fs.realpathSync(path.resolve(import.meta.dirname,'../provider')))fail('HISTORY_EXECUTOR_MISMATCH','Configured provider differs from the actually imported executor');
 if(Object.keys(h).some(k=>!['directory','storeId','grantId','create'].includes(k))||!['storeId','grantId'].every(k=>typeof h[k]==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(h[k]))||h.create!==undefined&&typeof h.create!=='boolean')fail('HISTORY_CONFIG','Explicit store/grant identities and create flag required');
 if(typeof h.directory!=='string'||!path.isAbsolute(h.directory)||!path.resolve(h.directory).startsWith(root+path.sep))fail('HISTORY_CONFIG','Owned absolute history directory under trusted grant required');
 let ancestor=root;for(const segment of path.relative(root,path.resolve(h.directory)).split(path.sep)){ancestor=path.join(ancestor,segment);let stat;try{stat=fs.lstatSync(ancestor);}catch(error){if(error.code==='ENOENT')break;fail('HISTORY_CONFIG','History ancestor unavailable');}if(stat.isSymbolicLink()||!stat.isDirectory())fail('HISTORY_CONFIG','History path must not traverse a reparse or non-directory entry');}
 if(!Array.isArray(config.sourcePins)||!config.sourcePins.length)fail('HISTORY_EXECUTOR_MISMATCH','Approved executor source/native pins required');
 const pins=new Map(config.sourcePins.map(p=>[path.resolve(p.path),p.sha256])),files=walk(provider).sort();
 const declared=[...pins.keys()].filter(p=>p.startsWith(provider+path.sep));if(declared.length!==files.length)fail('HISTORY_EXECUTOR_MISMATCH','Approved executor membership differs');
 const roster=files.map(file=>{const digest=sha(fs.readFileSync(file));if(pins.get(file)!==digest)fail('HISTORY_EXECUTOR_MISMATCH','Executor changed: '+file);return{path:path.relative(provider,file).split(path.sep).join('/'),sha256:digest};});
 const bootstrap=sha(fs.readFileSync(import.meta.filename));if(pins.get(import.meta.filename)!==bootstrap)fail('HISTORY_EXECUTOR_MISMATCH','Bootstrap source pin differs');
 const executorSha256=sha({protocol:'siren.analysis-executor/1',contractVersion:CONTRACT,node:process.versions.node,platform:process.platform,arch:process.arch,files:roster,bootstrap});
 return{directory:path.resolve(h.directory),create:h.create===true,authority:{schema:'siren.analysis-authority/1',storeId:h.storeId,grantId:h.grantId,grantRoot:root,baseCatalogSha256:sha(base),contractVersion:CONTRACT,executorSha256}};
}
export async function createProvider(config){
 const base=JSON.parse(fs.readFileSync(path.join(config.providerRoot,'catalog.base.json'),'utf8'));
 // Constructor validates/rehydrates all committed metadata before spawning RunnerService.
 const provider=new AnalysisProvider({workDir:config.workDir,baseCatalog:base,history:trustedHistory(config,base)}),seen=new Map();
 const refresh=async()=>{
  if(!config.publicationRegistry)return;
  const registry=JSON.parse(fs.readFileSync(config.publicationRegistry,'utf8'));if(!Array.isArray(registry.publications))throw Error('PUBLICATION_REGISTRY_SHAPE');
  for(const publication of registry.publications){const key=publication.id+'@'+publication.version,digest=sha(publication);if(seen.has(key)){if(seen.get(key)!==digest)throw Error('IMMUTABLE_PUBLICATION_REGISTRY');continue;}provider.publish(publication);seen.set(key,digest);}
 };
 try{await refresh();return{provider,refresh};}catch(error){await provider.close();throw error;}
}
