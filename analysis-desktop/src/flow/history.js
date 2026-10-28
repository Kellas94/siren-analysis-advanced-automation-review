// Authoring state only. Runtime previews/jobs are never history or saved content.
const transient=new Set(['status','preview','rowCount','isOutdated']);
const clone=v=>JSON.parse(JSON.stringify(v));
export const canonical=v=>JSON.stringify(sort(v));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,sort(v[k])])):v;}
export function definition(nodes,edges){return clone({nodes:nodes.map(n=>({id:n.id,type:n.type,position:n.position,data:Object.fromEntries(Object.entries(n.data||{}).filter(([k])=>!transient.has(k)))})),edges:edges.map(({selected,...e})=>e)});}
export function semanticKey(d){return canonical({nodes:d.nodes.map(n=>({id:n.id,type:n.type,data:Object.fromEntries(Object.entries(n.data||{}).filter(([k])=>k!=='label'))})),edges:d.edges});}
export function restoreDefinition(d,currentNodes){
 // Caller decides invalidation using both actual edge arrays; this helper never
 // resurrects previews from a snapshot, because snapshots contain no previews.
 const live=new Map(currentNodes.map(n=>[n.id,n]));
 return d.nodes.map(n=>({...live.get(n.id),...clone(n),data:{...Object.fromEntries(Object.entries(live.get(n.id)?.data||{}).filter(([k])=>transient.has(k))),...clone(n.data)}}));
}
export class DefinitionHistory {
 constructor(d,{saved=false,path=null,limit=100}={}){this.limit=limit;this.view=0;this.operation=0;this.reset(d,{saved,path});}
 reset(d,{saved=true,path=null}={}){this.view++;this.operation++;this.current=clone(d);this.baseline=saved?clone(d):null;this.path=path;this.past=[];this.future=[];this.group=null;this.phase=saved?'loaded':'idle';this.error=null;}
 record(d,{group=null}={}){if(canonical(d)===canonical(this.current))return false;if(!group||group!==this.group){this.past.push(clone(this.current));if(this.past.length>this.limit)this.past.shift();}this.current=clone(d);this.future=[];this.group=group;return true;}
 undo(){if(!this.past.length)return null;this.future.push(clone(this.current));this.current=this.past.pop();this.group=null;return clone(this.current);}
 redo(){if(!this.future.length)return null;this.past.push(clone(this.current));this.current=this.future.pop();this.group=null;return clone(this.current);}
 get dirty(){return !this.baseline||canonical(this.current)!==canonical(this.baseline);}
 captureSave(){this.phase='saving';this.error=null;return {view:this.view,operation:++this.operation,definition:clone(this.current)};}
 finishSave(token,receipt){
  if(token.view!==this.view||token.operation!==this.operation)return false;
  if(receipt?.error){this.phase='failed';this.error=String(receipt.error);}
  else if(receipt?.canceled===true){this.phase='cancelled';}
  else if(receipt?.canceled===false&&typeof receipt.filePath==='string'&&receipt.filePath){this.baseline=clone(token.definition);this.path=receipt.filePath;this.phase='saved';this.error=null;}
  else{this.phase='unknown';this.error='File write was not confirmed.';}
  return true;
 }
}
