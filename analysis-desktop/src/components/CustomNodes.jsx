import React from 'react';
import { Handle, Position } from '@xyflow/react';
import {compileFilterBinding} from '../../engine/filter-binding.js';
import {compileDerivedBinding} from '../../engine/derived-binding.js';
import {compileSumBinding,compileLookupBinding,compileCountBinding} from '../../engine/conditional-binding.js';

function getStatusBadge(status) {
  switch (status) {
    case 'running':
      return { text: 'RUNNING', bg: '#3B82F6', cl: '#FFFFFF' };
    case 'completed':
      return { text: 'DONE', bg: '#10B981', cl: '#FFFFFF' };
    case 'failed':
      return { text: 'ERROR', bg: '#EF4444', cl: '#FFFFFF' };
    case 'outdated':
      return { text: 'OUTDATED', bg: '#F59E0B', cl: '#FFFFFF' };
    default:
      return { text: 'IDLE', bg: '#64748B', cl: '#FFFFFF' };
  }
}

export function WorkflowNode({ id, data, selected, title, icon, color, showInput = true, showOutput = true, inputPorts = null, inputPortLabel="Join", children }) {
  const badge = getStatusBadge(data.status);

  return (
    <div
      style={{
        minWidth: 220,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        border: selected ? `2px solid ${color}` : '1px solid #CBD5E1',
        boxShadow: selected ? `0 0 0 2px ${color}33, 0 4px 6px -1px rgba(0,0,0,0.1)` : '0 1px 3px rgba(0,0,0,0.08)',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        overflow: 'visible',
        transition: 'all 0.15s ease'
      }}
    >
      {showInput && !inputPorts && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ width: 10, height: 10, backgroundColor: color, border: '2px solid #FFFFFF' }}
        />
      )}
      {inputPorts&&inputPorts.map((port,index)=><React.Fragment key={port}><Handle id={port} type="target" position={Position.Left} aria-label={inputPortLabel+' '+port+' input'} style={{top:index===0?'40%':'75%',width:10,height:10,backgroundColor:color,border:'2px solid #FFFFFF'}}/><span className="flow-port-label" style={{top:index===0?'40%':'75%',left:-28,transform:'translateY(-50%)'}}>{port==='left'?'Left':'Right'}</span></React.Fragment>)}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          backgroundColor: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontWeight: 600, fontSize: 12, color: '#1E293B' }}>{data.label || title}</span>
        </div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 4,
            backgroundColor: badge.bg,
            color: badge.cl
          }}
        >
          {badge.text}
        </span>
      </div>

      {/* Body Content */}
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#475569' }}>
        {children}
        {data.rowCount !== undefined && data.rowCount !== null && (
          <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px dashed #E2E8F0', fontSize: 10, color: '#64748B' }}>
            Rows: <strong style={{ color: '#0F172A' }}>{data.rowCount.toLocaleString()}</strong>
          </div>
        )}
      </div>

      {showOutput && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ width: 10, height: 10, backgroundColor: color, border: '2px solid #FFFFFF' }}
        />
      )}
    </div>
  );
}

export function InputNode(props) {
  const { data } = props;
  return (
    <WorkflowNode {...props} title="Input Data" icon="📥" color="#2563EB" showInput={false}>
      <div>Format: <strong>{(data.format || 'parquet').toUpperCase()}</strong></div>
      <div style={{ wordBreak: 'break-all', fontSize: 10, color: '#64748B', marginTop: 2 }}>
        {data.path ? data.path.split(/[/\\\\]/).pop() : 'No file selected'}
      </div>
    </WorkflowNode>
  );
}

export function SelectNode(props) {
  const { data } = props;
  const colCount = (data.columns || []).length;
  return (
    <WorkflowNode {...props} title="Select & Cast" icon="✂️" color="#7C3AED">
      <div>Columns: <strong>{colCount > 0 ? `${colCount} configured` : 'Pass-through (*)'}</strong></div>
    </WorkflowNode>
  );
}

