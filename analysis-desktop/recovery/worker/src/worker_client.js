import {fork} from 'node:child_process';
import path from 'node:path';import {fileURLToPath} from 'node:url';import EventEmitter from 'node:events';import crypto from 'node:crypto';
import {MessageTypes,validateSessionBinding} from './worker_protocol.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const error=(code,message=code)=>Object.assign(new Error(message),{code});
export class WorkerClient extends EventEmitter{
 constructor(options={}){super();if(typeof options.tempDir!=='string'||!path.isAbsolute(options.tempDir))throw error('EXPLICIT_ABSOLUTE_WORKER_TEMP_REQUIRED');this.workerPath=options.workerPath||path.join(here,'worker_process.js');this.tempDir=options.tempDir;this.child=null;this.workerPid=null;this.activeRequest=null;this.staleRepliesDropped=0;this.isShuttingDown=false;this.children=new Map();this.shutdownPromise=null;}
 ensureWorker(){if(this.isShuttingDown)throw error('WORKER_STOPPING');if(this.child){if(!this.child.killed&&this.child.exitCode===null&&this.child.connected)return this.child;throw error('WORKER_STOPPING');}
  const child=fork(this.workerPath,[],{execArgv:[],windowsHide:true,stdio:['inherit','inherit','inherit','ipc'],env:{...process.env,NODE_ENV:'production'}});const generation=crypto.randomUUID();this.child=child;this.workerPid=child.pid;this.generation=generation;
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>{if(this.child===child&&this.generation===generation){this.child=null;this.workerPid=null;const req=this.activeRequest;if(req&&req.child===child){this.activeRequest=null;req.reject(Object.assign(error(req.cancelled||this.isShuttingDown?'JOB_CANCELLED':'JOB_CRASHED',`Owned worker ${child.pid} closed (code:${code}, signal:${signal})`),{workerPid:child.pid,exitCode:code,signal}));}this.emit('worker_exit',{pid:child.pid,code,signal});}resolve({pid:child.pid,code,signal});}));this.children.set(child,{generation,closed});
  child.on('message',msg=>{if(this.child===child&&this.generation===generation)this.handleMessage(msg);else this.staleRepliesDropped++;});
  child.on('error',e=>{const req=this.activeRequest;if(req?.child===child){this.activeRequest=null;req.reject(e);}});return child;
 }
 handleMessage(msg){const req=this.activeRequest;if(!msg||!req||!validateSessionBinding(msg,req)||(msg.id&&msg.id!==req.id)){this.staleRepliesDropped++;return;}
  if(msg.type===MessageTypes.CANCEL_ACK){this.emit('cancel_acknowledged',msg);return;}
  if(![MessageTypes.EXECUTE_SUCCESS,MessageTypes.EXECUTE_FAILURE].includes(msg.type))return;
  this.activeRequest=null;if(req.cancelled){req.reject(error('JOB_CANCELLED'));return;}
  req.resolve({receipt:msg.receipt,capturedRows:msg.capturedRows||[],workerPid:req.child.pid,engineVersion:msg.engineVersion,error:msg.error});
 }
 async execute(spec){if(this.isShuttingDown)throw error('WORKER_STOPPING');if(this.activeRequest)throw error('WORKER_BUSY');const request=JSON.parse(JSON.stringify(spec));for(const k of ['jobId','attemptId','sessionToken'])if(typeof request[k]!=='string'||!request[k])throw error('WORKER_REQUEST_STAMP');const child=this.ensureWorker();
  return new Promise((resolve,reject)=>{const req={id:crypto.randomUUID(),jobId:request.jobId,attemptId:request.attemptId,sessionToken:request.sessionToken,child,cancelled:false,resolve,reject};this.activeRequest=req;child.send({...request,type:MessageTypes.EXECUTE_REQUEST,id:req.id,tempDir:this.tempDir},e=>{if(e&&this.activeRequest===req){this.activeRequest=null;reject(e);}});});
 }
 cancelActiveQuery(expected){const req=this.activeRequest;if(!req||!this.child||!validateSessionBinding(expected,req))return {requested:false};req.cancelled=true;try{req.child.send({type:MessageTypes.CANCEL_REQUEST,id:req.id,jobId:req.jobId,attemptId:req.attemptId,sessionToken:req.sessionToken});}catch{}return {requested:true};}
 async killWorkerProcess(signal='SIGKILL'){const child=this.child;if(!child)return;const record=this.children.get(child);if(child.exitCode===null&&!child.killed)child.kill(signal);return await record.closed;}
 async injectChildCrash(){const child=this.child;if(!child)return;child.send({type:MessageTypes.CRASH_INJECT,...(this.activeRequest?{jobId:this.activeRequest.jobId,attemptId:this.activeRequest.attemptId,sessionToken:this.activeRequest.sessionToken}:{})});return await this.children.get(child).closed;}
 async shutdown(){if(this.shutdownPromise)return this.shutdownPromise;this.isShuttingDown=true;
  this.shutdownPromise=(async()=>{const child=this.child;if(!child)return;const record=this.children.get(child);if(this.activeRequest)this.cancelActiveQuery(this.activeRequest);const start=Date.now();while(this.activeRequest&&this.child===child&&Date.now()-start<500)await new Promise(r=>setTimeout(r,5));
   if(this.activeRequest&&this.child===child){if(!child.killed)child.kill('SIGKILL');}
   else if(child.exitCode===null&&!child.killed){try{child.send({type:MessageTypes.SHUTDOWN_REQUEST});}catch{child.kill('SIGTERM');}}
   const timer=setTimeout(()=>{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');},1000);timer.unref();try{await record.closed;}finally{clearTimeout(timer);}
  })();try{return await this.shutdownPromise;}finally{this.shutdownPromise=null;this.isShuttingDown=false;}
 }
}
