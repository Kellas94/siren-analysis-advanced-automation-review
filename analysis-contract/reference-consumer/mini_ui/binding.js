import {validateForm,getFunctionParameters,clone,executionRevision,valuesRevision,canonical} from './form_model.js';
import {validateDocument} from '../src/model/validator.js';
import {assertExactJsonNumbers} from '../src/model/value_integrity.js';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=(code,message)=>{throw Object.assign(new Error(code+': '+message),{code});};
export function coerceValue(value,type,{required=true}={}){
 if(value===undefined||value===null){if(required)fail('REQUIRED_INPUT','A value is required.');return null;}
 if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))fail('NON_EXACT_INPUT_NUMBER','Use an exact integer or decimal string.');
 if(type==='string'){if(typeof value!=='string')fail('INVALID_STRING','Expected text.');if(required&&!value.length)fail('REQUIRED_INPUT','Text is required.');if(value.length>65536)fail('INPUT_LIMIT_EXCEEDED','Text exceeds 65536 characters.');return value;}
 if(type==='boolean'){if(typeof value!=='boolean')fail('INVALID_BOOLEAN','Expected a boolean value.');return value;}
 const text=typeof value==='string'?value.trim():String(value);
 if(!text)fail('EMPTY_NUMERIC_INPUT','An empty value is not zero.');
 if(text.length>512)fail('INPUT_LIMIT_EXCEEDED','Numeric value exceeds supported length.');
 if(type==='integer'){if(!/^[+-]?\d+$/.test(text))fail('INVALID_INTEGER','Enter a whole number.');return BigInt(text).toString();}
 if(type==='decimal'){if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))fail('INVALID_DECIMAL','Enter a plain decimal value.');return text;}
 if(type==='number'){if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))fail('INVALID_NUMBER','Enter a finite number.');const number=Number(text);if(!Number.isFinite(number)||Number.isInteger(number)&&!Number.isSafeInteger(number))fail('NON_EXACT_INPUT_NUMBER','Use an exact integer or decimal field.');return number;}
 fail('UNSUPPORTED_PARAMETER_TYPE','Unsupported input type '+type);
}
function decimalParts(value){let s=String(value),negative=s.startsWith('-');s=s.replace(/^[+-]/,'');let [whole,fraction='']=s.split('.');return {coefficient:BigInt((negative?'-':'')+(whole||'0')+fraction),scale:fraction.length};}
function compare(a,b,type){if(type==='integer'){a=BigInt(a);b=BigInt(coerceValue(b,type));return a<b?-1:a>b?1:0;}if(type==='decimal'){a=decimalParts(a);b=decimalParts(coerceValue(b,type));const scale=Math.max(a.scale,b.scale),x=a.coefficient*10n**BigInt(scale-a.scale),y=b.coefficient*10n**BigInt(scale-b.scale);return x<y?-1:x>y?1:0;}return a<b?-1:a>b?1:0;}
function controlValue(c,values){
 const raw=own(values,c.id)?values[c.id]:c.defaultValue,value=coerceValue(raw,c.dataType,{required:c.required!==false});
 if(value===null)return value;
 if(c.type==='select'&&!c.options.some(o=>canonical(coerceValue(o.value,c.dataType,{required:false}))===canonical(value)))fail('INVALID_SELECT_VALUE','Choose an available option.');
 if(['integer','decimal','number'].includes(c.dataType)){if(c.min!==undefined&&compare(value,c.min,c.dataType)<0)fail('INPUT_BELOW_MINIMUM',c.label);if(c.max!==undefined&&compare(value,c.max,c.dataType)>0)fail('INPUT_ABOVE_MAXIMUM',c.label);}
 return value;
}
export function prepareAction(form,buttonId,values={}){
 assertExactJsonNumbers(form);assertExactJsonNumbers(values);
 const structure=validateForm(form);if(!structure.valid)fail('INVALID_FORM',structure.errors.map(e=>e.message).join('; '));
 if(!values||typeof values!=='object'||Array.isArray(values))fail('INVALID_INPUT_VALUES','Input values must be a map.');
 const selected=form.actions.filter(a=>a.buttonId===buttonId);if(selected.length!==1)fail('INVALID_ACTION_BINDING','Choose a button with exactly one action.');
 const action=selected[0],fn=form.functions.find(f=>f.id===action.functionId);
 const specific=validateForm({...form,controls:form.controls.filter(c=>c.type!=='button'||c.id===buttonId),actions:[action]},{forRun:true});
 if(!specific.valid)fail('INVALID_ACTION_BINDING',specific.errors.map(e=>e.message).join('; '));
 const workflow=clone(fn.document),validation=validateDocument(workflow);if(!validation.valid)fail('INVALID_BOUND_WORKFLOW',validation.errors.map(e=>e.message).join('; '));
 const controls=new Map(form.controls.map(c=>[c.id,c])),parameters=Object.create(null),capturedValues=clone(values);
 for(const param of getFunctionParameters(fn)){
  const controlId=action.inputs[param.name];
  if(controlId!==undefined){const ctrl=controls.get(controlId);if(ctrl.dataType!==param.type)fail('BINDING_TYPE_MISMATCH','Parameter '+param.name+' requires '+param.type);parameters[param.name]=controlValue(ctrl,values);}
  else if(own(param,'default'))parameters[param.name]=coerceValue(param.default,param.type,{required:param.required});
  else if(param.required)fail('MISSING_INPUT_BINDING',param.name);else parameters[param.name]=null;
 }
 return {formId:form.formId,buttonId,action:clone(action),document:workflow,parameterValues:parameters,executionRevision:executionRevision(form),valuesRevision:valuesRevision(capturedValues)};
}
export function projectOutputs(execution,prepared){
 if(execution.status!=='COMPLETED')fail('COMPLETED_EXECUTION_REQUIRED','Outputs require a completed execution.');
 const entries=prepared.action.outputs.map(binding=>{
  const metric=execution.summary?.metrics?.[binding.nodeId];if(!metric||!Array.isArray(metric.preview)||!Array.isArray(metric.previewSchema))fail('TYPED_RESULT_REQUIRED','The selected node has no typed result.');
  const count=metric.row_count;if(!Number.isSafeInteger(count)||count<0||metric.preview.length>count||metric.preview.length>50)fail('INVALID_RESULT_COVERAGE','Result row coverage is invalid.');
  if(binding.mode==='table')return [binding.controlId,{kind:'table',rows:clone(metric.preview),schema:clone(metric.previewSchema),rowCount:count,returnedRows:metric.preview.length,coverage:count===metric.preview.length?'complete':'preview'}];
  if(count!==1||metric.preview.length!==1)fail('SCALAR_RESULT_REQUIRES_ONE_ROW','Scalar result must have exactly one row.');
  const schema=metric.previewSchema.find(c=>c.name===binding.column);if(!schema||!own(metric.preview[0],binding.column))fail('RESULT_COLUMN_MISSING','Selected result column does not exist.');
  return [binding.controlId,{kind:'scalar',value:clone(metric.preview[0][binding.column]),column:binding.column,schema:clone(schema),rowCount:1}];
 });return Object.fromEntries(entries);
}
