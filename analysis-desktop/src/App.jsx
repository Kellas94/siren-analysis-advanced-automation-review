import {assertNodeViewIdentities} from '../engine/graph-identity.js';
import {assertWorkflowImportShapes} from './flow/import-shape.js';
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {flushSync} from 'react-dom';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './components/CustomNodes.jsx';
import { transportClient, isDesktopEnvironment } from './transport/client.js';

import {WorkflowHistogramPanel} from './components/WorkflowHistogramPanel.jsx';
import {ResultHistory} from './components/ResultHistory.jsx';
import {SavedJournalHistory} from './components/SavedJournalHistory.jsx';
import {FlowLibrary,FlowConnections} from './flow/FlowLibrary.jsx';
import {NodeEditor} from './flow/NodeEditor.jsx';
import {getSelectSchema,sameColumnName} from './flow/schema.js';
import {getNodeTable} from './flow/table.js';
import {TableInspector} from './flow/TableInspector.jsx';
import {columnLetter} from './flow/table-coordinates.js';
import {executionPrefix} from './flow/run-prefix.js';
import {getJoinSchemas,joinInputsPrefix} from './flow/join-schema.js';
import {getFilterSchema,filterInputPrefix} from './flow/filter-schema.js';
import {getDerivedSchema,derivedInputPrefix} from './flow/derived-schema.js';
import {getSumSchema,sumInputPrefix,getCountSchema,countInputPrefix,getLookupSchemas,lookupInputsPrefix} from './flow/functions-schema.js';
import {createNode,invalidateGraph,connectionProblem,validateGraph,visibleEdges} from './flow/model.js';
import './flow/flow.css';
import {DefinitionHistory,definition,semanticKey,restoreDefinition} from './flow/history.js';
import {DefinitionConfirm} from './flow/DefinitionConfirm.jsx';

// Admit render-safe structure before any replacement state changes. Partial
// workflows remain editable; execution validates the complete graph later.
function prepareWorkflowImport(parsed) {
  if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) {
    throw new Error('Invalid workflow format: missing nodes or edges array');
  }
  assertWorkflowImportShapes(parsed);
  assertNodeViewIdentities(parsed.nodes);
  return definition(parsed.nodes,parsed.edges);
}

// Drop malformed/foreign observations before they can latch a terminal state.
// This is renderer shape admission, not the shared analytical wire validator.
function isWorkflowPollFrame(value, jobId) {
  const record = item => item !== null && typeof item === 'object' && !Array.isArray(item);
  const number = item => typeof item === 'number' && Number.isFinite(item) && item >= 0;
  if (!record(value) || value.jobId !== jobId || !['queued','running','completed','cancelled','failed'].includes(value.status)) return false;
  if (value.progress != null) {
    if (!record(value.progress)) return false;
    if (value.progress.percent != null && (!number(value.progress.percent) || value.progress.percent > 100)) return false;
    if (value.progress.stepName != null && typeof value.progress.stepName !== 'string') return false;
  }
  if (value.status === 'failed' && value.error != null && typeof value.error !== 'string') return false;
  if (value.status !== 'completed') return true;
  if (value.error != null) return false;
  if (value.pipelineDef != null) {
    try { assertWorkflowImportShapes(value.pipelineDef); } catch { return false; }
  }
  if (value.generatedSQL != null && (!Array.isArray(value.generatedSQL) || value.generatedSQL.some(step => !record(step) || typeof step.sql !== 'string'))) return false;
  if (value.telemetry != null && (!record(value.telemetry) || ['durationMs','peakRssMB','tempDiskSpillBytes'].some(key => value.telemetry[key] != null && !number(value.telemetry[key])))) return false;
  if (value.nodeOutputs != null) {
    if (!record(value.nodeOutputs)) return false;
    for (const output of Object.values(value.nodeOutputs)) {
      if (!record(output)) return false;
      if (output.rowCount != null && (!Number.isSafeInteger(output.rowCount) || output.rowCount < 0)) return false;
      if (output.preview != null && (!Array.isArray(output.preview) || output.preview.some(row => !record(row)))) return false;
      if (output.schema != null && (!Array.isArray(output.schema) || output.schema.some(column => !record(column) || typeof column.name !== 'string' || typeof column.type !== 'string'))) return false;
    }
  }
  return true;
}

// Default Workflow: Alteryx-style Pipeline
const initialNodes = [
  {
    id: 'node_1_in_tx',
    type: 'input',
    position: { x: 50, y: 120 },
    data: {
      label: 'Input Transactions (CSV)',
      format: 'csv',
      path: 'correctness_transactions.csv',
      header: true,
      status: 'idle',
      rowCount: null,
      preview: []
    }
  },
  {
    id: 'node_2_sel_tx',
    type: 'select',
    position: { x: 330, y: 120 },
    data: {
      label: 'Select & Cast Types',
      status: 'idle',
      columns: [
        { name: 'trans_id', alias: 'tx_id', castType: 'BIGINT' },
        { name: 'cust_code', alias: 'customer_code' },
        { name: 'amount', alias: 'tx_amount', castType: 'DECIMAL(12,2)' },
        { name: 'raw_date', alias: 'tx_date', castType: 'DATE' },
        { name: 'status', alias: 'tx_status' }
      ],
      rowCount: null,
      preview: []
    }
  },
  {
    id: 'node_3_filt_valid',
    type: 'filter',
    position: { x: 610, y: 120 },
    data: {
      label: 'Filter Valid Rows',
      condition: "tx_status != 'REJECTED' AND tx_amount IS NOT NULL",
      status: 'idle',
      rowCount: null,
      preview: []
    }
  },
  {
    id: 'node_4_in_cust',
    type: 'input',
    position: { x: 50, y: 320 },
    data: {
      label: 'Input Customers (CSV)',
      format: 'csv',
      path: 'correctness_customers.csv',
      header: true,
      status: 'idle',
      rowCount: null,
      preview: []
    }
  },
  {
    id: 'node_5_join_cust',
    type: 'join',
    position: { x: 890, y: 200 },
    data: {
      label: 'Join Customer Dimension',
      joinType: 'INNER',
      leftKey: 'customer_code',
      rightKey: 'cust_code',
      status: 'idle',
      rowCount: null,
      preview: []
    }
  },
  {
    id: 'node_6_agg_tier',
    type: 'aggregate',
    position: { x: 1170, y: 200 },
    data: {
      label: 'Aggregate by Tier',
      groupBy: ['tier', 'tx_status'],
      aggregations: [
        { expr: 'COUNT(*)', alias: 'tx_count' },
        { expr: 'SUM(tx_amount)', alias: 'total_tier_amount' },
        { expr: 'ROUND(AVG(tx_amount), 2)', alias: 'avg_tier_amount' }
      ],
      status: 'idle',
      rowCount: null,
      preview: []
    }
  },
  {
    id: 'node_7_pivot_tier',
    type: 'pivot',
    position: { x: 1450, y: 200 },
    data: {
      label: 'Pivot Tier & Status',
      rows: ['tier'],
      column: 'tx_status',
      measure: 'total_tier_amount',
      agg: 'SUM',
      inCategories: ['COMPLETED', 'SHIPPED', 'PENDING'],
      status: 'idle',
      rowCount: null,
      preview: []
    }
  },
  {
    id: 'node_8_export_parquet',
    type: 'export',
    position: { x: 1730, y: 200 },
    data: {
      label: 'Export Result (Parquet)',
      format: 'PARQUET',
      path: 'data/final_analysis_output.parquet',
      status: 'idle',
      rowCount: null,
      preview: []
    }
  }
];

const initialEdges = [
  { id: 'e1-2', source: 'node_1_in_tx', target: 'node_2_sel_tx' },
  { id: 'e2-3', source: 'node_2_sel_tx', target: 'node_3_filt_valid' },
  { id: 'e3-5', source: 'node_3_filt_valid', target: 'node_5_join_cust', targetHandle: 'left' },
  { id: 'e4-5', source: 'node_4_in_cust', target: 'node_5_join_cust', targetHandle: 'right' },
  { id: 'e5-6', source: 'node_5_join_cust', target: 'node_6_agg_tier' },
  { id: 'e6-7', source: 'node_6_agg_tier', target: 'node_7_pivot_tier' },
  { id: 'e7-8', source: 'node_7_pivot_tier', target: 'node_8_export_parquet' }
];

