import React,{useLayoutEffect,useRef} from 'react';
export function DefinitionConfirm({kind,onCancel,onConfirm,dirty=true,busy=false,writeBusy=false}){
 const dialog=useRef(null),cancel=useRef(null);
 useLayoutEffect(()=>{const previous=document.activeElement;dialog.current.showModal();cancel.current.focus();return ()=>{if(previous?.isConnected)previous.focus();};},[]);
 const closing=kind==='close';
 return <dialog ref={dialog} className="flow-confirm" aria-labelledby="definition-confirm-title" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
  <h2 id="definition-confirm-title">{closing?(busy?'Closing workflow…':'Close workflow?'):kind==='load'?'Open another workflow?':'Revert to the saved definition?'}</h2>
  <p>{closing?(busy?'Waiting for owned work to stop before closing.':writeBusy?'A definition save is still in progress. Finish or cancel that save before closing.':dirty?'Unsaved changes will be lost. Keep editing to save them, or close without saving.':'The definition has no unsaved changes.'):kind==='load'?'Current unsaved changes will be replaced. Save the definition first if you want to keep them.':'Current changes will be replaced by the last loaded or confirmed saved definition. You can undo this revert.'}</p>
  <div><button ref={cancel} disabled={busy} onClick={onCancel}>Keep editing</button><button disabled={busy||(closing&&writeBusy)} onClick={onConfirm}>{closing?(dirty?'Close without saving':'Close'):kind==='load'?'Continue opening':'Revert changes'}</button></div>
 </dialog>;
}
