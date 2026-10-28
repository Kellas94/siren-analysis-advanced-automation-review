import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
const host=path.join(path.dirname(fileURLToPath(import.meta.url)),'analysis_rpc_host.mjs');
export class AnalysisNodeTransport {
 constructor(configPath){this.configPath=configPath;this.config=JSON.parse(fs.readFileSync(configPath,'utf8'));this.ownedSession=true;this.pending=new Map();this.counter=0;this.logs='';this.child=null;this.starting=null;this.closed=false;this.receipts=[];this.providerAdmitted=false;this.ready=false;}
 async start(){
  if(this.closed)throw new Error('ANALYSIS_CONNECTION_CLOSED');if(this.starting)return this.starting;
  this.starting=new Promise((resolve,reject)=>{
   fs.mkdirSync(this.config.workDir,{recursive:true});
   const child=spawn(this.config.nodeExecutable,[host,this.configPath],{cwd:this.config.workDir,env:{...process.env,NODE_ENV:'production'},windowsHide:true});this.child=child;
   let ready=false,buffer='',decoder=new StringDecoder('utf8');
   const timer=setTimeout(()=>{reject(new Error('ANALYSIS_HOST_STARTUP_TIMEOUT'));child.kill();},15000);timer.unref();
   this.exited=new Promise(r=>child.once('close',(code,signal)=>{this.exit={pid:child.pid,code,signal};r(this.exit);}));
   child.stdout.on('data',chunk=>{
    buffer+=decoder.write(chunk);if(buffer.length>16*1024*1024){child.kill();return;}
    let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
     if(!line.startsWith('SIREN_ANALYSIS_RPC_V1 ')){this.logs=(this.logs+line+'\n').slice(-1048576);continue;}
     try{const message=JSON.parse(line.slice('SIREN_ANALYSIS_RPC_V1 '.length));if(message.event==='source-pins-verified'){this.providerAdmitted=true;continue;}if(message.event==='ready'){ready=true;this.ready=true;clearTimeout(timer);resolve();continue;}const pending=this.pending.get(message.id);if(!pending)continue;this.pending.delete(message.id);clearTimeout(pending.timer);if(message.ok)pending.resolve(message.value);else pending.reject(Object.assign(new Error(message.error?.message||'Analysis provider error'),message.error));}catch(e){this.logs=(this.logs+e.message+'\n').slice(-1048576);}
    }
   });
   child.stderr.on('data',c=>{this.logs=(this.logs+c.toString('utf8')).slice(-1048576);});
   child.stdin.on('error',()=>{});
   child.on('error',e=>{clearTimeout(timer);reject(Object.assign(e,{code:'ANALYSIS_HOST_UNAVAILABLE'}));});
   child.on('close',()=>{clearTimeout(timer);if(!ready)reject(Object.assign(new Error('Analysis host failed: '+this.logs),{code:'ANALYSIS_HOST_UNAVAILABLE'}));for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Object.assign(new Error('Analysis provider connection closed.'),{code:'ANALYSIS_CONNECTION_LOST'}));}this.pending.clear();});
  });return this.starting;
 }
 async request(method,payload){await this.start();if(this.exit)throw Object.assign(new Error('Analysis provider has exited.'),{code:'ANALYSIS_CONNECTION_LOST'});return new Promise((resolve,reject)=>{const id=++this.counter,timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(new Error('Analysis RPC response timed out; execution termination is unconfirmed.'),{code:'ANALYSIS_RPC_TIMEOUT'}));},15000);timer.unref();this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,payload})+'\n');});}
 catalog(){return this.request('catalog');}execute(payload){return this.request('execute',payload);}status(id){return this.request('status',id);}cancel(id){return this.request('cancel',id);}
 async close(){if(this.closed)return {closed:true,host:this.exit,receipts:this.receipts};if(!this.child){this.closed=true;return {closed:true,host:null,receipts:[]};}if(this.exit&&!this.ready){this.closed=true;return {closed:true,host:this.exit,receipts:[],startupRefused:true};}const receipts=await this.request('close');this.receipts=receipts;this.child.stdin.end();const exit=await this.exited;if(exit.code!==0||exit.signal||receipts.some(r=>!r.closed))throw new Error('ANALYSIS_SHUTDOWN_UNCONFIRMED');this.closed=true;return {closed:true,host:exit,receipts};}
}
