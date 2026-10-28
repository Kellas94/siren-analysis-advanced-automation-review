import fs from 'node:fs';
export const countSchema=[
  {name:'id',type:'INTEGER'},{name:'numeric_text',type:'VARCHAR'},{name:'num',type:'DECIMAL(38,10)'},{name:'big',type:'BIGINT'},
  {name:'u64',type:'UBIGINT'},{name:'u128',type:'UHUGEINT'},{name:'s128',type:'HUGEINT'},{name:'floating',type:'DOUBLE'},
  {name:'text',type:'VARCHAR'},{name:'flag',type:'BOOLEAN'},{name:'quoted"amount',type:'BIGINT'}
];
export const countValues=Array.from({length:80},(_,i)=>[
  String(i),'00120',['0.0000000000','1.2500000000',null,'-2.5000000000','3.0000000000'][i%5],i%7===0?null:'9007199254740993',
  '18446744073709551615','340282366920938463463374607431768211455','-170141183460469231731687303715884105728',i%6===0?null:'1.5',
  [null,'','=SUM(A1:A2)','KEEP'][i%4],i%3===0?'true':'false','0'
]);
export function writeCountData(file){
  const cell=value=>value===null?'\\N':'"'+value.replaceAll('"','""')+'"';
  fs.writeFileSync(file,[countSchema.map(c=>cell(c.name)).join(';'),...countValues.map(row=>row.map(cell).join(';'))].join('\n')+'\n');
}
export function countModel(column='num'){return{version:'analysis.conditional-count/1',operation:'count',column};}
export function countIfModel(column,operator,value,options={}){
  const rule={column,operator};if(!['isNull','isNotNull'].includes(operator)){rule.nulls=options.nulls??'exclude';if(['in','notIn'].includes(operator))rule.values=value;else if(!['isEmpty','isNotEmpty'].includes(operator))rule.value=value;}
  return{version:'analysis.conditional-count/1',operation:'countif',criteria:{version:'analysis.criteria/1',op:'and',rules:[rule]}};
}
export function countDefinition(file,model=countModel(),schema=countSchema,{empty=false}={}){
  const nodes=[{id:'source',type:'input',position:{x:30,y:80},data:{label:'Count source',path:file,format:'csv',delimiter:';',header:true,allVarchar:true,nullStr:'\\N'}},
    {id:'typed',type:'select',position:{x:300,y:80},data:{label:'Typed count input',columns:countSchema.map(c=>({name:c.name,alias:c.name,castType:c.type}))}}];
  const edges=[{id:'source-typed',source:'source',target:'typed'}];
  if(empty){nodes.push({id:'empty',type:'filter',position:{x:560,y:80},data:{label:'Empty input',condition:'FALSE'}});edges.push({id:'typed-empty',source:'typed',target:'empty'});}
  nodes.push({id:'counted',type:'conditional_count',position:{x:empty?820:560,y:80},data:{label:'Count result',countModel:model,countSchema:structuredClone(schema)}});
  edges.push({id:'input-counted',source:empty?'empty':'typed',target:'counted'});return{version:'1.0.0',nodes,edges};
}
