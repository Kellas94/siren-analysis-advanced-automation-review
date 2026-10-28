// Consumer transport host. Analytical work is delegated to the Analysis-owned SDK.
import fs from 'node:fs';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const send=value=>process.stdout.write('SIREN_ANALYSIS_RPC_V1 '+JSON.stringify(value)+'\n');
for(const item of config.sourcePins||[]){const actual=createHash('sha256').update(fs.readFileSync(item.path)).digest('hex');if(actual!==item.sha256)throw new Error('ANALYSIS_SOURCE_DRIFT: '+item.path);}
send({event:'source-pins-verified'});
const bootstrap=await import(pathToFileURL(config.bootstrapModule).href);
const {provider,refresh}=await bootstrap.createProvider(config);
let closing=false,closed=false;
async function close(){if(closed)return [];closed=true;return await provider.close();}
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{(async()=>{
 let request;try{
  request=JSON.parse(line);if(closing)throw new Error('ANALYSIS_HOST_CLOSING');
  if(!['catalog','execute','status','cancel','close'].includes(request.method))throw new Error('UNKNOWN_ANALYSIS_METHOD');
  let value;
  if(request.method==='catalog'){await refresh?.();value=await provider.catalog();}
  else if(request.method==='close'){closing=true;value=await close();}
  else value=await provider[request.method](request.payload);
  send({id:request.id,ok:true,value});if(closing){input.close();process.stdin.destroy();process.exitCode=0;}
 }catch(error){send({id:request?.id,ok:false,error:{code:error.code||'ANALYSIS_PROVIDER_ERROR',message:error.message,details:error.details}});}
 })().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});});
input.on('close',()=>{if(!closing){closing=true;close().then(()=>{process.exitCode=0;},e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});}});
send({event:'ready'});
