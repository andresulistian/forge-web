import path from "node:path";

// One binding per active project in this server process. Kanban persists the plan;
// the binding transfers that exact plan and result callback to the runtime.
const bindings = new Map();
const key = (dataDir, projectId) => JSON.stringify([path.resolve(dataDir), String(projectId)]);

export function bindWorkflow(dataDir, projectId, binding) {
  if (!binding?.runId || !binding.plan || typeof binding.record !== "function") throw Error("Binding workflow tidak valid.");
  const id = key(dataDir, projectId);
  const current = bindings.get(id);
  if (current && current.runId !== binding.runId) throw Error("Workflow lain masih terikat pada proyek ini.");
  bindings.set(id, binding);
}
export function activeWorkflow(dataDir, projectId) { return bindings.get(key(dataDir, projectId)) || null; }
export function unbindWorkflow(dataDir, projectId, runId) {
  const id = key(dataDir, projectId);
  if (bindings.get(id)?.runId === runId) bindings.delete(id);
}
