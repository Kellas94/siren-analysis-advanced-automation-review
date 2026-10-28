import {assertExactJsonNumbers} from '../src/model/value_integrity.js';
export const CONTROL_TYPES=Object.freeze(['text','number','checkbox','select','button','result','table','label']);
export const PARAMETER_TYPES=Object.freeze(['string','number','integer','decimal','boolean']);
export const clone=value=>JSON.parse(JSON.stringify(value));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fresh=prefix=>prefix+'_'+(globalThis.crypto?.randomUUID?.().replaceAll('-','')||Date.now().toString(36)+Math.random().toString(36).slice(2));
const idPattern=/^[A-Za-z0-9_-]{1,160}$/;
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value)??'null';}

export function createFormDocument(title='Untitled form'){
 return {schemaVersion:'siren.mini-ui/3',formId:fresh('form'),version:1,title,canvas:{width:960,height:640},controls:[],functions:[],actions:[]};
}
export function createControl(type,overrides={}){
 if(!CONTROL_TYPES.includes(type))throw new Error('UNKNOWN_CONTROL_TYPE');
 const defaults={text:{dataType:'string',defaultValue:'',required:false},number:{dataType:'decimal',defaultValue:'0',required:true},checkbox:{dataType:'boolean',defaultValue:false,required:false},select:{dataType:'string',defaultValue:'first',options:[{label:'First option',value:'first'},{label:'Second option',value:'second'}],required:true},button:{},result:{},table:{},label:{text:'Label'}};
 return {...defaults[type],...clone(overrides),id:overrides.id||fresh('control'),type,label:overrides.label??({text:'Text field',number:'Number field',checkbox:'Checkbox',select:'Select option',button:'Run action',result:'Result',table:'Result table',label:'Label'}[type]),position:{x:24,y:24,...overrides.position},size:{width:240,height:type==='table'?200:type==='result'?90:72,...overrides.size}};
}
const pythonKeywords=new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
const pyName=name=>typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)&&!pythonKeywords.has(name);
export function createUiFunction(overrides={}){return {id:fresh('function'),name:'UI function',kind:'ui-python',entryPoint:'calculate',source:'def calculate(value):\n    return {"value": value}',parameters:[{name:'value',type:'string',default:'Hello',required:false}],returns:[{name:'value',type:'string',nullable:false}],...clone(overrides)};}
export function getFunctionParameters(fn){return (fn?.parameters||[]).map(p=>({...p,required:p.required??!own(p,'default')}));}
export function getFunctionOutputs(fn){return clone(fn?.returns||[]);}
export function validateForm(form,{forRun=false}={}){
 const errors=[],error=(code,message,details={})=>errors.push({code,message,...details});
 if(!form||typeof form!=='object'||Array.isArray(form))return {valid:false,errors:[{code:'INVALID_FORM',message:'A form definition is required.'}]};
 try{assertExactJsonNumbers(form);}catch(e){error('NON_EXACT_FORM_VALUE',e.message);}
 if(form.schemaVersion!=='siren.mini-ui/3')error('UNSUPPORTED_FORM_SCHEMA','Expected a UI-owned Mini UI v3 definition.');
 if(typeof form.formId!=='string'||!idPattern.test(form.formId))error('INVALID_FORM_ID','A stable form ID is required.');
 if(typeof form.title!=='string'||!Number.isSafeInteger(form.version)||form.version<1)error('INVALID_FORM_METADATA','A title and positive version are required.');
 if(!form.canvas||![form.canvas.width,form.canvas.height].every(n=>Number.isFinite(n)&&n>=160&&n<=20000))error('INVALID_CANVAS','Canvas dimensions must be between 160 and 20000.');
 if(!Array.isArray(form.controls)||!Array.isArray(form.functions)||!Array.isArray(form.actions))return {valid:false,errors:[...errors,{code:'INVALID_FORM_COLLECTION',message:'Controls, functions and actions must be arrays.'}]};
 if(form.controls.length>500||form.functions.length>64||form.actions.length>500)error('FORM_LIMIT_EXCEEDED','Supported: 500 controls, 64 functions, 500 actions.');
 const controls=new Map(),functions=new Map(),actions=new Set(),buttons=new Set();
 for(const c of form.controls){
  if(!c||typeof c!=='object'){error('INVALID_CONTROL','Control must be an object.');continue;}
  if(typeof c.id!=='string'||!idPattern.test(c.id)||controls.has(c.id))error('DUPLICATE_OR_INVALID_CONTROL_ID','Control IDs must be valid and unique.',{controlId:c.id});controls.set(c.id,c);
  if(!CONTROL_TYPES.includes(c.type))error('UNKNOWN_CONTROL_TYPE','Unsupported control type.',{controlId:c.id});
  if(typeof c.label!=='string'||!c.position||![c.position.x,c.position.y].every(n=>Number.isFinite(n)&&n>=0&&n<=20000)||!c.size||![c.size.width,c.size.height].every(n=>Number.isFinite(n)&&n>=24&&n<=20000))error('INVALID_CONTROL_PROPERTIES','Control label/geometry is invalid.',{controlId:c.id});
  if(['text','number','checkbox','select'].includes(c.type)){
   const allowed=c.type==='text'?['string']:c.type==='checkbox'?['boolean']:c.type==='number'?['number','integer','decimal']:PARAMETER_TYPES;
   if(!allowed.includes(c.dataType))error('INVALID_CONTROL_DATA_TYPE','Control has an incompatible value type.',{controlId:c.id});
  }
  if(c.type==='select'&&(!Array.isArray(c.options)||!c.options.length||c.options.some(o=>!o||typeof o.label!=='string'||!own(o,'value'))))error('INVALID_SELECT_OPTIONS','Select controls require labeled values.',{controlId:c.id});
 }
 for(const fn of form.functions){
  if(!fn||typeof fn.id!=='string'||!idPattern.test(fn.id)||functions.has(fn.id)){error('DUPLICATE_OR_INVALID_FUNCTION_ID','Function IDs must be valid and unique.');continue;}functions.set(fn.id,fn);
  if(typeof fn.name!=='string'||!['ui-python','analysis-workflow'].includes(fn.kind)||!Array.isArray(fn.parameters)||!Array.isArray(fn.returns)){error('INVALID_FUNCTION','Function kind/signature is invalid.',{functionId:fn.id});continue;}
  if(fn.kind==='ui-python'&&(typeof fn.source!=='string'||typeof fn.entryPoint!=='string'||forRun&&(!pyName(fn.entryPoint)||!fn.source.trim())))error('INVALID_UI_FUNCTION','UI function requires Python source and a valid entry point.',{functionId:fn.id});
  if(fn.kind==='analysis-workflow'&&(own(fn,'document')||own(fn,'source')||forRun&&(!fn.reference||typeof fn.reference!=='object'||Array.isArray(fn.reference)||!Object.keys(fn.reference).length)))error('INVALID_ANALYSIS_REFERENCE','Analysis actions contain the owner-published contract reference, never a local graph.',{functionId:fn.id});
  const names=new Set(),fields=new Set();
  for(const p of fn.parameters){if(!p||!pyName(p.name)||names.has(p.name)||!PARAMETER_TYPES.includes(p.type))error('INVALID_PARAMETER','Parameter names/types must be valid and unique.',{functionId:fn.id});names.add(p?.name);}
  for(const p of fn.returns){if(!p||typeof p.name!=='string'||!p.name||fields.has(p.name)||![...PARAMETER_TYPES,'json','table'].includes(p.type)||p.type==='table'&&fn.kind!=='analysis-workflow')error('INVALID_RETURN_FIELD','Return fields must be valid and unique.',{functionId:fn.id});fields.add(p?.name);}
 }
 for(const a of form.actions){
  if(!a||typeof a.id!=='string'||!idPattern.test(a.id)||actions.has(a.id)){error('DUPLICATE_OR_INVALID_ACTION_ID','Action IDs must be valid and unique.');continue;}actions.add(a.id);
  if(buttons.has(a.buttonId))error('DUPLICATE_BUTTON_ACTION','Each button has at most one action.',{actionId:a.id});buttons.add(a.buttonId);
  if(!a.inputs||typeof a.inputs!=='object'||Array.isArray(a.inputs)||!Array.isArray(a.outputs)){error('INVALID_ACTION_BINDINGS','Action bindings must be an input map and output array.',{actionId:a.id});continue;}
  if(!forRun)continue;
  if(controls.get(a.buttonId)?.type!=='button')error('INVALID_ACTION_BUTTON','Action requires an existing button.',{actionId:a.id});
  const fn=functions.get(a.functionId);if(!fn){error('MISSING_BOUND_FUNCTION','Choose a function.',{actionId:a.id});continue;}
  const params=new Map(getFunctionParameters(fn).map(p=>[p.name,p]));
  for(const [name,id] of Object.entries(a.inputs))if(!params.has(name)||!['text','number','checkbox','select'].includes(controls.get(id)?.type))error('INVALID_INPUT_BINDING','Binding references an unknown parameter or input control.',{actionId:a.id,controlId:id});
  for(const p of params.values())if(!own(a.inputs,p.name)&&p.required&&!own(p,'default'))error('MISSING_INPUT_BINDING','Required parameter '+p.name+' is unbound.',{actionId:a.id});
  const targets=new Set(),returns=new Map(getFunctionOutputs(fn).map(p=>[p.name,p]));
  if(!a.outputs.length)error('MISSING_OUTPUT_BINDING','Choose a result field.',{actionId:a.id});
  for(const o of a.outputs){const ctrl=controls.get(o?.controlId),field=returns.get(o?.field);if(!o||targets.has(o.controlId)||!field||o.mode==='scalar'&&(ctrl?.type!=='result'||field.type==='table')||o.mode==='table'&&(ctrl?.type!=='table'||fn.kind!=='analysis-workflow'||field.type!=='table')||!['scalar','table'].includes(o.mode))error('INVALID_OUTPUT_BINDING','Choose a compatible named return field and result control.',{actionId:a.id,controlId:o?.controlId});targets.add(o?.controlId);}
 }
 if(forRun)for(const c of form.controls)if(c.type==='button'&&!buttons.has(c.id))error('UNBOUND_BUTTON','Button has no action.',{controlId:c.id});
 return {valid:errors.length===0,errors};
}
export function executionRevision(form){return canonical({formId:form.formId,controls:form.controls.map(c=>({id:c.id,type:c.type,dataType:c.dataType,defaultValue:c.defaultValue,required:c.required,options:c.options?.map(o=>({value:o.value})),min:c.min,max:c.max})),functions:form.functions.map(f=>({id:f.id,kind:f.kind,source:f.source,entryPoint:f.entryPoint,parameters:f.parameters,returns:f.returns,reference:f.reference})),actions:form.actions});}
export function valuesRevision(values){return canonical(values);}
export function receiptMatches(form,values,receipt,jobId,buttonId){return receipt?.status==='COMPLETED'&&receipt.jobId===jobId&&receipt.buttonId===buttonId&&receipt.formId===form.formId&&receipt.executionRevision===executionRevision(form)&&receipt.valuesRevision===valuesRevision(values);}
export function createExampleForm(kind='arithmetic'){
 const form=createFormDocument(kind==='text'?'Personal greeting':'Order total');let fn,inputs,controls,field;
 if(kind==='arithmetic'){
  fn=createUiFunction({id:'example_function',name:'Calculate total',entryPoint:'calculate',source:'def calculate(quantity, price):\n    return {"total": quantity * price}',parameters:[{name:'quantity',type:'decimal',default:'2',required:true},{name:'price',type:'decimal',default:'12.50',required:true}],returns:[{name:'total',type:'decimal',nullable:false}]});
  controls=[createControl('number',{id:'quantity',label:'Quantity',defaultValue:'2',position:{x:32,y:32}}),createControl('number',{id:'price',label:'Unit price',defaultValue:'12.50',position:{x:32,y:120}})];inputs={quantity:'quantity',price:'price'};field='total';
 }else if(kind==='text'){
  fn=createUiFunction({id:'example_function',name:'Create greeting',entryPoint:'greet',source:'def greet(name, formal):\n    return {"message": ("Hello, " if formal else "Hi, ") + name}',parameters:[{name:'name',type:'string',default:'Ada',required:false},{name:'formal',type:'boolean',default:false,required:false}],returns:[{name:'message',type:'string',nullable:false}]});
  controls=[createControl('text',{id:'name',label:'Name',defaultValue:'Ada',position:{x:32,y:32}}),createControl('checkbox',{id:'formal',label:'Formal greeting',position:{x:32,y:120}})];inputs={name:'name',formal:'formal'};field='message';
 }else throw new Error('UNKNOWN_EXAMPLE_FORM');
 form.controls=[...controls,createControl('button',{id:'run',label:fn.name,position:{x:32,y:208},size:{width:240,height:48}}),createControl('result',{id:'output',label:kind==='text'?'Greeting':'Total',position:{x:32,y:280}})];form.functions=[fn];form.actions=[{id:'run_action',buttonId:'run',functionId:fn.id,inputs,outputs:[{controlId:'output',field,mode:'scalar'}]}];return form;
}
