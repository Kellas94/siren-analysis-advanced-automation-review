/**
 * DAG Validation & Cycle Detection for Visual Workflow Graph
 */

export function wouldCreateCycle(sourceId, targetId, edges) {
  if (sourceId === targetId) return true; // Self loop is a cycle

  // Adjacency map
  const adj = new Map();
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source).push(edge.target);
  }

  // Add the prospective edge: sourceId -> targetId
  if (!adj.has(sourceId)) adj.set(sourceId, []);
  adj.get(sourceId).push(targetId);

  // DFS from targetId to see if we can reach sourceId
  const visited = new Set();
  const stack = [targetId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === sourceId) return true; // Path exists from target to source -> cycle!

    if (!visited.has(current)) {
      visited.add(current);
      const neighbors = adj.get(current) || [];
      for (const n of neighbors) {
        stack.push(n);
      }
    }
  }

  return false;
}
