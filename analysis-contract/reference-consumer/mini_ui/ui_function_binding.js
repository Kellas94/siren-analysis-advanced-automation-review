import {validateForm,getFunctionParameters,clone,executionRevision,valuesRevision} from './ui_form_model.js';
import {controlValue,coerceValue} from './ui_values.js';
import {assertExactJsonNumbers} from '../src/model/value_integrity.js';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function fail(code,message){throw Object.assign(new Error(code+': '+message),{code});}
export function prepareUiAction(form,buttonId,values={}){
 assertExactJsonNumbers(form);assertExactJsonNumbers(values);
 const shape=validateForm(form);if(!shape.valid)fail('INVALID_FORM',shape.errors.map(e=>e.message).join('; '));
 if(!values||typeof values!=='object'||Array.isArray(values))fail('INVALID_INPUT_VALUES','Values must be a map.');
 const actions=form.actions.filter(a=>a.buttonId===buttonId);if(actions.length!==1)fail('INVALID_ACTION_BINDING','Choose a button with one action.');
 const action=actions[0],fn=form.functions.find(f=>f.id===action.functionId);
 const validation=validateForm({...form,controls:form.controls.filter(c=>c.type!=='button'||c.id===buttonId),actions:[action]},{forRun:true});
 if(!validation.valid)fail('INVALID_ACTION_BINDING',validation.errors.map(e=>e.message).join('; '));
 const controls=new Map(form.controls.map(c=>[c.id,c])),parameterValues=Object.create(null);
 for(const p of getFunctionParameters(fn)){
  if(own(action.inputs,p.name)){const ctrl=controls.get(action.inputs[p.name]);if(ctrl.dataType!==p.type)fail('BINDING_TYPE_MISMATCH','Parameter '+p.name+' requires '+p.type);parameterValues[p.name]=controlValue(ctrl,values);}
  else if(own(p,'default'))parameterValues[p.name]=coerceValue(p.default,p.type,{required:p.required});
  else if(p.required)fail('MISSING_INPUT_BINDING',p.name);else if(fn.kind!=='analysis-workflow')parameterValues[p.name]=null;
 }
 return {formId:form.formId,buttonId,action:clone(action),function:clone(fn),parameterValues,executionRevision:executionRevision(form),valuesRevision:valuesRevision(clone(values))};
}
export function projectUiOutputs(result,prepared){
 if(!result||typeof result!=='object'||Array.isArray(result))fail('INVALID_UI_FUNCTION_RESULT','Function must return an object with declared fields.');
 const returns=new Map(prepared.function.returns.map(f=>[f.name,f]));
 return Object.fromEntries(prepared.action.outputs.map(binding=>{if(binding.mode!=='scalar')fail('ANALYSIS_PROVIDER_REQUIRED','Table results must come from the Analysis contract.');if(!own(result,binding.field))fail('RESULT_FIELD_MISSING',binding.field);return [binding.controlId,{kind:'scalar',value:clone(result[binding.field]),field:binding.field,schema:clone(returns.get(binding.field)),rowCount:1}];}));
}
