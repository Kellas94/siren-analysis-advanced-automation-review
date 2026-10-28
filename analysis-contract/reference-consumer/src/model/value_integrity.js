export function assertExactJsonNumbers(value, location='$', seen=new Set()) {
  if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))throw new Error('NON_EXACT_MODEL_NUMBER at '+location+'; use an exact typed string for large integers.');
  if(typeof value==='bigint')throw new Error('NON_JSON_MODEL_BIGINT at '+location+'; use an exact typed string.');
  if(value&&typeof value==='object'){
    if(seen.has(value))throw new Error('CYCLIC_MODEL_VALUE at '+location);
    seen.add(value);for(const [k,v] of Object.entries(value))assertExactJsonNumbers(v,location+'.'+k,seen);seen.delete(value);
  }
}
