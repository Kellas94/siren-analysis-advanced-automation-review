import {createEmptyDocument,createSemanticNode} from '../src/model/schema.js';
import {computeLogicRevision} from '../src/model/logic_revision.js';
import {assertExactJsonNumbers} from '../src/model/value_integrity.js';

export const CONTROL_TYPES=Object.freeze(['text','number','checkbox','select','button','result','table','label']);
export const PARAMETER_TYPES=Object.freeze(['string','number','integer','decimal','boolean']);
export const clone=value=>JSON.parse(JSON.stringify(value));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fresh=prefix=>prefix+'_'+(globalThis.crypto?.randomUUID?.().replaceAll('-','')||Date.now().toString(36)+Math.random().toString(36).slice(2));
const idPattern=/^[A-Za-z0-9_-]{1,160}$/;
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value)??'null';}

export function createFormDocument(title='Untitled form'){
 return {schemaVersion:'siren.mini-ui/2',formId:fresh('form'),version:1,title,canvas:{width:960,height:640},controls:[],functions:[],actions:[]};
}
export function createControl(type,overrides={}){
 if(!CONTROL_TYPES.includes(type))throw new Error('UNKNOWN_CONTROL_TYPE');
 const defaults={text:{dataType:'string',defaultValue:'',required:false},number:{dataType:'decimal',defaultValue:'0',required:true},checkbox:{dataType:'boolean',defaultValue:false,required:false},select:{dataType:'string',defaultValue:'first',options:[{label:'First option',value:'first'},{label:'Second option',value:'second'}],required:true},button:{},result:{},table:{},label:{text:'Label'}};
 return {...defaults[type],...clone(overrides),id:overrides.id||fresh('control'),type,label:overrides.label??({text:'Text field',number:'Number field',checkbox:'Checkbox',select:'Select option',button:'Run action',result:'Result',table:'Result table',label:'Label'}[type]),position:{x:24,y:24,...overrides.position},size:{width:240,height:type==='table'?200:type==='result'?90:72,...overrides.size}};
}
export function captureWorkflow(document,{name,id}={}){
 assertExactJsonNumbers(document);
 if(document?.$schema!=='siren.visual-builder/1.0.0')throw new Error('WORKFLOW_DOCUMENT_REQUIRED');
 return {id:id||fresh('function'),name:name||document.name||'Workflow function',document:clone(document),capturedRevision:computeLogicRevision(document.semantics)};
}
export function getFunctionParameters(fn){
 return Object.entries(fn?.document?.semantics?.parameters||{}).map(([name,meta])=>({name,type:meta?.type||'string',...(own(meta||{},'default')?{default:clone(meta.default)}:{}),required:meta?.required??!own(meta||{},'default')}));
}
export function getFunctionResultNodes(fn){return (fn?.document?.semantics?.nodes||[]).filter(n=>n&&n.executable!==false&&!['annotation','export'].includes(n.type)).map(n=>({id:n.id,name:n.name||n.id,type:n.type}));}

