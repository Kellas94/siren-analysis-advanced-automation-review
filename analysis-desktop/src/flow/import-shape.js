// Render-shape admission only. Execution/DAG/typed-operation policies remain
// with their existing validators, including recoverable structured drafts.
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(path,expected)=>{throw new TypeError(`Invalid workflow format: ${path} must be ${expected}.`);};
const text=(value,path)=>{if(value!==undefined&&value!==null&&typeof value!=='string')fail(path,'text or omitted');};
const list=(value,path,entry)=>{
  if(value===undefined||value===null)return;
  if(!Array.isArray(value))fail(path,'an array or omitted');
  for(let i=0;i<value.length;i++)entry(value[i],`${path}[${i}]`);
};
const name=(value,path)=>{if(typeof value!=='string')fail(path,'text');};
const scalar=(value,path)=>{if(value!==null&&!['string','number','boolean'].includes(typeof value))fail(path,'a text, numeric, Boolean or null value');};
const fields=(value,path,names)=>{for(const key of names)text(value[key],`${path}.${key}`);};
const entries=(keys)=>(value,path)=>{if(!record(value))fail(path,'a parameter record');fields(value,path,keys);};

export function assertWorkflowImportShapes(parsed){
  if(!record(parsed)||!Array.isArray(parsed.nodes)||!Array.isArray(parsed.edges))fail('workflow','a nodes/edges definition');
  for(let i=0;i<parsed.nodes.length;i++){
    const node=parsed.nodes[i],where=`nodes[${i}]`;
    if(!record(node))fail(where,'a node record');
    text(node.type,where+'.type');
    if(node.position!==undefined){
      if(!record(node.position))fail(where+'.position','a position record or omitted');
      for(const key of ['x','y'])if(node.position[key]!==undefined&&
        (typeof node.position[key]!=='number'||!Number.isFinite(node.position[key])))fail(where+'.position.'+key,'a finite number or omitted');
    }
    if(node.data!==undefined&&!record(node.data))fail(where+'.data','a parameter record or omitted');
    const data=node.data||{},at=where+'.data';text(data.label,at+'.label');
    if(node.type==='input'||node.type==='export')fields(data,at,['format','path']);
    if(node.type==='select')list(data.columns,at+'.columns',entries(['name','alias','castType']));
    if(node.type==='filter'&&data.criteria===undefined)text(data.condition,at+'.condition');
    if(node.type==='join')fields(data,at,['joinType','leftKey','rightKey','leftSourceNodeId','rightSourceNodeId']);
    if(node.type==='aggregate'){
      list(data.groupBy,at+'.groupBy',name);
      list(data.aggregations,at+'.aggregations',entries(['expr','alias']));
    }
    if(node.type==='pivot'){
      fields(data,at,['column','measure','agg','filterCondition']);
      list(data.rows,at+'.rows',name);list(data.inCategories,at+'.inCategories',scalar);
    }
    if(node.type==='unpivot'){
      fields(data,at,['nameColumn','valueColumn']);list(data.columns,at+'.columns',name);
    }
  }
  for(let i=0;i<parsed.edges.length;i++){
    const edge=parsed.edges[i],where=`edges[${i}]`;
    if(!record(edge))fail(where,'a connection record');
    if(typeof edge.source!=='string'||!edge.source||typeof edge.target!=='string'||!edge.target)fail(where,'a connection with text source and target IDs');
    fields(edge,where,['id','type','sourceHandle','targetHandle']);
    if(edge.label!==undefined)scalar(edge.label,where+'.label');
    if(edge.style!==undefined&&edge.style!==null&&!record(edge.style))fail(where+'.style','a style record or omitted');
    if(edge.data!==undefined&&edge.data!==null&&!record(edge.data))fail(where+'.data','a parameter record or omitted');
  }
}
