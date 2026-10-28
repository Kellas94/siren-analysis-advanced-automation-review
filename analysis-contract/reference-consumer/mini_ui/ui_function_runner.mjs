import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {generateUiPython} from './ui_python_generator.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
function killOwned(child){if(!child?.pid||!alive(child.pid))return;if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/f','/t'],{windowsHide:true}).on('error',()=>{});else child.kill('SIGKILL');}
export class UiFunctionRunner {
 constructor(options={}){this.pythonPath=options.pythonPath||'C:/Program Files/Python312/python.exe';this.scratchDir=options.scratchDir||path.join(root,'data/scratch/ui-functions');this.activeJobs=new Map();this.completedJobs=new Map();this.maxOutputBytes=options.maxOutputBytes||2*1024*1024;fs.mkdirSync(this.scratchDir,{recursive:true});}
 run(fn,parameters,{jobId}={}){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(jobId||''))throw new Error('INVALID_UI_JOB_ID');
  if(this.activeJobs.has(jobId))throw new Error('UI_JOB_ALREADY_RUNNING');
  const scriptPath=path.join(this.scratchDir,jobId+'.py'),code=generateUiPython(fn);
  if(fs.existsSync(scriptPath))throw new Error('UI_JOB_ID_REUSED');
  fs.writeFileSync(scriptPath,code,{encoding:'utf8',flag:'wx'});
  const child=spawn(this.pythonPath,['-B','-u',scriptPath],{env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},windowsHide:true});
  const job={jobId,child,pid:child.pid,cancelRequested:false,outputLimit:false,scriptPath};let finish;
  job.finished=new Promise(resolve=>{finish=resolve;});this.activeJobs.set(jobId,job);
  let stdout='',stderr='',bytes=0,settled=false;const started=Date.now();
  const complete=result=>{if(settled)return;settled=true;this.activeJobs.delete(jobId);const record={...result,jobId,pid:job.pid,elapsedMs:Date.now()-started,scriptPath,stdout,stderr};this.completedJobs.set(jobId,{status:record.status,stopped:true});if(this.completedJobs.size>1000)this.completedJobs.delete(this.completedJobs.keys().next().value);finish(record);};
  const capture=(channel,chunk)=>{bytes+=chunk.length;if(bytes>this.maxOutputBytes){job.outputLimit=true;killOwned(child);return;}if(channel==='stdout')stdout+=chunk.toString('utf8');else stderr+=chunk.toString('utf8');};
  child.stdout.on('data',c=>capture('stdout',c));child.stderr.on('data',c=>capture('stderr',c));
  child.on('error',e=>complete({status:'FAILED',code:'RUNTIME_UNAVAILABLE',error:e.message}));
  child.on('close',(exitCode,signal)=>{
   if(job.outputLimit)return complete({status:'FAILED',code:'UI_OUTPUT_LIMIT_EXCEEDED',error:'UI function output exceeded '+this.maxOutputBytes+' bytes.',exitCode,signal});
   if(job.cancelRequested)return complete({status:'CANCELLED',exitCode,signal});
   let frame;try{const line=stdout.split(/\r?\n/).filter(l=>l.startsWith('SIREN_UI_RESULT_V1 ')).pop();if(line)frame=JSON.parse(line.slice('SIREN_UI_RESULT_V1 '.length));}catch{}
   if(exitCode!==0||frame?.status!=='COMPLETED'||!frame.result||typeof frame.result!=='object'||Array.isArray(frame.result))return complete({status:'FAILED',code:'UI_FUNCTION_FAILED',error:frame?.error||stderr||'UI worker exited without a valid result.',exitCode,signal});
   complete({status:'COMPLETED',result:frame.result,exitCode,signal});
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(parameters));return job.finished;
 }
 async cancelJob(jobId){
  const job=this.activeJobs.get(jobId);if(!job){const completed=this.completedJobs.get(jobId);return {success:false,stopped:!!completed,reason:completed?'ALREADY_FINISHED':'JOB_NOT_FOUND',jobId,...completed};}
  job.cancelRequested=true;killOwned(job.child);const start=Date.now();let retried=false;
  while(job.pid&&alive(job.pid)&&job.child.exitCode===null&&Date.now()-start<5000){if(!retried&&Date.now()-start>1000){retried=true;killOwned(job.child);}await new Promise(r=>setTimeout(r,25));}
  if(job.pid&&alive(job.pid)&&job.child.exitCode===null)return {success:false,stopped:false,reason:'PROCESS_TERMINATION_TIMEOUT',jobId,pid:job.pid};
  const result=await job.finished;return {success:result.status==='CANCELLED',stopped:true,status:result.status,jobId,pid:job.pid};
 }
}
