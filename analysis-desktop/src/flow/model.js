import {assertNodeViewIdentities} from '../../engine/graph-identity.js';
import {compileFilterBinding} from '../../engine/filter-binding.js';
import {compileDerivedBinding} from '../../engine/derived-binding.js';
import {compileSumBinding,compileLookupBinding,compileCountBinding} from '../../engine/conditional-binding.js';
export const operations = Object.freeze([
 {type:'input',label:'Input data',detail:'CSV or Parquet file',data:{path:'',format:'csv',header:true,delimiter:',',allVarchar:true}},
 {type:'select',label:'Select & cast',detail:'Columns, aliases and types',data:{columns:[]}},
 {type:'derive',label:'New columns',detail:'Entered text, LEFT, RIGHT and MID',data:{derivedColumns:{version:'analysis.derived-columns/1',columns:[]}}},
 {type:'filter',label:'Filter',detail:'Keep rows matching a condition',data:{condition:'TRUE'}},
 {type:'join',label:'Join',detail:'Left and right table inputs',data:{joinType:'INNER',leftKey:'id',rightKey:'id'}},
 {type:'conditional_count',label:'Count',detail:'COUNT and COUNTIF over all rows',data:{countModel:{version:'analysis.conditional-count/1',operation:'count',column:''}}},
 {type:'conditional_sum',label:'Conditional sum',detail:'SUMIF and SUMIFS over all rows',data:{sumModel:{version:'analysis.conditional-sum/1',operation:'sumifs',measure:'',criteria:{version:'analysis.criteria/1',op:'and',rules:[]}}}},
 {type:'lookup',label:'Exact Lookup',detail:'XLOOKUP-like matching with explicit policies',data:{lookupModel:{version:'analysis.lookup/1',leftKey:'',rightKey:'',valueColumn:'',alias:'lookup_value',duplicates:'error',unmatched:'null'}}},
 {type:'aggregate',label:'Aggregate',detail:'Groups and calculated measures',data:{groupBy:[],aggregations:[{expr:'COUNT(*)',alias:'row_count'}]}},
 {type:'pivot',label:'Pivot',detail:'Categories into columns',data:{rows:['id'],column:'category',measure:'amount',agg:'SUM'}},
 {type:'unpivot',label:'Unpivot',detail:'Columns into attribute/value rows',data:{columns:[],nameColumn:'attribute',valueColumn:'value'}},
 {type:'export',label:'Export output',detail:'CSV, Parquet or JSON file',data:{path:'',format:'PARQUET'}}
]);
export function createNode(type,position){const op=operations.find(o=>o.type===type);if(!op)throw Error('Operation is not implemented');return {id:'node_'+crypto.randomUUID().replaceAll('-','_'),type,position,data:{...structuredClone(op.data),label:op.label,status:'idle',isOutdated:true,preview:[],rowCount:null}};}
export function invalidateGraph(nodes){return nodes.map(n=>({...n,data:{...n.data,status:'outdated',isOutdated:true,preview:[],rowCount:null}}));}
// Display legacy two-input joins with the same fallback mapping as the existing
// compiler, while preserving the loaded definition and serialized edge arrays.
export function visibleEdges(nodes,edges){return edges.map(e=>{const target=nodes.find(n=>n.id===e.target);if(target?.type!=='join'||e.targetHandle!=null)return e;const incoming=edges.filter(x=>x.target===target.id);if(incoming.length!==2||incoming.some(x=>x.targetHandle!=null))return e;const d=target.data||{},explicit=d.leftSourceNodeId&&d.rightSourceNodeId;if(!explicit||d.leftSourceNodeId===d.rightSourceNodeId)return {...e,targetHandle:e===incoming[0]?'left':'right'};return {...e,targetHandle:e.source===d.leftSourceNodeId?'left':e.source===d.rightSourceNodeId?'right':undefined};});}
export function connectionProblem(connection,nodes,edges){
 edges=visibleEdges(nodes,edges);
 const source=nodes.find(n=>n.id===connection.source),target=nodes.find(n=>n.id===connection.target);
 if(!source||!target)return 'Choose two existing nodes.';
 if(source.id===target.id)return 'A node cannot connect to itself.';
 if(source.type==='export')return 'Export has no output port.';
 if(target.type==='input')return 'Input data has no incoming port.';
 if(['join','lookup'].includes(target.type)&&!['left','right'].includes(connection.targetHandle))return 'Choose the left or right '+(target.type==='join'?'Join':'Lookup')+' port.';
 const incoming=edges.filter(e=>e.target===target.id);
 if(incoming.some(e=>['join','lookup'].includes(target.type)?e.targetHandle===connection.targetHandle:true))return 'Disconnect the current input before replacing it.';
 const seen=new Set(),queue=[target.id];while(queue.length){const id=queue.shift();if(id===source.id)return 'This connection would create a cycle.';if(seen.has(id))continue;seen.add(id);for(const e of edges)if(e.source===id)queue.push(e.target);}
 return null;
}
export function validateGraph(nodes,edges){
 edges=visibleEdges(nodes,edges);
 if(!nodes.length)throw Error('Add an input and at least one operation.');
 assertNodeViewIdentities(nodes);
 for(const n of nodes)if(!operations.some(o=>o.type===n.type))throw Error('Unsupported operation: '+n.type);
 const admitted=[];for(const e of edges){const issue=connectionProblem(e,nodes,admitted);if(issue)throw Error(issue);admitted.push(e);}
 for(const n of nodes){
  const incoming=edges.filter(e=>e.target===n.id),expected=n.type==='input'?0:['join','lookup'].includes(n.type)?2:1;if(incoming.length!==expected)throw Error((n.data.label||n.type)+' needs '+expected+' connected input'+(expected===1?'':'s')+'.');
  if(n.type==='join'&&(n.data.leftSourceNodeId!==undefined||n.data.rightSourceNodeId!==undefined)){
   if(n.data.leftSourceNodeId!==incoming.find(e=>e.targetHandle==='left')?.source||n.data.rightSourceNodeId!==incoming.find(e=>e.targetHandle==='right')?.source)throw Error('Join source configuration differs from its visible ports. Reconnect the inputs explicitly.');
  }
  if(n.type==='filter')compileFilterBinding(n.data);
  if(n.type==='derive')compileDerivedBinding(n.data);
  if(n.type==='conditional_count')compileCountBinding(n.data);
  if(n.type==='conditional_sum')compileSumBinding(n.data);
  if(n.type==='lookup')compileLookupBinding(n.data);
  if(n.type==='select')for(const c of n.data.columns||[]){if(!c.name?.trim())throw Error('Each selected column needs a source name.');if(c.castType&&!/^(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|VARCHAR|BOOLEAN|DATE|TIMESTAMP|DECIMAL\(\d+,\s*\d+\)|NUMERIC\(\d+,\s*\d+\))$/i.test(c.castType.trim()))throw Error('Choose a valid DuckDB cast type.');}
 }
 return true;
}
