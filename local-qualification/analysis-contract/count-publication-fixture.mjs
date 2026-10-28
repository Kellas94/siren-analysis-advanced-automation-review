import {textDefinition,writeTextData,lookupSchema} from './text-fixture.mjs';
import {countModel,countIfModel} from './count-fixture.mjs';
export {writeTextData,lookupSchema};
export function publication(files,kind='count',version='1.0.0'){
 const whole=textDefinition(files),definition={...whole,nodes:whole.nodes.filter(n=>n.type!=='conditional_count'),edges:whole.edges.filter(e=>e.source!=='lookup')};
 const scalar=kind!=='lookup';let model,properties={},bindings=[],title;
 if(kind==='count'){model=countModel('label');title='Count actual text values';}
 else if(kind==='text'){model=countIfModel('label','eq','00120');properties={criterion:{type:'string',minLength:0,maxLength:256,default:'00120',description:'Exact text, including empty text; no numeric conversion'}};title='Count rows matching text';}
 else if(kind==='boolean'){model=countIfModel('flag','eq',false);properties={criterion:{type:'boolean',default:false}};title='Count rows matching Boolean';}
 else if(kind==='numeric'){model=countIfModel('id','gte','60');properties={criterion:{type:'integer',default:60,minimum:0,maximum:1000000}};title='Count rows at or above ID';}
 else if(kind==='lookup'){title='Inspect actual typed text Lookup';}
 else throw Error('Unknown finite fixture');
 if(scalar){definition.nodes.push({id:'count',type:'conditional_count',position:{x:1240,y:100},data:{label:title,countModel:model,countSchema:structuredClone(lookupSchema)}});definition.edges.push({id:'lookup-count',source:'lookup',target:'count'});}
 if(Object.keys(properties).length)bindings=[{kind:'criterion-value',nodeId:'count',parameter:'criterion',ruleIndex:0}];
 return{id:'analysis.shared-count.'+kind,version,title,description:kind==='count'?'Non-NULL text values including empty text, with full source provenance':'Existing Analysis workflow with explicit typed parameters; no UI data engine',parameterSchema:{type:'object',properties,required:[],additionalProperties:false},definition,bindings,outputNodeId:scalar?'count':'lookup',units:scalar?{conditional_count:kind==='count'?'values':'rows'}:{}};
}