export default function App() {
  const [nodes, setNodes, applyNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, applyEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState('node_7_pivot_tier');
  const [activeJobId, setActiveJobId] = useState(null);
  const [workflowStatus, setWorkflowStatus] = useState('idle'); // idle | queued | running | completed | cancelled | failed
  const [statusMessage, setStatusMessage] = useState('Workflow ready. Engine: DuckDB v2.0.0 (Native Worker Process)');
  const [progressPercent, setProgressPercent] = useState(0);
  const [telemetry, setTelemetry] = useState({
    durationMs: 0,
    peakRssMB: 0,
    tempSpillMB: 0,
    totalRowsProcessed: 0
  });
  const [alertBanner, applyAlertBanner] = useState(null);
  const [capturedSQL,setCapturedSQL] = useState(null);
  const [schemaRun,setSchemaRun] = useState(null);
  const [inspection,setInspection]=useState(null);
  const schemaRunRef=useRef(null);schemaRunRef.current=schemaRun;
  const authoredSeqRef=useRef(0);
  const flowRef = useRef(null);

  // Execution concurrency & stale polling protection
  const executionSeqRef = useRef(0);
  const pollingIntervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeJobRef = useRef(null);
  const viewSeqRef = useRef(0);
  const loadSeqRef = useRef(0);
  const draftSeqRef = useRef(0);
  const saveSeqRef = useRef(0);
  const exportSeqRef = useRef(0);
  const alertSeqRef = useRef(0);
  const selectedNodeRef = useRef('node_7_pivot_tier');
  const [,refreshHistory]=useState(0);
  const historyRef=useRef(null);
  if(!historyRef.current)historyRef.current=new DefinitionHistory(definition(initialNodes,initialEdges));
  const graphRef=useRef({nodes,edges});graphRef.current={nodes,edges};
  const dragGroupRef=useRef(null);
  const draftFieldsRef=useRef(new Set());
  const [pendingFields,setPendingFields]=useState(0);
  const [editorEpoch,setEditorEpoch]=useState(0);
  const [definitionConfirm,setDefinitionConfirm]=useState(null);
  const closeRequestRef=useRef(null);
  const closingWindowRef=useRef(false);
  const [closingWindow,setClosingWindow]=useState(false);
  const [closeCleanupFailed,setCloseCleanupFailed]=useState(false);
  const sourcePickSeqRef=useRef(0);
  const sourcePickPendingRef=useRef(null);
  const [sourcePickPending,setSourcePickPending]=useState(null);
  const noteParameterDraft=useCallback(({id,dirty}={})=>{
    draftSeqRef.current++;exportSeqRef.current++;
    if(id){if(dirty)draftFieldsRef.current.add(id);else draftFieldsRef.current.delete(id);}
    setPendingFields(draftFieldsRef.current.size);
  },[]);
  const recordGraph=useCallback((nextNodes,nextEdges,options)=>{
    authoredSeqRef.current++;
    historyRef.current.record(definition(nextNodes,nextEdges),options);
    graphRef.current={nodes:nextNodes,edges:nextEdges};setNodes(nextNodes);setEdges(nextEdges);refreshHistory(n=>n+1);
  },[setNodes,setEdges]);
  const restoreGraph=useCallback(d=>{
    authoredSeqRef.current++;
    const current=graphRef.current;
    const changed=semanticKey(d)!==semanticKey(definition(current.nodes,current.edges));
    const restored=restoreDefinition(d,current.nodes);
    const nextNodes=changed?invalidateGraph(restored):restored;
    draftSeqRef.current++;exportSeqRef.current++;dragGroupRef.current=null;
    graphRef.current={nodes:nextNodes,edges:d.edges};setNodes(nextNodes);setEdges(d.edges);
    if(!nextNodes.some(n=>n.id===selectedNodeRef.current)){
      selectedNodeRef.current=nextNodes[0]?.id??null;setSelectedNodeId(selectedNodeRef.current);
    }
    setEditorEpoch(n=>n+1);refreshHistory(n=>n+1);
  },[setNodes,setEdges]);
  const moveHistory=useCallback(direction=>{
    if(draftFieldsRef.current.size)return;
    const d=historyRef.current[direction]();if(d)restoreGraph(d);
  },[restoreGraph]);
  const definitionDirty=historyRef.current.dirty||pendingFields>0;
  useEffect(()=>{
    const handle=e=>{
      if(e.defaultPrevented||e.isComposing||e.keyCode===229||e.which===229||e.altKey||!(e.ctrlKey||e.metaKey)||document.querySelector('dialog[open]')||e.target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]'))return;
      const key=e.key.toLowerCase();if(key==='z'||key==='y'){e.preventDefault();moveHistory(key==='y'||e.shiftKey?'redo':'undo');}
    };
    window.addEventListener('keydown',handle);return ()=>window.removeEventListener('keydown',handle);
  },[moveHistory]);

  const clearPolling = useCallback((owner) => {
    const poll = pollingIntervalRef.current;
    if (poll && (owner === undefined || poll.owner === owner)) {
      clearInterval(poll.id);
      pollingIntervalRef.current = null;
    }
  }, []);

  const setAlertBanner = useCallback((banner) => {
    alertSeqRef.current++;
    applyAlertBanner(banner);
  }, []);

  const dismissAlertAfter = useCallback((delay) => {
    const owner = alertSeqRef.current;
    setTimeout(() => {
      if (alertSeqRef.current === owner) setAlertBanner(null);
    }, delay);
  }, [setAlertBanner]);

  // Retired submissions can still resolve. Release their job, never the current one.
  const retireJob = useCallback((jobId) => {
    if (!jobId || jobId === activeJobRef.current) return;
    Promise.resolve().then(() => transportClient.cancelJob(jobId)).catch(() => {});
  }, []);

  const cancelWindowClose=useCallback(()=>{
    const request=closeRequestRef.current;if(!request||closingWindowRef.current)return;
    closeRequestRef.current=null;setDefinitionConfirm(null);
    window.sirenDesktop.respondToClose({requestId:request.requestId,decision:'cancel'}).catch(error=>setAlertBanner({type:'error',text:'Close cancellation was not confirmed: '+error.message}));
  },[setAlertBanner]);
  const approveWindowClose=useCallback(async()=>{
    const request=closeRequestRef.current;if(!request||closingWindowRef.current)return;
    if(request.view!==viewSeqRef.current){cancelWindowClose();setAlertBanner({type:'warning',text:'The workflow changed while closing. Review it and close again.'});return;}
    if(historyRef.current.phase==='saving')return;
    // Commit a native modal shield before handing permission to the host. There
    // must be no fresh editing interval while asynchronous cleanup is pending.
    closingWindowRef.current=true;
    // Retire outstanding Open/export/poll responses before the host can stop
    // their services. Cancelling the confirmation never takes this branch.
    viewSeqRef.current++;loadSeqRef.current++;saveSeqRef.current++;
    exportSeqRef.current++;executionSeqRef.current++;clearPolling();
    flushSync(()=>{setClosingWindow(true);setDefinitionConfirm({kind:'close'});});
    try{
      const receipt=await window.sirenDesktop.respondToClose({requestId:request.requestId,decision:'proceed'});
      if(!['closing','closed'].includes(receipt?.status))throw Error(receipt?.error||'Close request was not admitted.');
    }catch(error){
      closingWindowRef.current=false;closeRequestRef.current=null;setClosingWindow(false);setDefinitionConfirm(null);
      setCloseCleanupFailed(true);activeJobRef.current=null;setActiveJobId(null);
      const staleNodes=invalidateGraph(graphRef.current.nodes);
      graphRef.current={...graphRef.current,nodes:staleNodes};setNodes(staleNodes);
      setWorkflowStatus('unknown');
      setStatusMessage('Close cleanup was not confirmed. Save the workflow and restart before running again.');
      setAlertBanner({type:'error',text:'The window remains open, but work may have stopped. Save the workflow and restart before running again: '+error.message});
    }
  },[cancelWindowClose,clearPolling,setAlertBanner,setNodes]);
  useEffect(()=>{
    const api=window.sirenDesktop;if(typeof api?.onCloseRequested!=='function'||typeof api.respondToClose!=='function')return;
    return api.onCloseRequested(request=>{
      if(!request||typeof request.requestId!=='string'||closingWindowRef.current)return;
      if(closeRequestRef.current?.requestId===request.requestId)return;
      closeRequestRef.current={requestId:request.requestId,view:viewSeqRef.current};
      if(historyRef.current.dirty||draftFieldsRef.current.size||historyRef.current.phase==='saving')setDefinitionConfirm({kind:'close'});
      else approveWindowClose();
    });
  },[approveWindowClose]);

  useEffect(() => {
    return () => {
      executionSeqRef.current++;
      viewSeqRef.current++;
      loadSeqRef.current++;
      clearPolling();
      const retired = activeJobRef.current;
      activeJobRef.current = null;
      retireJob(retired);
    };
  }, [clearPolling, retireJob]);

  const onNodesChange = useCallback((changes) => {
    if (changes.some(c => ['position', 'add', 'remove', 'replace'].includes(c.type))) draftSeqRef.current++;
    const semantic=changes.some(c=>['add','remove','replace'].includes(c.type));
    if(semantic){
      exportSeqRef.current++;
      const removed=new Set(changes.filter(c=>c.type==='remove').map(c=>c.id));
      if(removed.has(selectedNodeRef.current)){selectedNodeRef.current=null;setSelectedNodeId(null);}
      const current=graphRef.current;
      recordGraph(invalidateGraph(applyNodeChanges(changes,current.nodes)),current.edges.filter(e=>!removed.has(e.source)&&!removed.has(e.target)));
    }else if(changes.some(c=>c.type==='position')){
      const current=graphRef.current;recordGraph(applyNodeChanges(changes,current.nodes),current.edges,{group:dragGroupRef.current});
    }else applyNodesChange(changes);
  }, [applyNodesChange,recordGraph]);

  const onEdgesChange = useCallback((changes) => {
    if (changes.some(c => ['add', 'remove', 'replace'].includes(c.type))) {
      draftSeqRef.current++;
      exportSeqRef.current++;
      const current=graphRef.current;recordGraph(invalidateGraph(current.nodes),applyEdgeChanges(changes,current.edges));
      return;
    }
    applyEdgesChange(changes);
  }, [applyEdgesChange,recordGraph]);

  // Cycle prevention on edge connection
  const isValidConnection = useCallback(
    (connection) => {
      return !connectionProblem(connection,nodes,edges);
    },
    [nodes,edges]
  );

  const onConnect = useCallback(
    (params) => {
      const current=graphRef.current;
      const issue=connectionProblem(params,current.nodes,current.edges);
      if(issue){setAlertBanner({type:'error',text:issue});return false;}
      draftSeqRef.current++;
      exportSeqRef.current++;
      recordGraph(invalidateGraph(current.nodes.map(n=>n.id===params.target&&n.type==='join'?{...n,data:{...n.data,leftSourceNodeId:undefined,rightSourceNodeId:undefined}}:n)),addEdge({...params,id:'edge_'+crypto.randomUUID()},current.edges));
      return true;
    },
    [recordGraph,setAlertBanner]
  );

  const renderedEdges=useMemo(()=>visibleEdges(nodes,edges),[nodes,edges]);
  const addOperation=useCallback((type,position)=>{
    const selected=nodes.find(n=>n.id===selectedNodeRef.current);
    const node=createNode(type,position||{x:(selected?.position?.x??0)+300,y:selected?.position?.y??80});
    draftSeqRef.current++;exportSeqRef.current++;selectedNodeRef.current=node.id;setSelectedNodeId(node.id);
    const current=graphRef.current;
    recordGraph([...invalidateGraph(current.nodes.map(n=>({...n,selected:false}))),{...node,selected:true}],current.edges);
    flowRef.current?.fitView({padding:.15,maxZoom:1});
  },[nodes,recordGraph]);
  const removeOperation=useCallback(id=>onNodesChange([{type:'remove',id}]),[onNodesChange]);
  const disconnect=useCallback(id=>onEdgesChange([{type:'remove',id}]),[onEdgesChange]);

  const onNodeClick = useCallback((event, node) => {
    setInspection(null);
    selectedNodeRef.current = node.id;
    setSelectedNodeId(node.id);
  }, []);

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // Downstream invalidation when node parameters change
  const invalidateDownstreamNodes = useCallback((modifiedNodeId, newNodes) => {
    // Find all reachable downstream nodes using BFS
    const adj = new Map();
    for (const e of graphRef.current.edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source).push(e.target);
    }

    const affected = new Set([modifiedNodeId]);
    const queue = [modifiedNodeId];
    while (queue.length > 0) {
      const u = queue.shift();
      const children = adj.get(u) || [];
      for (const v of children) {
        if (!affected.has(v)) {
          affected.add(v);
          queue.push(v);
        }
      }
    }

    return newNodes.map((n) => {
      if (affected.has(n.id)) {
        return {
          ...n,
          data: {
            ...n.data,
            status: 'outdated',
            isOutdated: true,
            preview: [],
            rowCount: null
          }
        };
      }
      return n;
    });
  }, [edges]);

  // Update selected node parameter and invalidate downstream
  const updateNodeData = useCallback((nodeId, patch) => {
    draftSeqRef.current++;
    if(!Object.keys(patch).every(key=>key==='label'))exportSeqRef.current++;
    const currentNodes=graphRef.current.nodes;
      const updatedNodes = currentNodes.map((n) => {
        if (n.id === nodeId) {
          return {
            ...n,
            data: {
              ...n.data,
              ...patch
            }
          };
        }
        return n;
      });
      recordGraph(Object.keys(patch).every(key=>key==='label')?updatedNodes:invalidateDownstreamNodes(nodeId, updatedNodes),graphRef.current.edges);
  }, [invalidateDownstreamNodes, recordGraph]);

  const sourceSchema=getSelectSchema({nodes,edges,nodeId:selectedNode?.id,capture:schemaRun,view:viewSeqRef.current});
  if(sourceSchema.token)sourceSchema.token={...sourceSchema.token,edit:authoredSeqRef.current};
  const joinSchemas=getJoinSchemas({nodes,edges,nodeId:selectedNode?.id,capture:schemaRun,view:viewSeqRef.current});
  if(joinSchemas.token)joinSchemas.token={...joinSchemas.token,edit:authoredSeqRef.current};
  const chooseJoinKey=(nodeId,side,name,token)=>{
    if(closingWindowRef.current||closeCleanupFailed||selectedNodeRef.current!==nodeId||!['left','right'].includes(side))return;
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before choosing a Join key.'});return;}
    const current=getJoinSchemas({...graphRef.current,nodeId,capture:schemaRunRef.current,view:viewSeqRef.current});
    if(!token||token.edit!==authoredSeqRef.current||current.status!=='available'||['jobId','view','nodeId','key'].some(k=>token[k]!==current.token[k])||!current[side].columns.some(c=>c.name===name)){
      setAlertBanner({type:'warning',text:'The Join input changed. Review both input schemas and choose again.'});return;
    }
    const property=side==='left'?'leftKey':'rightKey',node=graphRef.current.nodes.find(n=>n.id===nodeId);
    if(node.data[property]===name)return;
    updateNodeData(nodeId,{[property]:name});
  };
  const filterSchema=getFilterSchema({nodes,edges,nodeId:selectedNode?.id,capture:schemaRun,view:viewSeqRef.current});
  if(filterSchema.token)filterSchema.token={...filterSchema.token,edit:authoredSeqRef.current};
  const editCriteria=(nodeId,model,token)=>{
    if(closingWindowRef.current||closeCleanupFailed||selectedNodeRef.current!==nodeId)return false;
    // A Field commits on blur after clearing its own pending marker. Competing
    // drafts still prevent schema-bound edits.
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before changing criteria.'});return false;}
    const current=getFilterSchema({...graphRef.current,nodeId,capture:schemaRunRef.current,view:viewSeqRef.current});
    if(!token||token.edit!==authoredSeqRef.current||current.status!=='available'||['jobId','view','nodeId','upstreamId','key'].some(k=>token[k]!==current.token[k])){
      setAlertBanner({type:'warning',text:'The Filter input changed. Run Filter input and review the rules.'});return false;
    }
    updateNodeData(nodeId,{criteria:model,criteriaSchema:current.columns.map(c=>({...c}))});
    return true;
  };
  const useFilterSQL=nodeId=>{
    if(closingWindowRef.current||closeCleanupFailed||draftFieldsRef.current.size||selectedNodeRef.current!==nodeId||graphRef.current.nodes.find(n=>n.id===nodeId)?.type!=='filter')return;
    updateNodeData(nodeId,{criteria:undefined,criteriaSchema:undefined});
  };
  const derivedSchema=getDerivedSchema({nodes,edges,nodeId:selectedNode?.id,capture:schemaRun,view:viewSeqRef.current});
  if(derivedSchema.token)derivedSchema.token={...derivedSchema.token,edit:authoredSeqRef.current};
  const editDerived=(nodeId,model,token)=>{
    if(closingWindowRef.current||closeCleanupFailed||selectedNodeRef.current!==nodeId)return false;
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before changing new columns.'});return false;}
    const current=getDerivedSchema({...graphRef.current,nodeId,capture:schemaRunRef.current,view:viewSeqRef.current});
    if(!token||token.edit!==authoredSeqRef.current||current.status!=='available'||['jobId','view','nodeId','upstreamId','key'].some(k=>token[k]!==current.token[k])){
      setAlertBanner({type:'warning',text:'The input changed. Run New columns input and review the definitions.'});return false;
    }
    updateNodeData(nodeId,{derivedColumns:model,derivedSchema:current.columns.map(c=>({...c}))});return true;
  };
  const countSchema=getCountSchema({nodes,edges,nodeId:selectedNode?.id,capture:schemaRun,view:viewSeqRef.current});
  if(countSchema.token)countSchema.token={...countSchema.token,edit:authoredSeqRef.current};
  const sumSchema=getSumSchema({nodes,edges,nodeId:selectedNode?.id,capture:schemaRun,view:viewSeqRef.current});
  if(sumSchema.token)sumSchema.token={...sumSchema.token,edit:authoredSeqRef.current};
  const lookupSchemas=getLookupSchemas({nodes,edges,nodeId:selectedNode?.id,capture:schemaRun,view:viewSeqRef.current});
  if(lookupSchemas.token)lookupSchemas.token={...lookupSchemas.token,edit:authoredSeqRef.current};
  const editSum=(nodeId,model,token)=>{
    if(closingWindowRef.current||closeCleanupFailed||selectedNodeRef.current!==nodeId)return false;
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before changing the conditional sum.'});return false;}
    const current=getSumSchema({...graphRef.current,nodeId,capture:schemaRunRef.current,view:viewSeqRef.current});
    if(!token||token.edit!==authoredSeqRef.current||current.status!=='available'||['jobId','view','nodeId','upstreamId','key'].some(k=>token[k]!==current.token[k])){setAlertBanner({type:'warning',text:'The sum input changed. Run its input and review the definition.'});return false;}
    updateNodeData(nodeId,{sumModel:model,sumSchema:current.columns.map(c=>({...c}))});return true;
  };
  const editCount=(nodeId,model,token)=>{
    if(closingWindowRef.current||closeCleanupFailed||selectedNodeRef.current!==nodeId)return false;
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before changing the count.'});return false;}
    const current=getCountSchema({...graphRef.current,nodeId,capture:schemaRunRef.current,view:viewSeqRef.current});
    if(!token||token.edit!==authoredSeqRef.current||current.status!=='available'||['jobId','view','nodeId','upstreamId','key'].some(k=>token[k]!==current.token[k])){setAlertBanner({type:'warning',text:'The count input changed. Run its input and review the definition.'});return false;}
    updateNodeData(nodeId,{countModel:model,countSchema:current.columns.map(c=>({...c}))});return true;
  };
  const editLookup=(nodeId,model,token)=>{
    if(closingWindowRef.current||closeCleanupFailed||selectedNodeRef.current!==nodeId)return false;
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before changing Lookup.'});return false;}
    const current=getLookupSchemas({...graphRef.current,nodeId,capture:schemaRunRef.current,view:viewSeqRef.current});
    if(!token||token.edit!==authoredSeqRef.current||current.status!=='available'||['jobId','view','nodeId','key'].some(k=>token[k]!==current.token[k])){setAlertBanner({type:'warning',text:'The Lookup inputs changed. Run both inputs and review the definition.'});return false;}
    updateNodeData(nodeId,{lookupModel:model,lookupSchemas:{left:current.left.columns.map(c=>({...c})),right:current.right.columns.map(c=>({...c}))}});return true;
  };
  const addSchemaColumn=(nodeId,name,token)=>{
    if(closingWindowRef.current||closeCleanupFailed||selectedNodeRef.current!==nodeId)return;
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before adding a column.'});return;}
    const current=graphRef.current;
    const admitted=getSelectSchema({...current,nodeId,capture:schemaRunRef.current,view:viewSeqRef.current});
    if(!token||token.edit!==authoredSeqRef.current||admitted.status!=='available'||
       ['jobId','view','upstreamId','key'].some(k=>token[k]!==admitted.token[k])||!admitted.columns.some(c=>c.name===name)){
      setAlertBanner({type:'warning',text:'The column choice changed. Review the upstream schema and choose again.'});return;
    }
    const columns=current.nodes.find(n=>n.id===nodeId).data.columns||[];
    if(columns.some(c=>sameColumnName(c.alias||c.name,name))){setAlertBanner({type:'warning',text:'That output name is already selected. Edit its alias before adding it again.'});return;}
    updateNodeData(nodeId,{columns:[...columns,{name,alias:name}]});
  };

  const handleChooseSource=async nodeId=>{
    if(sourcePickPendingRef.current||closingWindowRef.current)return;
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before choosing a source.'});return;}
    const node=graphRef.current.nodes.find(n=>n.id===nodeId);
    if(!node||node.type!=='input'||selectedNodeRef.current!==nodeId)return;
    const choose=window.sirenDesktop?.chooseSourceFile;if(typeof choose!=='function')return;
    const request=++sourcePickSeqRef.current,view=viewSeqRef.current,draft=draftSeqRef.current;
    const owns=()=>request===sourcePickSeqRef.current&&view===viewSeqRef.current&&draft===draftSeqRef.current&&selectedNodeRef.current===nodeId&&!closingWindowRef.current&&graphRef.current.nodes.some(n=>n.id===nodeId&&n.type==='input');
    sourcePickPendingRef.current={request,nodeId};setSourcePickPending({request,nodeId});
    try{
      const receipt=await choose();
      if(!owns())return;
      if(receipt&&receipt.canceled===true&&Object.keys(receipt).length===1)return;
      if(!receipt||Array.isArray(receipt)||receipt.canceled!==false||Object.keys(receipt).sort().join(',')!=='canceled,filePath,format'||
         typeof receipt.filePath!=='string'||!receipt.filePath||receipt.filePath.includes('\0')||
         !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(receipt.filePath)||!['csv','parquet'].includes(receipt.format)||
         !receipt.filePath.toLowerCase().endsWith('.'+receipt.format))throw Error('Source selection was not confirmed.');
      if(node.data.path===receipt.filePath&&(node.data.format||'csv')===receipt.format)return;
      updateNodeData(nodeId,{path:receipt.filePath,format:receipt.format});
      setAlertBanner({type:'success',text:'Source selected. Reader options are kept. Run the workflow to inspect its schema and results.'});
    }catch(error){if(owns()){
      const reason=String(error?.message||'');
      const text=reason.includes('Choose a CSV or Parquet file.')?'Choose a CSV or Parquet file. The current source was kept.':
        reason.includes('APP_CLOSING')?'Save the workflow and restart before choosing another source.':
        /ENOENT|EACCES|Choose an existing file/.test(reason)?'The selected file is not available. The current source was kept.':
        reason.includes('Source selection was not confirmed.')?'Source selection could not be confirmed. The current source was kept.':
        'The source chooser could not finish. The current source was kept; try again.';
      setAlertBanner({type:'error',text});
    }}
    finally{if(sourcePickPendingRef.current?.request===request){sourcePickPendingRef.current=null;setSourcePickPending(null);}}
  };

  // Execute pipeline via Unified Transport (Desktop IPC or Web fallback)
  const handleRunWorkflow = async (stopAt=null,mode='output') => {
    if(closingWindowRef.current||closeCleanupFailed){setAlertBanner({type:'error',text:'Save the workflow and restart the application before running again.'});return;}
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before running the workflow.'});return;}
    const target=typeof stopAt==='string'?stopAt:null;
    if(target&&target!==selectedNodeRef.current)return;
    let execution;
    try{execution=target?(mode==='join-inputs'?joinInputsPrefix(graphRef.current.nodes,graphRef.current.edges,target):mode==='filter-input'?filterInputPrefix(graphRef.current.nodes,graphRef.current.edges,target):mode==='derive-input'?derivedInputPrefix(graphRef.current.nodes,graphRef.current.edges,target):mode==='count-input'?countInputPrefix(graphRef.current.nodes,graphRef.current.edges,target):mode==='sum-input'?sumInputPrefix(graphRef.current.nodes,graphRef.current.edges,target):mode==='lookup-inputs'?lookupInputsPrefix(graphRef.current.nodes,graphRef.current.edges,target):executionPrefix(graphRef.current.nodes,graphRef.current.edges,target)):graphRef.current;validateGraph(execution.nodes,execution.edges);}catch(error){setAlertBanner({type:'error',text:'Workflow needs attention: '+error.message});return;}
    const executing=new Set(execution.nodes.map(n=>n.id));
    clearPolling();
    const currentSeq = ++executionSeqRef.current;
    const runView=viewSeqRef.current;
    setInspection(null);
    schemaRunRef.current=null;setSchemaRun(null);
    const retired = activeJobRef.current;
    activeJobRef.current = null;
    setActiveJobId(null);
    retireJob(retired);

    setWorkflowStatus('running');
    setStatusMessage('Submitting pipeline to runner service...');
    setProgressPercent(5);
    setAlertBanner(null);

    // Update node statuses to running
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...n.data, status: executing.has(n.id)?'running':'outdated', isOutdated: !executing.has(n.id), preview: [], rowCount: null } }))
    );

    try {
      const submitData = await transportClient.runWorkflow({
        nodes: execution.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
        edges: execution.edges.map((e) => ({ source: e.source, target: e.target, targetHandle: e.targetHandle }))
      });

      const jobId = submitData?.jobId;

      if (executionSeqRef.current !== currentSeq) {
        retireJob(jobId);
        return;
      }
      if (typeof jobId !== 'string' || !jobId) throw new Error('Submission returned no job identity');

      activeJobRef.current = jobId;
      setActiveJobId(jobId);
      setStatusMessage(`Job [${jobId}] accepted. Polling worker execution...`);

      // Own observations within this run as well as across runs/documents.
      // Clearing an interval does not retire promises already awaiting a reply.
      let observationSeq = 0, appliedObservation = 0, terminalObservation = false;
      const ownsObservation = observation => executionSeqRef.current === currentSeq &&
        runView === viewSeqRef.current && activeJobRef.current === jobId &&
        !closingWindowRef.current && !terminalObservation && observation > appliedObservation;
      const intervalId = setInterval(async () => {
        const observation = ++observationSeq;
        if (terminalObservation) return;
        if (executionSeqRef.current !== currentSeq) {
          clearPolling(currentSeq);
          return;
        }

        try {
          const jobData = await transportClient.getJobStatus(jobId);
          if (!ownsObservation(observation)) return;
          if (!isWorkflowPollFrame(jobData, jobId)) return;
          appliedObservation = observation;
          if (['completed','cancelled','failed'].includes(jobData.status)) terminalObservation = true;

          if (jobData.status === 'running' || jobData.status === 'queued') {
            setProgressPercent(jobData.progress?.percent ?? 20);
            setStatusMessage(`Job [${jobId}]: ${jobData.progress?.stepName || 'Processing in native DuckDB...'}`);
          } else if (jobData.status === 'completed') {
            clearPolling(currentSeq);
            setWorkflowStatus('completed');
            setStatusMessage(`Job [${jobId}] completed in ${jobData.telemetry?.durationMs || 0}ms${target?(mode==='join-inputs'?' · Join inputs only':mode==='filter-input'?' · Filter input only':mode==='derive-input'?' · New columns input only':mode==='count-input'?' · Count input only':mode==='sum-input'?' · Conditional sum input only':mode==='lookup-inputs'?' · Lookup inputs only':' · Run to selected node'):''}`);
            setProgressPercent(100);
            setCapturedSQL({jobId,steps:jobData.generatedSQL||[],schemas:Object.fromEntries(Object.entries(jobData.nodeOutputs||{}).map(([id,out])=>[id,out.schema||[]]))});
            if(jobData.jobId===jobId&&runView===viewSeqRef.current&&Array.isArray(jobData.pipelineDef?.nodes)&&Array.isArray(jobData.pipelineDef?.edges)){
              const capture={jobId,view:runView,definition:definition(jobData.pipelineDef.nodes,jobData.pipelineDef.edges),schemas:Object.fromEntries(Object.entries(jobData.nodeOutputs||{}).map(([id,out])=>[id,out.schema]))};
              schemaRunRef.current=capture;setSchemaRun(capture);
            }

            const totalRows = Object.values(jobData.nodeOutputs || {}).reduce((max, n) => Math.max(max, n.rowCount || 0), 0);
            setTelemetry({
              durationMs: jobData.telemetry?.durationMs || 0,
              peakRssMB: jobData.telemetry?.peakRssMB || 0,
              tempSpillMB: jobData.telemetry?.tempDiskSpillBytes ? (jobData.telemetry.tempDiskSpillBytes / 1048576).toFixed(2) : '0.00',
              totalRowsProcessed: totalRows
            });

            // Update nodes strictly with actual outputs from the engine
            setNodes((nds) =>
              nds.map((n) => {
                // Edits after submission invalidate this node and descendants.
                // A completed older job cannot make those edited inputs current.
                if (n.data.isOutdated) return n;
                const out = jobData.nodeOutputs?.[n.id];
                return {
                  ...n,
                  data: {
                    ...n.data,
                    status: out ? 'completed' : 'idle',
                    rowCount: out?.rowCount !== undefined ? out.rowCount : null,
                    preview: out?.preview || [],
                    isOutdated: false
                  }
                };
              })
            );
          } else if (jobData.status === 'cancelled') {
            clearPolling(currentSeq);
            setWorkflowStatus('cancelled');
            setStatusMessage(`Job [${jobId}] cancelled by user`);
            setProgressPercent(0);
            setNodes((nds) =>
              nds.map((n) => ({
                ...n,
                data: { ...n.data, status: n.data.status === 'running' ? 'idle' : n.data.status }
              }))
            );
          } else if (jobData.status === 'failed') {
            clearPolling(currentSeq);
            setWorkflowStatus('failed');
            setStatusMessage(`Job [${jobId}] failed: ${jobData.error}`);
            setProgressPercent(0);
            setAlertBanner({
              type: 'error',
              text: `Execution Failed: ${jobData.error}`
            });
            setNodes((nds) =>
              nds.map((n) => !executing.has(n.id)||n.data.isOutdated?n:({
                ...n,
                data: { ...n.data, status: 'failed' }
              }))
            );
          }
        } catch (pollErr) {
          if (ownsObservation(observation)) console.warn('[Polling Error]:', pollErr);
        }
      }, 100);
      pollingIntervalRef.current = { id: intervalId, owner: currentSeq };

    } catch (err) {
      if (executionSeqRef.current !== currentSeq) return;
      clearPolling(currentSeq);
      console.error('[Workflow Submission Error]:', err);
      setWorkflowStatus('failed');
      setStatusMessage(`Submission Failed: ${err.message}`);
      setProgressPercent(0);
      setAlertBanner({
        type: 'error',
        text: `Submission Failed: ${err.message}.`
      });
      setNodes((nds) =>
        nds.map((n) => !executing.has(n.id)||n.data.isOutdated?n:({
          ...n,
          data: { ...n.data, status: 'failed' }
        }))
      );
    }
  };

  // Cancel execution targeting specific activeJobId
  const handleCancel = async () => {
    const jobId = activeJobRef.current;
    if (!jobId || jobId !== activeJobId || workflowStatus !== 'running') return;
    const currentSeq = executionSeqRef.current;
    const ownsJob = () => executionSeqRef.current === currentSeq && activeJobRef.current === jobId;

    setStatusMessage(`Sending cancellation request for job [${jobId}]...`);
    try {
      const data = await transportClient.cancelJob(jobId);
      if (!ownsJob()) return;
      if (!data || data.success !== true) {
        const reason = typeof data?.message === 'string' ? data.message : 'Runner did not confirm cancellation';
        setStatusMessage(`Cancellation not confirmed: ${reason}`);
        setAlertBanner({ type: 'warning', text: `Cancellation not confirmed: ${reason}` });
        return;
      }

      clearPolling(currentSeq);
      executionSeqRef.current++; // Invalidate any incoming poll responses
      setWorkflowStatus('cancelled');
      setStatusMessage(`Job [${jobId}] cancelled successfully.`);
      setProgressPercent(0);
      setAlertBanner({
        type: 'warning',
        text: data.message || `Job ${jobId} cancelled.`
      });
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: { ...n.data, status: n.data.status === 'running' ? 'idle' : n.data.status }
        }))
      );
    } catch (err) {
      if (!ownsJob()) return;
      setAlertBanner({
        type: 'error',
        text: `Cancellation rejected: ${err.message}`
      });
    }
  };

  const handleExportToDocs = async () => {
    if (draftFieldsRef.current.size || !activeJobId || workflowStatus !== 'completed' || !selectedNode || selectedNode.data.isOutdated || selectedNode.type==='export') {
      setAlertBanner({
        type: 'error',
        text: 'Cannot export: Please run the workflow successfully first. Exports require a verified, completed job.'
      });
      return;
    }

    const currentSeq = executionSeqRef.current;
    const currentView = viewSeqRef.current;
    const request = ++exportSeqRef.current;
    const ownsExport = () => request === exportSeqRef.current && currentView === viewSeqRef.current && currentSeq === executionSeqRef.current && selectedNodeId === selectedNodeRef.current;
    try {
      const data = await transportClient.exportToDocs(activeJobId, selectedNodeId);
      if (!ownsExport()) return;
      if (!data || data.error || !data.success) {
        throw new Error(data?.error || data?.message || 'Export returned unsuccessful status');
      }

      setAlertBanner({
        type: 'success',
        text: `Export Succeeded! Created SIREN Docs envelope v1.0.0 (${data.filePath}) with ${data.transferredRows || data.rowsTransferred} rows (${data.transferStatus}).`
      });
      dismissAlertAfter(5000);
    } catch (err) {
      if (!ownsExport()) return;
      setAlertBanner({
        type: 'error',
        text: `Export Failed: ${err.message}`
      });
    }
  };

  // Workflow JSON Save & Load
  const handleSaveWorkflowJSON = async () => {
    if(draftFieldsRef.current.size){setAlertBanner({type:'warning',text:'Finish editing the current field before saving the definition.'});return;}
    const currentView = viewSeqRef.current;
    const request = ++saveSeqRef.current;
    const ownsSave = () => request === saveSeqRef.current && currentView === viewSeqRef.current;
    const ticket=historyRef.current.captureSave();refreshHistory(n=>n+1);
    const workflow = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      ...ticket.definition
    };

    if (isDesktopEnvironment()) {
      try {
        const res = await transportClient.saveWorkflow(workflow,historyRef.current.path);
        if (!ownsSave()) return;
        historyRef.current.finishSave(ticket,res);refreshHistory(n=>n+1);
        if (res && res.error) {
          setAlertBanner({
            type: 'error',
            text: `Save failed: ${res.error}`
          });
          return;
        }
        if (historyRef.current.phase==='saved' && res?.canceled===false && typeof res.filePath==='string' && res.filePath) {
          setAlertBanner({
            type: 'success',
            text: `Workflow definition saved to: ${res.filePath}${historyRef.current.dirty||draftFieldsRef.current.size?' — newer changes remain unsaved.':''}`
          });
          dismissAlertAfter(4000);
        }
        return;
      } catch (err) {
        if (!ownsSave()) return;
        historyRef.current.finishSave(ticket,{error:err.message});refreshHistory(n=>n+1);
        setAlertBanner({
          type: 'error',
          text: `Save failed: ${err.message}`
        });
        return;
      }
    }

    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `siren_workflow_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    historyRef.current.finishSave(ticket,null);refreshHistory(n=>n+1);
  };

  const replaceWorkflow = (parsed, message, filePath=null) => {
    const clean=prepareWorkflowImport(parsed);
    executionSeqRef.current++;
    authoredSeqRef.current++;
    schemaRunRef.current=null;setSchemaRun(null);
    setInspection(null);
    viewSeqRef.current++;
    draftSeqRef.current++;
    clearPolling();
    const retired = activeJobRef.current;
    activeJobRef.current = null;
    setActiveJobId(null);
    setCapturedSQL(null);
    retireJob(retired);
    historyRef.current.reset(clean,{saved:true,path:filePath});refreshHistory(n=>n+1);
    draftFieldsRef.current.clear();setPendingFields(0);setEditorEpoch(n=>n+1);
    const loadedNodes=invalidateGraph(clean.nodes);
    graphRef.current={nodes:loadedNodes,edges:clean.edges};
    setNodes(loadedNodes);
    setEdges(clean.edges);
    const selected = clean.nodes[0]?.id ?? null;
    selectedNodeRef.current = selected;
    setSelectedNodeId(selected);
    setWorkflowStatus('idle');
    setProgressPercent(0);
    setTelemetry({ durationMs: 0, peakRssMB: 0, tempSpillMB: 0, totalRowsProcessed: 0 });
    setStatusMessage(message);
    setAlertBanner({ type: 'success', text: `Workflow loaded successfully (${parsed.nodes.length} nodes). Ready to run.` });
    dismissAlertAfter(4000);
  };

  const openWorkflow = async () => {
    const request = ++loadSeqRef.current;
    const currentView = viewSeqRef.current;
    const currentDraft = draftSeqRef.current;
    const ownsLoad = () => request === loadSeqRef.current && currentView === viewSeqRef.current && currentDraft === draftSeqRef.current;
    if (isDesktopEnvironment()) {
      try {
        const res = await transportClient.openWorkflow();
        if (!ownsLoad()) return;
        if (res && res.error) {
          setAlertBanner({
            type: 'error',
            text: `Open failed: ${res.error}`
          });
          return;
        }
        if (res && !res.canceled && res.content) {
          const parsed = res.content;
          replaceWorkflow(parsed, `Loaded workflow with ${parsed.nodes.length} nodes from ${res.filePath}`,res.filePath);
        }
        return;
      } catch (err) {
        if (!ownsLoad()) return;
        setAlertBanner({
          type: 'error',
          text: `Failed to open workflow: ${err.message}`
        });
        return;
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };
  const handleLoadWorkflowClick = () => {
    if(historyRef.current.dirty||draftFieldsRef.current.size){setDefinitionConfirm({kind:'load',action:()=>openWorkflow()});return;}
    openWorkflow();
  };
  const handleRevert = () => {
    if(!historyRef.current.baseline||draftFieldsRef.current.size)return;
    setDefinitionConfirm({kind:'revert',action:()=>{
      const d=structuredClone(historyRef.current.baseline);historyRef.current.record(d);restoreGraph(d);
    }});
  };

  const handleWorkflowFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const request = ++loadSeqRef.current;
    const currentView = viewSeqRef.current;
    const currentDraft = draftSeqRef.current;
    const ownsLoad = () => request === loadSeqRef.current && currentView === viewSeqRef.current && currentDraft === draftSeqRef.current;

    const reader = new FileReader();
    reader.onload = (evt) => {
      if (!ownsLoad()) return;
      try {
        // Validate and clone inside this error boundary before storing a
        // confirmation callback; rejection must preserve the current workflow.
        const prepared=prepareWorkflowImport(JSON.parse(evt.target.result));
        const action=()=>replaceWorkflow(prepared, `Loaded workflow with ${prepared.nodes.length} nodes and ${prepared.edges.length} edges.`);
        if(historyRef.current.dirty||draftFieldsRef.current.size)setDefinitionConfirm({kind:'load',action});else action();
      } catch (err) {
        setAlertBanner({
          type: 'error',
          text: `Failed to load workflow file: ${err.message}`
        });
      }
    };
    reader.onerror = () => {
      if (ownsLoad()) setAlertBanner({ type: 'error', text: 'Failed to read workflow file.' });
    };
    reader.readAsText(file);
  };

  // Render actual dynamic preview rows from the selected node
  const previewRows = selectedNode?.data?.preview || [];
  const selectedTable=getNodeTable({nodes,edges,nodeId:selectedNodeId,capture:schemaRun,view:viewSeqRef.current});
  const previewColNames = selectedTable.status==='available'?selectedTable.columns.map(c=>c.name):previewRows.length > 0 ? Object.keys(previewRows[0]) : [];
  const inspectionMatches=inspection&&selectedTable.status==='available'&&['jobId','view','nodeId','key'].every(k=>inspection[k]===selectedTable.token[k])&&!definitionConfirm&&!closingWindow;
  useEffect(()=>{if(inspection&&!inspectionMatches)setInspection(null);},[inspection,inspectionMatches]);
  const inspectTable=()=>{
    if(draftFieldsRef.current.size||closingWindowRef.current)return;
    const current=getNodeTable({...graphRef.current,nodeId:selectedNodeRef.current,capture:schemaRunRef.current,view:viewSeqRef.current});
    if(current.status!=='available'){setAlertBanner({type:'warning',text:current.reason});return;}
    setInspection(current.token);
  };
  const canExportSelected = !pendingFields&&workflowStatus==='completed'&&!!selectedNode&&!selectedNode.data.isOutdated&&selectedNode.type!=='export'&&Number.isSafeInteger(selectedNode.data.rowCount);

  return (
    <div className="analysis-app" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', fontFamily: 'Segoe UI, system-ui, sans-serif', backgroundColor: '#F8FAFC' }}>
      {inspectionMatches&&<TableInspector table={selectedTable} title={selectedNode.data.label||selectedNode.id} onClose={()=>setInspection(null)}/>}
      {definitionConfirm&&<DefinitionConfirm kind={definitionConfirm.kind} dirty={definitionDirty} busy={closingWindow} writeBusy={historyRef.current.phase==='saving'} onCancel={definitionConfirm.kind==='close'?cancelWindowClose:()=>setDefinitionConfirm(null)} onConfirm={definitionConfirm.kind==='close'?approveWindowClose:()=>{const action=definitionConfirm.action;setDefinitionConfirm(null);action();}}/>}
      {/* Hidden file input for loading workflow JSON */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".json"
        onChange={handleWorkflowFileChange}
      />

      {/* Top Header Bar */}
      <header
        className="analysis-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          backgroundColor: '#0F172A',
          color: '#FFFFFF',
          borderBottom: '1px solid #1E293B',
          zIndex: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#38BDF8' }} />
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>
            SIREN <span style={{ color: '#38BDF8', fontWeight: 400 }}>Analysis & Advanced Automation</span>
          </h1>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, backgroundColor: '#1E293B', color: '#94A3B8' }}>
            {isDesktopEnvironment() ? 'Isolated desktop prototype' : 'Web prototype'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="flow-history-button" aria-label="Undo definition change" title="Undo definition change (Ctrl+Z outside text fields)" disabled={!historyRef.current.past.length||!!pendingFields} onClick={()=>moveHistory('undo')}>Undo</button>
          <button className="flow-history-button" aria-label="Redo definition change" title="Redo definition change (Ctrl+Shift+Z or Ctrl+Y outside text fields)" disabled={!historyRef.current.future.length||!!pendingFields} onClick={()=>moveHistory('redo')}>Redo</button>
          <button className="flow-history-button" aria-label="Revert definition changes" disabled={!historyRef.current.baseline||!definitionDirty||!!pendingFields} onClick={handleRevert}>Revert</button>
          <button
            onClick={handleRunWorkflow}
            disabled={workflowStatus === 'running'||closingWindow||closeCleanupFailed}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: workflowStatus === 'running' ? '#475569' : '#10B981',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 12,
              cursor: workflowStatus === 'running' ? 'not-allowed' : 'pointer'
            }}
          >
            <span>▶</span> Run Workflow
          </button>
          <button type="button" className="flow-history-button" disabled={!selectedNode||workflowStatus==='running'||closingWindow||closeCleanupFailed||pendingFields>0} onClick={()=>handleRunWorkflow(selectedNodeId)} title="Run only this node and its upstream inputs; the full authored workflow stays unchanged">Run to selected node</button>

          <button
            onClick={handleCancel}
            disabled={workflowStatus !== 'running'||!activeJobId}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #475569',
              backgroundColor: 'transparent',
              color: workflowStatus === 'running' ? '#F87171' : '#64748B',
              fontSize: 12,
              cursor: workflowStatus === 'running' ? 'pointer' : 'not-allowed'
            }}
          >
            Cancel
          </button>

          <button
            onClick={handleSaveWorkflowJSON}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #475569',
              backgroundColor: '#1E293B',
              color: '#E2E8F0',
              fontSize: 12,
              cursor: 'pointer'
            }}
            title="Save workflow definition separately from recorded results"
          >
            💾 Save definition
          </button>

          <button
            onClick={handleLoadWorkflowClick}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #475569',
              backgroundColor: '#1E293B',
              color: '#E2E8F0',
              fontSize: 12,
              cursor: 'pointer'
            }}
            title="Load workflow from JSON file"
          >
            📂 Load
          </button>

          <button
            onClick={handleExportToDocs}
            disabled={!canExportSelected}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #38BDF8',
              backgroundColor: canExportSelected ? '#0369A1' : '#334155',
              color: canExportSelected ? '#FFFFFF' : '#94A3B8',
              fontWeight: 600,
              fontSize: 12,
              cursor: canExportSelected ? 'pointer' : 'not-allowed'
            }}
          >
            Export Node to Docs
          </button>
        </div>
      </header>
      <div className="flow-definition-state" role="status" aria-live="polite" data-definition-dirty={definitionDirty?'true':'false'} data-save-phase={historyRef.current.phase}>
        <strong>{definitionDirty?'Unsaved definition changes':'Definition unchanged'}</strong>
        {pendingFields>0&&<span> · Field edit pending</span>}
        <span> · {({idle:'Not saved',loaded:'Loaded from file',saving:'Saving definition…',saved:'Saved',cancelled:'Save cancelled',failed:'Save failed',unknown:'Save outcome unknown'})[historyRef.current.phase]}</span>
        {historyRef.current.path&&<span className="flow-definition-path" title={historyRef.current.path}> · {historyRef.current.path}</span>}
        {historyRef.current.error&&<span> · {historyRef.current.error}</span>}
      </div>

      {/* Alert Banner */}
      {alertBanner && (
        <div
          style={{
            padding: '8px 20px',
            backgroundColor: alertBanner.type === 'error' ? '#FEE2E2' : alertBanner.type === 'warning' ? '#FEF3C7' : '#DCFCE7',
            color: alertBanner.type === 'error' ? '#991B1B' : alertBanner.type === 'warning' ? '#92400E' : '#166534',
            fontSize: 12,
            fontWeight: 600,
            borderBottom: '1px solid rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span>{alertBanner.text}</span>
          <button onClick={() => setAlertBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Main Workspace Area (Canvas + Drawer) */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <FlowLibrary onAdd={addOperation} onFit={()=>flowRef.current?.fitView({padding:.15,maxZoom:1})}/>
        {/* React Flow Visual Canvas */}
        <div style={{ flex: 1, height: '100%', position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            onInit={instance=>{flowRef.current=instance;}}
            onDragOver={e=>{if(e.dataTransfer.types.includes('application/siren-operation')){e.preventDefault();e.dataTransfer.dropEffect='copy';}}}
            onDrop={e=>{const type=e.dataTransfer.getData('application/siren-operation');if(type){e.preventDefault();addOperation(type,flowRef.current.screenToFlowPosition({x:e.clientX,y:e.clientY}));}}}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onNodeDragStart={()=>{dragGroupRef.current='drag_'+crypto.randomUUID();}}
            onNodeDragStop={()=>{dragGroupRef.current=null;}}
            fitView
          >
            <Background color="#CBD5E1" gap={16} />
            <Controls />
            <MiniMap nodeStrokeColor="#94A3B8" nodeColor="#E2E8F0" />
          </ReactFlow>
        </div>

        {/* Inspector & Real Bounded Preview Drawer */}
        <div
          className="node-inspector"
          style={{
            width: 480,
            backgroundColor: '#FFFFFF',
            borderLeft: '1px solid #E2E8F0',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-2px 0 8px rgba(0,0,0,0.04)',
            zIndex: 5
          }}
        >
          {/* Drawer Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Node Inspector
              </span>
              {selectedNode && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: '#E2E8F0', color: '#334155', fontWeight: 600 }}>
                  {selectedNode.type.toUpperCase()}
                </span>
              )}
            </div>
            <h3 style={{ margin: '4px 0 0 0', fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
              {selectedNode ? selectedNode.data.label || selectedNode.id : 'No Node Selected'}
            </h3>
          </div>

          <SavedJournalHistory />
          <ResultHistory jobId={activeJobId} nodeId={selectedNodeId} canCapture={workflowStatus==='completed'&&!selectedNode?.data?.isOutdated&&Number.isSafeInteger(selectedNode?.data?.rowCount)&&selectedNode?.type!=='export'} currentDefinition={()=>({nodes:nodes.map(n=>({id:n.id,type:n.type,data:n.data})),edges})}/>

          {/* Drawer Content */}
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            {selectedNode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Node Status Badge */}
                <FlowConnections key={'connections:'+viewSeqRef.current+':'+selectedNode.id} node={selectedNode} nodes={nodes} edges={renderedEdges} onConnect={onConnect} onDisconnect={disconnect} onRemove={removeOperation}/>
                <details className="flow-sql"><summary>Generated SQL · captured run</summary><p>{capturedSQL?'Captured job '+capturedSQL.jobId+'. Edits do not change this execution snapshot.':'Run the workflow to capture generated SQL from the actual worker.'}</p>{capturedSQL&&<><p>{(capturedSQL.schemas[selectedNode.id]||[]).map(c=>c.name+': '+c.type+(c.nullable?' (nullable)':'')).join(' · ')}</p><pre>{capturedSQL.steps.filter(s=>s.nodeId===selectedNode.id).map(s=>s.sql).join('\n\n')||'This node was not part of the captured job.'}</pre></>}</details>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0', fontSize: 12 }}>
                  <span>Execution Status:</span>
                  <strong style={{
                    color: selectedNode.data.isOutdated ? '#F59E0B' :
                           selectedNode.data.status === 'completed' ? '#10B981' :
                           selectedNode.data.status === 'failed' ? '#EF4444' :
                           selectedNode.data.status === 'running' ? '#3B82F6' : '#64748B'
                  }}>
                    {selectedNode.data.isOutdated ? 'OUTDATED (WORKFLOW CHANGED)' : (selectedNode.data.status || 'idle').toUpperCase()}
                  </strong>
                </div>

                {selectedNode.data.rowCount !== null && selectedNode.data.rowCount !== undefined && !selectedNode.data.isOutdated && (
                  <div style={{ fontSize: 12, color: '#334155' }}>
                    Total Node Rows: <strong>{selectedNode.data.rowCount.toLocaleString()}</strong>
                  </div>
                )}

                <NodeEditor key={'parameters:'+viewSeqRef.current+':'+editorEpoch+':'+selectedNode.id} node={selectedNode} onChange={updateNodeData} onDraftChange={noteParameterDraft} onChooseSource={typeof window.sirenDesktop?.chooseSourceFile==='function'?handleChooseSource:undefined} sourceBusy={!!sourcePickPending} sourcePicking={sourcePickPending?.nodeId===selectedNode.id} pendingFields={pendingFields} sourceSchema={sourceSchema} onAddFromSchema={addSchemaColumn} joinSchemas={joinSchemas} onChooseJoinKey={chooseJoinKey} onRunJoinInputs={id=>handleRunWorkflow(id,'join-inputs')} joinRunBusy={workflowStatus==='running'||closingWindow||closeCleanupFailed} filterSchema={filterSchema} onEditCriteria={editCriteria} onRunFilterInput={id=>handleRunWorkflow(id,'filter-input')} onUseFilterSQL={useFilterSQL} filterRunBusy={workflowStatus==='running'||closingWindow||closeCleanupFailed} derivedSchema={derivedSchema} onEditDerived={editDerived} onRunDerivedInput={id=>handleRunWorkflow(id,'derive-input')} derivedRunBusy={workflowStatus==='running'||closingWindow||closeCleanupFailed} countSchema={countSchema} onEditCount={editCount} onRunCountInput={id=>handleRunWorkflow(id,'count-input')} sumSchema={sumSchema} onEditSum={editSum} onRunSumInput={id=>handleRunWorkflow(id,'sum-input')} lookupSchemas={lookupSchemas} onEditLookup={editLookup} onRunLookupInputs={id=>handleRunWorkflow(id,'lookup-inputs')} functionRunBusy={workflowStatus==='running'||closingWindow||closeCleanupFailed}/>

                {/* Step Data Preview (STRICTLY REAL DATA) */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>Step Data Preview</span>
                    <span style={{ fontSize: 10, color: '#64748B' }}>Bounded (Max 50 rows)</span>
                    <button type="button" className="flow-inspect-button" onClick={inspectTable} disabled={pendingFields>0||selectedTable.status!=='available'||closingWindow}>Inspect table</button>
                  </div>
                  {selectedTable.status!=='available'&&<p className="flow-help">{selectedTable.reason}</p>}

                  <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#1E40AF', marginBottom: 10 }}>
                    🛡️ <strong>Zero Bulk Data in UI:</strong> Large datasets stay in native DuckDB on disk. The preview below is limited to 50 real rows from the worker process.
                  </div>

                  {selectedNode.data.isOutdated ? (
                    <div style={{ padding: 16, border: '1px dashed #F59E0B', backgroundColor: '#FEF3C7', borderRadius: 6, textAlign: 'center', color: '#92400E', fontSize: 11 }}>
                      ⚠️ <strong>Workflow modified:</strong> Parameters or connections changed. Click <strong>Run Workflow</strong> to recompute results in DuckDB.
                    </div>
                  ) : previewRows.length > 0 ? (
                    <div className="flow-node-preview" role="region" aria-label="Node result preview" tabIndex={0} style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'auto', maxHeight: 280 }}>
                      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 11 }}>
                        <caption>Row numbers follow this captured preview; letters follow result column order.</caption>
                        <thead>
                          <tr style={{ backgroundColor: '#F1F5F9', borderBottom: '1px solid #CBD5E1', textAlign: 'left' }}>
                            <th scope="col" className="flow-row-number flow-coordinate-corner" aria-label="Row number in captured preview">Row</th>
                            {previewColNames.map((col, idx) => (
                              <th scope="col" key={idx} style={{ padding: '6px 8px', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                                <b className="flow-column-letter" aria-label={'Column '+columnLetter(idx)}>{columnLetter(idx)}</b><span>{col}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, rIdx) => (
                            <tr key={rIdx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                              <th scope="row" className="flow-row-number" aria-label={'Preview row '+(rIdx+1)}>{rIdx+1}</th>
                              {previewColNames.map((col, cIdx) => (
                                <td key={cIdx} style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                                  {row[col] === null ? (
                                    <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>null</span>
                                  ) : row[col] === '' ? (
                                    <span style={{ color: '#CBD5E1' }}>""</span>
                                  ) : (
                                    String(row[col])
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ padding: 16, border: '1px dashed #CBD5E1', borderRadius: 6, textAlign: 'center', color: '#64748B', fontSize: 11 }}>
                      {selectedTable.status==='available'&&selectedTable.total===0?'No result rows. Use Inspect table to view the captured schema.':selectedNode.data.status === 'failed'
                        ? '❌ No preview data: execution failed for this node.'
                        : 'ℹ️ No preview available yet. Click "Run Workflow" to execute this node in native DuckDB.'}
                    </div>
                  )}
                  {isDesktopEnvironment() && workflowStatus==='completed' && !selectedNode.data.isOutdated && <WorkflowHistogramPanel key={activeJobId+':'+selectedNodeId} jobId={activeJobId} nodeId={selectedNodeId} />}
                </div>
              </div>
            ) : (
              <div style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
                Click any workflow node on the canvas to inspect settings, view generated SQL, and preview bounded results.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Telemetry & Status Bar */}
      <footer
        className="analysis-footer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 20px',
          backgroundColor: '#FFFFFF',
          borderTop: '1px solid #E2E8F0',
          fontSize: 11,
          color: '#475569',
          zIndex: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600, color: workflowStatus === 'completed' ? '#10B981' : workflowStatus === 'running' ? '#3B82F6' : workflowStatus === 'failed' ? '#EF4444' : '#64748B' }}>
            STATUS: {workflowStatus.toUpperCase()}
          </span>
          <span>|</span>
          <span>{statusMessage}</span>
          {nodes.some(n=>n.data.isOutdated)&&workflowStatus!=='running'&&<strong style={{color:'#92400e'}}>Definition changed · run again</strong>}
          {workflowStatus === 'running' && (
            <div style={{ width: 80, height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: '#3B82F6', transition: 'width 0.2s ease' }} />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span>Duration: <strong>{telemetry.durationMs > 0 ? `${telemetry.durationMs}ms` : '—'}</strong></span>
          <span>Worker RSS: <strong>{telemetry.peakRssMB > 0 ? `${telemetry.peakRssMB} MB` : '—'}</strong></span>
          <span>Disk Spill: <strong>{telemetry.tempSpillMB !== 0 ? `${telemetry.tempSpillMB} MB` : '0 MB'}</strong></span>
          <span>Largest node: <strong>{telemetry.totalRowsProcessed > 0 ? telemetry.totalRowsProcessed.toLocaleString() : '—'}</strong></span>
        </div>
      </footer>
    </div>
  );
}
