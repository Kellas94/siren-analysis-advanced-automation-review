import {getNodeSchema} from './schema.js';
const refuse=reason=>({status:'unavailable',reason,columns:[],rows:[]});
export function getNodeTable(context){
  const schema=getNodeSchema(context);if(schema.status!=='available')return {...schema,rows:[]};
  const data=context.nodes.find(n=>n.id===context.nodeId).data,rows=data.preview,total=data.rowCount;
  if(!Number.isSafeInteger(total)||total<0||!Array.isArray(rows)||rows.length!==Math.min(total,50))return refuse('This output has no complete bounded preview. Run again to capture it.');
  const names=schema.columns.map(c=>c.name);
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==names.length)return refuse('The preview does not match its schema.');
    for(const c of schema.columns){
      if(!Object.hasOwn(row,c.name))return refuse('The preview does not match its schema.');
      const value=row[c.name];
      if(value!==null&&!['string','number','boolean'].includes(typeof value))return refuse('This preview contains a value the table cannot display safely.');
      if(typeof value==='number'&&!Number.isFinite(value))return refuse('This preview contains an invalid numeric value.');
      if(value!==null&&/^(?:U?BIGINT|U?HUGEINT|DECIMAL\(|NUMERIC\()/i.test(c.type)&&typeof value!=='string')return refuse('The preview does not preserve its exact numeric representation.');
    }
  }
  return {...schema,rows,total,visible:rows.length,executedNodes:context.capture.definition.nodes.length,definitionNodes:context.nodes.length};
}
