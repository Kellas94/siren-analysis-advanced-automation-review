/**
 * SIREN Visual Builder — Immutable History Stack (Undo / Redo)
 */

export class HistoryManager {
  constructor(initialState, maxDepth = 50) {
    this.maxDepth = maxDepth;
    this.undoStack = [];
    this.redoStack = [];
    this.currentState = JSON.parse(JSON.stringify(initialState));
  }

  getCurrentState() {
    return JSON.parse(JSON.stringify(this.currentState));
  }

  pushState(newState) {
    if (!newState) return;
    const serializedCurrent = JSON.stringify(this.currentState);
    const serializedNew = JSON.stringify(newState);
    
    // Don't push if no changes occurred
    if (serializedCurrent === serializedNew) return;

    this.undoStack.push(JSON.parse(serializedCurrent));
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.currentState = JSON.parse(serializedNew);
    this.redoStack = []; // Cleared on new mutation
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  reset(initialState) {
    this.undoStack = [];
    this.redoStack = [];
    this.currentState = JSON.parse(JSON.stringify(initialState || { nodes: [], edges: [] }));
  }

  undo() {
    if (!this.canUndo()) return null;
    const prev = this.undoStack.pop();
    this.redoStack.push(JSON.parse(JSON.stringify(this.currentState)));
    this.currentState = prev;
    return JSON.parse(JSON.stringify(this.currentState));
  }

  redo() {
    if (!this.canRedo()) return null;
    const next = this.redoStack.pop();
    this.undoStack.push(JSON.parse(JSON.stringify(this.currentState)));
    this.currentState = next;
    return JSON.parse(JSON.stringify(this.currentState));
  }
}
