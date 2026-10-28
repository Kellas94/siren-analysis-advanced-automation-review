import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {validateForm} from './ui_form_model.js';
const MAX_FORM_BYTES=2*1024*1024;
function validate(form){const result=validateForm(form);if(!result.valid)throw new Error('INVALID_FORM: '+result.errors.map(e=>e.code+': '+e.message).join('; '));const text=JSON.stringify(form,null,2);if(Buffer.byteLength(text,'utf8')>MAX_FORM_BYTES)throw new Error('FORM_SIZE_LIMIT_EXCEEDED: 2 MiB');return text;}
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
export function readForm(filePath){const size=fs.statSync(filePath).size;if(size>MAX_FORM_BYTES)throw new Error('FORM_SIZE_LIMIT_EXCEEDED: 2 MiB');const form=JSON.parse(fs.readFileSync(filePath,'utf8'));validate(form);return form;}
export function saveForm(form,filePath,{fsOps=fs}={}){
 const text=validate(form),target=path.resolve(filePath),directory=path.dirname(target);
 fsOps.mkdirSync(directory,{recursive:true});
 if(fsOps.existsSync(target)&&(fsOps.lstatSync(target).isSymbolicLink()||!fsOps.lstatSync(target).isFile()))throw new Error('FORM_SAVE_FAILED: target is not a regular file');
 const initial=fsOps.existsSync(target)?digest(fsOps.readFileSync(target)):null;
 const temporary=path.join(directory,'.sirenui-save-'+randomUUID()+'.tmp');let fd;
 try{
  fd=fsOps.openSync(temporary,'wx');fsOps.writeFileSync(fd,text,'utf8');fsOps.fsyncSync(fd);fsOps.closeSync(fd);fd=undefined;
  if(fsOps.existsSync(target)&&fsOps.lstatSync(target).isSymbolicLink())throw new Error('TARGET_CHANGED_TO_LINK');
  const current=fsOps.existsSync(target)?digest(fsOps.readFileSync(target)):null;
  if(current!==initial)throw new Error('FORM_TARGET_CHANGED_DURING_SAVE');
  fsOps.renameSync(temporary,target);return {success:true,filePath:target};
 }catch(error){
  if(fd!==undefined)try{fsOps.closeSync(fd);}catch{}
  let cleanupError;try{if(fsOps.existsSync(temporary))fsOps.unlinkSync(temporary);}catch(e){cleanupError=e.message;}
  throw Object.assign(new Error('FORM_SAVE_FAILED: '+error.message+(cleanupError?'; staging retained at '+temporary+': '+cleanupError:'')),{code:'FORM_SAVE_FAILED',temporaryPath:cleanupError?temporary:undefined});
 }
}