export function FilterNode(props) {
  const { data } = props;
  let summary=data.condition||'TRUE';
  if(data.criteria!==undefined){
    try{compileFilterBinding(data);summary=`Criteria: ${data.criteria.rules.length} rules · ${data.criteria.op.toUpperCase()}`;}
    catch{summary='Criteria need attention';}
  }
  return (
    <WorkflowNode {...props} title="Filter" icon="🔍" color="#D97706">
      <div style={{ fontFamily: 'monospace', fontSize: 10, backgroundColor: '#F1F5F9', padding: '2px 4px', borderRadius: 4, wordBreak: 'break-all' }}>
        {summary}
      </div>
    </WorkflowNode>
  );
}

export function DerivedNode(props){
  let summary='New columns need attention';
  try{compileDerivedBinding(props.data);summary=`${props.data.derivedColumns.columns.length} new columns · originals kept`;}catch{}
  return <WorkflowNode {...props} title="New columns" icon="ƒ" color="#7C3AED"><div>{summary}</div></WorkflowNode>;
}

export function ConditionalCountNode(props){
  let summary='Count needs attention';try{compileCountBinding(props.data);summary=props.data.countModel.operation.toUpperCase()+' · one aggregate result';}catch{}
  return <WorkflowNode {...props} title="Count" icon="#" color="#0284C7"><div>{summary}</div></WorkflowNode>;
}

export function ConditionalSumNode(props){
  let summary='Conditional sum needs attention';try{compileSumBinding(props.data);summary=props.data.sumModel.operation.toUpperCase()+' · one aggregate result';}catch{}
  return <WorkflowNode {...props} title="Conditional sum" icon="ΣIF" color="#0284C7"><div>{summary}</div></WorkflowNode>;
}
export function LookupNode(props){
  let summary='Lookup needs attention';try{compileLookupBinding(props.data);summary='Exact key → '+props.data.lookupModel.alias;}catch{}
  return <WorkflowNode {...props} title="Exact Lookup" icon="⌕" color="#059669" inputPorts={['left','right']} inputPortLabel="Lookup"><div>{summary}</div></WorkflowNode>;
}

export function JoinNode(props) {
  const { data } = props;
  return (
    <WorkflowNode {...props} title="Join" icon="🔗" color="#059669" inputPorts={['left','right']}>
      <div>Type: <strong>{data.joinType || 'INNER'}</strong></div>
      <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
        Key: <code style={{ color: '#0F172A' }}>{data.leftKey || 'id'} = {data.rightKey || 'id'}</code>
      </div>
    </WorkflowNode>
  );
}

export function AggregateNode(props) {
  const { data } = props;
  const groupDims = (data.groupBy || []).join(', ') || '(All rows)';
  return (
    <WorkflowNode {...props} title="Aggregate" icon="∑" color="#0284C7">
      <div>Group: <strong>{groupDims}</strong></div>
      <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
        Metrics: {(data.aggregations || []).length || 1} calculated
      </div>
    </WorkflowNode>
  );
}

export function PivotNode(props) {
  const { data } = props;
  return (
    <WorkflowNode {...props} title="Pivot" icon="🔀" color="#9333EA">
      <div>Col: <strong>{data.column || 'category'}</strong></div>
      <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
        Measure: {data.agg || 'SUM'}({data.measure || 'amount'})
      </div>
    </WorkflowNode>
  );
}

export function UnpivotNode(props) {
  const { data } = props;
  return (
    <WorkflowNode {...props} title="Unpivot" icon="🔄" color="#EA580C">
      <div>Cols: <strong>{(data.columns || []).length} columns</strong></div>
    </WorkflowNode>
  );
}

export function ExportNode(props) {
  const { data } = props;
  return (
    <WorkflowNode {...props} title="Export Output" icon="📤" color="#16A34A" showOutput={false}>
      <div>Format: <strong>{(data.format || 'PARQUET').toUpperCase()}</strong></div>
      <div style={{ wordBreak: 'break-all', fontSize: 10, color: '#64748B', marginTop: 2 }}>
        {data.path ? data.path.split(/[/\\\\]/).pop() : 'export.parquet'}
      </div>
    </WorkflowNode>
  );
}

export const nodeTypes = {
  input: InputNode,
  select: SelectNode,
  filter: FilterNode,
  derive: DerivedNode,
  conditional_sum: ConditionalSumNode,
  conditional_count: ConditionalCountNode,
  lookup: LookupNode,
  join: JoinNode,
  aggregate: AggregateNode,
  pivot: PivotNode,
  unpivot: UnpivotNode,
  export: ExportNode
};