export function validateForm(form,{forRun=false}={}){
 const errors=[],error=(code,message,details={})=>errors.push({code,message,...details});
 if(!form||typeof form!=='object'||Array.isArray(form))return {valid:false,errors:[{code:'INVALID_FORM',message:'A form definition is required.'}]};
 try{assertExactJsonNumbers(form);}catch(e){error('NON_EXACT_FORM_VALUE',e.message);}
 if(form.schemaVersion!=='siren.mini-ui/2')error('UNSUPPORTED_FORM_SCHEMA','Unsupported Mini UI form schema.');
 if(typeof form.formId!=='string'||!idPattern.test(form.formId))error('INVALID_FORM_ID','Form requires a stable valid ID.');
 if(typeof form.title!=='string')error('INVALID_FORM_TITLE','Form title must be text.');
 if(!Number.isSafeInteger(form.version)||form.version<1)error('INVALID_FORM_VERSION','Form version must be a positive integer.');
 if(!form.canvas||![form.canvas.width,form.canvas.height].every(n=>Number.isFinite(n)&&n>=160&&n<=20000))error('INVALID_CANVAS','Canvas size must be between 160 and 20000.');
 if(!Array.isArray(form.controls)||!Array.isArray(form.functions)||!Array.isArray(form.actions))return {valid:false,errors:[...errors,{code:'INVALID_FORM_COLLECTION',message:'Controls, functions and actions must be arrays.'}]};
 if(form.controls.length>500||form.functions.length>64||form.actions.length>500)error('FORM_LIMIT_EXCEEDED','Supported limits: 500 controls, 64 functions and 500 actions.');
 const controls=new Map(),functions=new Map(),actionIds=new Set(),buttons=new Set();
 for(const c of form.controls){
  if(!c||typeof c!=='object'){error('INVALID_CONTROL','Invalid control.');continue;}
  if(typeof c.id!=='string'||!idPattern.test(c.id)||controls.has(c.id))error('DUPLICATE_OR_INVALID_CONTROL_ID','Control IDs must be valid and unique.',{controlId:c.id});
  controls.set(c.id,c);
  if(!CONTROL_TYPES.includes(c.type))error('UNKNOWN_CONTROL_TYPE','Unsupported control type: '+c.type,{controlId:c.id});
  if(typeof c.label!=='string')error('INVALID_CONTROL_LABEL','Control labels must be text.',{controlId:c.id});
  if(!c.position||![c.position.x,c.position.y].every(n=>Number.isFinite(n)&&n>=0&&n<=20000)||!c.size||![c.size.width,c.size.height].every(n=>Number.isFinite(n)&&n>=24&&n<=20000))error('INVALID_CONTROL_GEOMETRY','Control position and size are invalid.',{controlId:c.id});
  if(['text','number','checkbox','select'].includes(c.type)){
   const allowed=c.type==='text'?['string']:c.type==='checkbox'?['boolean']:c.type==='number'?['number','integer','decimal']:PARAMETER_TYPES;
   if(!allowed.includes(c.dataType))error('INVALID_CONTROL_DATA_TYPE','Control has an incompatible value type.',{controlId:c.id});
  }
  if(c.type==='select'&&(!Array.isArray(c.options)||!c.options.length||c.options.some(o=>!o||typeof o.label!=='string'||!own(o,'value'))))error('INVALID_SELECT_OPTIONS','Select controls require labeled values.',{controlId:c.id});
 }
 for(const fn of form.functions){
  if(!fn||typeof fn.id!=='string'||!idPattern.test(fn.id)||functions.has(fn.id)){error('DUPLICATE_OR_INVALID_FUNCTION_ID','Function IDs must be valid and unique.');continue;}
  functions.set(fn.id,fn);
  if(typeof fn.name!=='string'||fn.document?.$schema!=='siren.visual-builder/1.0.0'||!Array.isArray(fn.document?.semantics?.nodes)||!Array.isArray(fn.document?.semantics?.connections))error('INVALID_FUNCTION_DOCUMENT','Function requires a captured Visual Builder workflow.',{functionId:fn.id});
  for(const p of getFunctionParameters(fn))if(!PARAMETER_TYPES.includes(p.type))error('UNSUPPORTED_PARAMETER_TYPE','Unsupported parameter type '+p.type,{functionId:fn.id});
 }
 for(const a of form.actions){
  if(!a||typeof a.id!=='string'||!idPattern.test(a.id)||actionIds.has(a.id)){error('DUPLICATE_OR_INVALID_ACTION_ID','Action IDs must be valid and unique.');continue;}
  actionIds.add(a.id);
  if(buttons.has(a.buttonId))error('DUPLICATE_BUTTON_ACTION','Each button can have one action.',{actionId:a.id});buttons.add(a.buttonId);
  if(!a.inputs||typeof a.inputs!=='object'||Array.isArray(a.inputs)||!Array.isArray(a.outputs))error('INVALID_ACTION_BINDINGS','Action input/output bindings are invalid.',{actionId:a.id});
  if(!forRun)continue;
  if(controls.get(a.buttonId)?.type!=='button')error('INVALID_ACTION_BUTTON','Action requires an existing button.',{actionId:a.id});
  const fn=functions.get(a.functionId);if(!fn){error('MISSING_BOUND_FUNCTION','Choose a captured function.',{actionId:a.id});continue;}
  const params=new Map(getFunctionParameters(fn).map(p=>[p.name,p]));
  for(const [name,controlId] of Object.entries(a.inputs||{}))if(!params.has(name)||!['text','number','checkbox','select'].includes(controls.get(controlId)?.type))error('INVALID_INPUT_BINDING','Input binding references an unknown parameter or control.',{actionId:a.id,controlId});
  for(const p of params.values())if(!own(a.inputs||{},p.name)&&p.required&&!own(p,'default'))error('MISSING_INPUT_BINDING','Required parameter '+p.name+' is not bound.',{actionId:a.id});
  if(!a.outputs?.length)error('MISSING_OUTPUT_BINDING','Bind at least one result.',{actionId:a.id});
  const resultNodes=new Set(getFunctionResultNodes(fn).map(n=>n.id)),targets=new Set();
  for(const o of a.outputs||[]){
   const ctrl=controls.get(o?.controlId);if(!o||targets.has(o.controlId)||!resultNodes.has(o.nodeId)||o.mode==='scalar'&&(ctrl?.type!=='result'||typeof o.column!=='string'||!o.column)||o.mode==='table'&&ctrl?.type!=='table'||!['scalar','table'].includes(o.mode))error('INVALID_OUTPUT_BINDING','Output must name an existing result node and compatible control.',{actionId:a.id,controlId:o?.controlId});
   targets.add(o?.controlId);
  }
 }
 if(forRun)for(const c of form.controls)if(c.type==='button'&&!buttons.has(c.id))error('UNBOUND_BUTTON','Button has no action.',{controlId:c.id});
 return {valid:errors.length===0,errors};
}

