import fs from 'node:fs';import path from 'node:path';
import {countSchema,countValues,countModel,countIfModel} from './count-fixture.mjs';
export const labels=['00120',' ALPHA ','éclair','e\u0301cole','你好','😀Z','',null];
export const leftSchema=[...countSchema,{name:'label',type:'VARCHAR'}];
export const extraNames=['first','last','middle','tag'];
export const derivedSchema=[...leftSchema,...extraNames.map(name=>({name,type:'VARCHAR'}))];
export const lookupSchema=[...derivedSchema,{name:'lookup_text',type:'VARCHAR'}];
export const rightSchema=[{name:'lookup_key',type:'VARCHAR'},{name:'lookup_value',type:'VARCHAR'}];
export const rightValues=[['00120','ACCOUNT-00120'],['120','WRONG NUMERIC KEY'],['ALPHA','WRONG TRIMMED KEY'],['éclair','Patisserie'],['ÉCLAIR','WRONG CASE'],['école','WRONG NORMALIZED KEY'],['你好','问候'],['😀Z','Emoji'],['',''],[null,'NULL MUST NOT MATCH']];
const cell=value=>value===null?'\\N':'"'+value.replaceAll('"','""')+'"';
const csv=(names,rows)=>[names,...rows].map(row=>row.map(cell).join(';')).join('\n')+'\n';
export function writeTextData(dir){
  const left=path.join(dir,"text left O'Brien Ω.csv"),right=path.join(dir,'text right Ω.csv');
  fs.writeFileSync(left,csv(leftSchema.map(c=>c.name),countValues.map((r,i)=>[...r,labels[i%8]])));
  fs.writeFileSync(right,csv(rightSchema.map(c=>c.name),rightValues));return{left,right};
}
export function expectedText(i){
  const label=labels[i%8],found=label===null?null:rightValues.find(([key])=>key!==null&&key===label)?.[1]??null;
  return{label,first:label===null?null:Array.from(label).slice(0,1).join(''),last:label===null?null:Array.from(label).slice(-1).join(''),middle:label===null?null:Array.from(label).slice(1,2).join(''),tag:'=review',lookup_text:found};
}
export function textDefinition(files){
  const data={format:'csv',delimiter:';',header:true,allVarchar:true,nullStr:'\\N'};
  const nodes=[
    {id:'source',type:'input',position:{x:20,y:20},data:{...data,label:'Text source',path:files.left}},
    {id:'typed',type:'select',position:{x:260,y:20},data:{label:'Typed text input',columns:leftSchema.map(c=>({name:c.name,alias:c.name,...(c.type==='VARCHAR'?{}:{castType:c.type})}))}},
    {id:'derived',type:'derive',position:{x:500,y:20},data:{label:'LEFT RIGHT MID and text',derivedSchema:leftSchema,derivedColumns:{version:'analysis.derived-columns/1',columns:[{alias:'first',operation:'left',source:'label',count:'1'},{alias:'last',operation:'right',source:'label',count:'1'},{alias:'middle',operation:'mid',source:'label',start:'2',count:'1'},{alias:'tag',operation:'literal',type:'VARCHAR',value:'=review'}]}}},
    {id:'filtered',type:'filter',position:{x:740,y:20},data:{label:'Filter entered text',criteriaSchema:derivedSchema,criteria:{version:'analysis.criteria/1',op:'and',rules:[{column:'tag',operator:'eq',value:'=review',nulls:'exclude'}]}}},
    {id:'right',type:'input',position:{x:740,y:300},data:{...data,label:'Text lookup keys',path:files.right}},
    {id:'lookup',type:'lookup',position:{x:980,y:100},data:{label:'Exact text Lookup',lookupSchemas:{left:derivedSchema,right:rightSchema},lookupModel:{version:'analysis.lookup/1',leftKey:'label',rightKey:'lookup_key',valueColumn:'lookup_value',alias:'lookup_text',duplicates:'error',unmatched:'null',textMatch:'binary'}}}
  ];
  const edges=[{id:'source-typed',source:'source',target:'typed'},{id:'typed-derived',source:'typed',target:'derived'},{id:'derived-filtered',source:'derived',target:'filtered'},{id:'right-first',source:'right',target:'lookup',targetHandle:'right'},{id:'left-second',source:'filtered',target:'lookup',targetHandle:'left'}];
  for(const [i,[id,model]]of [['text_count',countModel('label')],['lookup_count',countModel('lookup_text')],['text_countif',countIfModel('label','eq','00120')],['empty_countif',countIfModel('label','isEmpty')],['null_countif',countIfModel('label','isNull')],['numeric_count',countModel('num')],['bool_count',countModel('flag')]].entries()){
    nodes.push({id,type:'conditional_count',position:{x:1260+(i%2)*270,y:20+Math.floor(i/2)*180},data:{label:id,countModel:model,countSchema:lookupSchema}});edges.push({id:'lookup-'+id,source:'lookup',target:id});
  }
  return{version:'1.0.0',nodes,edges};
}
export const textCounts={text_count:'70',lookup_count:'50',text_countif:'10',empty_countif:'10',null_countif:'10',numeric_count:'64',bool_count:'80'};
