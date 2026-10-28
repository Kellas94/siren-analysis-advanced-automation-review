export const leftNames=['left_input','id','amount','big','status','empty','literal'],leftTypes=['VARCHAR','INTEGER','DECIMAL(38,10)','BIGINT','VARCHAR','VARCHAR','VARCHAR'];
export const rightNames=['right_input','input_data','decimal Ω,"','returned_bool'],rightTypes=['VARCHAR','BIGINT','DECIMAL(38,10)','BOOLEAN'];
export const keys=i=>({0:'00120',1:'1.20',2:'0',3:'',4:null,5:'Ω"key',6:'e\u0301key',7:'ékey',8:'ALPHA',9:'alpha'})[i]??(i===4?null:'K'+String(i).padStart(5,'0'));
export const matchIds=[0,1,2,3,6,8,9,79],bigValues=['9007199254740993','-9007199254740993','0','42','9223372036854775807','1','2','-9223372036854775808'];
export const decimalValues=['9999999999999999999999999999.1234567890','-1.2500000000','0.0000000000','1.2500000000','2.5000000000','3.5000000000','4.5000000000','5.5000000000'];
const q=s=>s===null?'NA':'"'+String(s).replaceAll('"','""')+'"';
export function leftCSV(big='9007199254740993'){return [leftNames.map(q).join(';'),...Array.from({length:80},(_,i)=>[keys(i),i,i+'.0000000001',big,i%3===0?'KEEP':'SKIP','','=SUM(A1:A2)'].map(q).join(';'))].join('\n')+'\n';}
export function rightRows(duplicate=false){const rows=matchIds.map((i,j)=>[keys(i),bigValues[j],decimalValues[j],j%2===0?'false':'true']);rows.push(['unrelated','3','3.0000000000','false'],['unrelated','4','4.0000000000','true'],[null,'5','5.0000000000','false'],[null,'6','6.0000000000','true']);if(duplicate)rows.push([...rows[7]]);return rows;}
export function rightCSV(duplicate=false){return [rightNames,...rightRows(duplicate)].map(r=>r.map(q).join(';')).join('\n')+'\n';}
export const lookupModel={version:'analysis.lookup/1',leftKey:'left_input',rightKey:'right_input',valueColumn:'input_data',alias:'lookup_value',duplicates:'error',unmatched:'null',textMatch:'binary'};
export const criteria=(two=false)=>({version:'analysis.criteria/1',op:'and',rules:[{column:'status',operator:'eq',value:'KEEP',nulls:'exclude'},...(two?[{column:'id',operator:'gte',value:'60',nulls:'exclude'}]:[])]});
export function makeDefinition(left,right,csv,configured=true){const a=leftNames.map((name,i)=>({name,type:leftTypes[i]})),b=rightNames.map((name,i)=>({name,type:rightTypes[i]}));return {version:'1.0.0',nodes:[
 {id:'left_source',type:'input',position:{x:30,y:50},data:{label:'Left source80',path:left,format:'csv',header:true,delimiter:';',allVarchar:true,nullStr:'NA'}},
 {id:'left_typed',type:'select',position:{x:330,y:50},data:{label:'Typed left table',columns:leftNames.map((name,i)=>({name,alias:name,...([1,2,3].includes(i)?{castType:leftTypes[i]}:{})}))}},
 {id:'right_source',type:'input',position:{x:30,y:340},data:{label:'Right mapping12',path:right,format:'csv',header:true,delimiter:';',allVarchar:true,nullStr:'NA'}},
 {id:'right_typed',type:'select',position:{x:330,y:340},data:{label:'Typed right table',columns:rightNames.map((name,i)=>({name,alias:name,...(i>0?{castType:rightTypes[i]}:{})}))}},
 {id:'lookup',type:'lookup',position:{x:650,y:160},data:{label:'Exact Lookup',lookupModel:configured?structuredClone(lookupModel):{version:'analysis.lookup/1',leftKey:'',rightKey:'',valueColumn:'',alias:'lookup_value',duplicates:'error',unmatched:'null'},...(configured?{lookupSchemas:{left:a,right:b}}:{})}},
 {id:'sum',type:'conditional_sum',position:{x:960,y:90},data:{label:'Conditional sum',sumModel:configured?{version:'analysis.conditional-sum/1',operation:'sumif',measure:'big',criteria:criteria(false)}:{version:'analysis.conditional-sum/1',operation:'sumifs',measure:'',criteria:{version:'analysis.criteria/1',op:'and',rules:[]}},...(configured?{sumSchema:[...a,{name:'lookup_value',type:'BIGINT'}]}:{})}},
 {id:'csv',type:'export',position:{x:960,y:330},data:{label:'Export full Lookup',path:csv,format:'CSV'}}],edges:[{id:'a',source:'left_source',target:'left_typed'},{id:'b',source:'right_source',target:'right_typed'},{id:'right-first',source:'right_typed',target:'lookup',targetHandle:'right'},{id:'left-second',source:'left_typed',target:'lookup',targetHandle:'left'},{id:'c',source:'lookup',target:'sum'},{id:'d',source:'lookup',target:'csv'}]};}
export function expectedLookup(i,column='input_data'){const j=matchIds.indexOf(i),value=j<0?null:column==='input_data'?bigValues[j]:column===rightNames[2]?decimalValues[j]:j%2===1;return {left_input:keys(i),id:i,amount:i+'.0000000001',big:'9007199254740993',status:i%3===0?'KEEP':'SKIP',empty:'',literal:'=SUM(A1:A2)',lookup_value:value};}
export function parseCSV(text){
  const records=[];let row=[],value='',quoted=false,inQuote=false;
  const field=()=>{row.push(quoted?value:value===''?null:value);value='';quoted=false;};
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(inQuote&&text[i+1]==='"'){value+='"';i++;}else if(!inQuote&&value.length)throw Error('Unexpected quote');else{inQuote=!inQuote;quoted=true;}}else if(!inQuote&&(c===','||c==='\n')){field();if(c==='\n'){records.push(row);row=[];}}else if(!inQuote&&c==='\r'&&text[i+1]==='\n'){}else value+=c;}
  if(inQuote)throw Error('Unterminated quote');if(row.length||value.length||quoted){field();records.push(row);}return records;
}