export function executionRevision(form){return canonical({formId:form.formId,controls:form.controls.map(c=>({id:c.id,type:c.type,dataType:c.dataType,defaultValue:c.defaultValue,required:c.required,options:c.options?.map(o=>({value:o.value})),min:c.min,max:c.max})),functions:form.functions.map(f=>({id:f.id,logic:computeLogicRevision(f.document?.semantics)})),actions:form.actions});}
export function valuesRevision(values){return canonical(values);}

export function createExampleForm(kind='arithmetic'){
 const form=createFormDocument(kind==='text'?'Personal greeting':'Order total');
 const doc=createEmptyDocument(form.title);
 let controls,inputs,column;
 if(kind==='text'){
  doc.semantics.parameters={name:{type:'string',default:'Ada'},formal:{type:'boolean',default:false}};
  doc.semantics.nodes=[createSemanticNode({id:'message',type:'custom_python',params:{code:'greeting = ("Hello, " if formal else "Hi, ") + name\ncon.execute("CREATE TABLE message (text VARCHAR)")\ncon.execute("INSERT INTO message VALUES (?)", [greeting])'}})];
  controls=[createControl('text',{id:'name',label:'Name',defaultValue:'Ada',position:{x:32,y:32}}),createControl('checkbox',{id:'formal',label:'Formal greeting',position:{x:32,y:120}})];inputs={name:'name',formal:'formal'};column='text';
 }else if(kind==='arithmetic'){
  doc.semantics.parameters={quantity:{type:'decimal',default:'2'},price:{type:'decimal',default:'12.50'}};
  doc.semantics.nodes=[createSemanticNode({id:'result',type:'custom_python',params:{code:'con.execute("CREATE TABLE result AS SELECT ? * ? AS total", [quantity, price])'}})];
  controls=[createControl('number',{id:'quantity',label:'Quantity',defaultValue:'2',position:{x:32,y:32}}),createControl('number',{id:'price',label:'Unit price',defaultValue:'12.50',position:{x:32,y:120}})];inputs={quantity:'quantity',price:'price'};column='total';
 }else throw new Error('UNKNOWN_EXAMPLE_FORM');
 controls.push(createControl('button',{id:'run',label:kind==='text'?'Create greeting':'Calculate total',position:{x:32,y:208},size:{width:240,height:48}}),createControl('result',{id:'output',label:kind==='text'?'Greeting':'Total',position:{x:32,y:280}}));
 form.controls=controls;form.functions=[captureWorkflow(doc,{id:'example_function'})];form.actions=[{id:'run_action',buttonId:'run',functionId:'example_function',inputs,outputs:[{controlId:'output',nodeId:doc.semantics.nodes[0].id,column,mode:'scalar'}]}];return form;
}
