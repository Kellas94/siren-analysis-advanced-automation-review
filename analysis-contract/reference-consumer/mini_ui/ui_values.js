import {canonical} from './ui_form_model.js';
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
export function controlValue(c,values){
 const raw=own(values,c.id)?values[c.id]:c.defaultValue,value=coerceValue(raw,c.dataType,{required:c.required!==false});
 if(value===null)return value;
 if(c.type==='select'&&!c.options.some(o=>canonical(coerceValue(o.value,c.dataType,{required:false}))===canonical(value)))fail('INVALID_SELECT_VALUE','Choose an available option.');
 if(['integer','decimal','number'].includes(c.dataType)){if(c.min!==undefined&&compare(value,c.min,c.dataType)<0)fail('INPUT_BELOW_MINIMUM',c.label);if(c.max!==undefined&&compare(value,c.max,c.dataType)>0)fail('INPUT_ABOVE_MAXIMUM',c.label);}
 return value;
}
