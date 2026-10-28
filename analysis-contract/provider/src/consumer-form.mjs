import {createFormDocument,createControl,validateForm} from '../vb-model-copy/mini_ui/ui_form_model.js';
import {createBinding,checkReference,fail,canonical} from './contract.mjs';
export function uiParameter(name,schema,required){
 const type=schema['x-wire']==='decimal'?'decimal':schema['x-wire']==='int64'?'integer':schema.type;
 if(!['string','number','integer','decimal','boolean'].includes(type)||schema.nullable)fail('UNSUPPORTED_BINDING_TYPE','UI model cannot bind '+name+' yet; no coercion/fallback');
 return {name,type,required,...(Object.hasOwn(schema,'default')?{default:schema.default}:{})};
}
export function formFromCapability(catalog,entry){
 const reference=createBinding(catalog,entry);checkReference(catalog,reference);
 const params=Object.entries(entry.parameters.properties).map(([name,s])=>uiParameter(name,s,(entry.parameters.required||[]).includes(name)));
 const form=createFormDocument(entry.title),inputs={};
 for(const [index,p] of params.entries()){
  const schema=entry.parameters.properties[p.name],id='parameter_'+index;inputs[p.name]=id;
  const type=schema.enum?'select':p.type==='boolean'?'checkbox':['decimal','integer','number'].includes(p.type)?'number':'text';
  form.controls.push(createControl(type,{id,label:p.name,dataType:p.type,required:p.required,position:{x:24,y:24+index*80},...(Object.hasOwn(p,'default')?{defaultValue:p.default}:{}),...(schema.enum?{options:schema.enum.map(value=>({label:String(value),value}))}:{})}));
 }
 form.controls.push(createControl('button',{id:'run',label:entry.title,position:{x:320,y:24}}),createControl('table',{id:'output',label:'Analysis result',position:{x:320,y:110}}));
 form.functions=[{id:'analysis_reference',name:entry.title,kind:'analysis-workflow',reference,parameters:params,returns:[{name:'result',type:'table',nullable:false}]}];
 form.actions=[{id:'analysis_action',buttonId:'run',functionId:'analysis_reference',inputs,outputs:[{controlId:'output',field:'result',mode:'table'}]}];
 const checked=validateForm(form,{forRun:true});if(!checked.valid)fail('INVALID_FORM',canonical(checked.errors));return form;
}
