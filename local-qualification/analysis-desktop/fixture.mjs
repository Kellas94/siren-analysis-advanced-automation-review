export const columns=['identifier','big_value','decimal_value','safe_decimal','zero','nullable_decimal','empty','literal','numeric_text'];
export const declared=['VARCHAR','BIGINT','DECIMAL(38,10)','DECIMAL(18,10)','INTEGER','DECIMAL(38,10)','VARCHAR','VARCHAR','VARCHAR'];
export const maxDecimal='9'.repeat(28)+'.'+'9'.repeat(10);
export const inputRows=[
 ['00120','9007199254740993',maxDecimal,'1.2500000000','0',null,'','=SUM(A1:A2)','42'],
 ['00000','-9007199254740993','-'+maxDecimal,'-1.2500000000','0','12345678901234567890.0000000001','','=1+1','1.20'],
 ['42','9223372036854775807','12345678901234567890.1234567890','0.0000000000','0',null,'','=0','00120'],
 ['1.20','-9223372036854775808','-12345678901234567890.1234567890','2.5000000000','0',null,'','<img src=x onerror="window.__typedUnexpected=true">','42'],
 ['0','0','0.0000000000','0.5000000000','0',null,'','=literal','0'],
 ['00001',null,null,null,'0',null,'','=NA','00042'],
 ['','42','1.0000000000',null,'0',null,'','NA','1.20'],
 ['overflow','9223372036854775808','1'+'0'.repeat(28)+'.'+'0'.repeat(10),'not-a-number','0','not-a-decimal','','=last','42']
];
const csvCell=v=>v===null?'NA':'"'+String(v).replaceAll('"','""')+'"';
export const csvText=()=>columns.join(';')+'\n'+inputRows.map(row=>row.map(csvCell).join(';')).join('\n')+'\n';
export function workflow(file,{badWidth=false}={}){
 const input={id:'input',type:'input',position:{x:70,y:120},data:{label:'Raw exact text',path:file,format:'csv',header:true,delimiter:';',allVarchar:true,nullStr:'NA'}};
 const select={id:'typed',type:'select',position:{x:370,y:120},data:{label:'Typed TRY_CAST result',columns:columns.map((name,i)=>({name,alias:name,...(declared[i]!=='VARCHAR'?{castType:badWidth&&i===2?'DECIMAL(39,10)':declared[i]}:{})}))}};
 return {nodes:[input,select],edges:[{id:'input-typed',source:'input',target:'typed'}]};
}
