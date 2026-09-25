import { useEffect, useState } from "react";
import { api, type Project } from "./api";

type Mode = "economy" | "balanced" | "maximum";
type Column = "backlog" | "todo" | "in_progress" | "review_test" | "done";
type Task = {
  id: string; title: string; request: string; subtasks: string[]; column: Column; mode: Mode;
  provider?: string; model?: string; routing: { workers: number; complexity: string };
  summary: string; buildTaskId?: string | null; checks?: {
    passed: boolean; results: { name: string; ok: boolean; output: string }[];
  } | null;
  pricing?: { inputPerMillion: number; outputPerMillion: number };
  usage: { inputTokens: number; outputTokens: number; estimated: boolean; costUsd: number | null; estimatedCostUsd?: number | null };
};
type Board = { tasks: Task[]; memory: string };
const columns: { key: Column; label: string }[] = [
  { key: "backlog", label: "Backlog" }, { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" }, { key: "review_test", label: "Review/Test" },
  { key: "done", label: "Done" },
];
const modeLabels: Record<Mode, string> = { economy: "Economy", balanced: "Balanced", maximum: "Maximum" };

export default function KanbanPanel({ project, revision, busy, onError, onUse }: {
  project: Project | null; revision: number; busy: boolean;
  onError: (error: string) => void; onUse: (task: Task) => void;
}) {
  const [board, setBoard] = useState<Board>({ tasks: [], memory: "" });
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem("forge-orchestration-mode");
    return saved === "economy" || saved === "maximum" ? saved : "balanced";
  });
  const [working, setWorking] = useState(false);
  const load = async () => {
    if (project) setBoard(await api<Board>(`kanban?projectId=${project.id}`));
    else setBoard({ tasks: [], memory: "" });
  };
  useEffect(() => { void load().catch((error) => onError(error.message)); }, [project?.id, revision]);
  const action = async (fn: () => Promise<unknown>) => {
    if (!project) return;
    setWorking(true);
    onError("");
    try { await fn(); await load(); }
    catch (error) { onError((error as Error).message); }
    finally { setWorking(false); }
  };
  if (!project) return <div className="review-empty">Pilih proyek untuk membuka Kanban.</div>;
  return <div className="kanban-panel">
    <header className="kanban-header">
      <div><h2>Kanban · Agent Orchestration</h2><p>Task tersimpan per proyek. Done memerlukan Build diterapkan dan regression checks lulus.</p></div>
      <label>Mode biaya
        <select value={mode} onChange={(event) => {
          const next = event.target.value as Mode;
          setMode(next); localStorage.setItem("forge-orchestration-mode", next);
        }}>{Object.entries(modeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </label>
    </header>
    <div className="kanban-create">
      <textarea aria-label="Task baru" value={request} onChange={(event) => setRequest(event.target.value)}
        placeholder="Tulis tujuan. Daftar bernomor akan dipecah menjadi langkah task otomatis." />
      <button disabled={!request.trim() || busy || working} onClick={() => void action(async () => {
        await api("kanban/create", { projectId: project.id, request, mode }); setRequest("");
      })}>Tambah task</button>
    </div>
    {board.memory && <details className="kanban-memory"><summary>Ringkasan proyek</summary><p>{board.memory}</p></details>}
    <div className="kanban-columns">
      {columns.map((column) => <section className="kanban-column" key={column.key}>
        <h3>{column.label} <span>{board.tasks.filter((task) => task.column === column.key).length}</span></h3>
        {board.tasks.filter((task) => task.column === column.key).map((task) => <article className="kanban-card" key={task.id}>
          <strong>{task.title}</strong>
          <small>{modeLabels[task.mode]} · {task.routing?.workers || 1} agent · {task.routing?.complexity || "small"}</small>
          {task.subtasks.length > 1 && <details><summary>{task.subtasks.length} langkah otomatis</summary>
            <ol>{task.subtasks.map((part, index) => <li key={index}>{part}</li>)}</ol></details>}
          {task.summary && <p>{task.summary}</p>}
          <details><summary>Token & biaya</summary>
            <p>{task.usage.inputTokens.toLocaleString()} masuk · {task.usage.outputTokens.toLocaleString()} keluar
              {task.usage.estimated ? " (estimasi)" : " (dilaporkan provider)"}</p>
            <p>{task.usage.costUsd == null ? "Biaya belum dilaporkan provider" : `Biaya dilaporkan: $${task.usage.costUsd.toFixed(5)}`}</p>
            {task.usage.estimatedCostUsd != null && <p>Estimasi berdasarkan tarif Anda: ${task.usage.estimatedCostUsd.toFixed(5)}</p>}
            <form className="kanban-pricing" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void action(() => api("kanban/pricing", { projectId: project.id, taskId: task.id,
                inputPerMillion: Number(data.get("inputRate")), outputPerMillion: Number(data.get("outputRate")) }));
            }}>
              <label>Masuk $/1M <input name="inputRate" type="number" min="0" step="0.001" required defaultValue={task.pricing?.inputPerMillion ?? ""} /></label>
              <label>Keluar $/1M <input name="outputRate" type="number" min="0" step="0.001" required defaultValue={task.pricing?.outputPerMillion ?? ""} /></label>
              <button disabled={busy || working}>Hitung</button>
            </form>
            {task.provider && <p>{task.provider} · {task.model || "model default"}</p>}
          </details>
          {task.checks && <details open={!task.checks.passed}><summary>{task.checks.passed ? "Checks lulus" : "Checks gagal"}</summary>
            {task.checks.results.map((check) => <p key={check.name}>{check.ok ? "✓" : "✕"} {check.name}: {check.output || "OK"}</p>)}
          </details>}
          <div className="kanban-actions">
            {!task.buildTaskId && <button disabled={busy || working} onClick={() => onUse(task)}>Gunakan di Build</button>}
            {task.column === "review_test" && task.buildTaskId &&
              <button disabled={busy || working} onClick={() => void action(() => api("kanban/verify", { projectId: project.id, taskId: task.id }))}>Jalankan checks → Done</button>}
            {!task.buildTaskId && <select aria-label={`Pindah ${task.title}`} value={task.column} disabled={busy || working}
              onChange={(event) => void action(() => api("kanban/move", { projectId: project.id, taskId: task.id, column: event.target.value }))}>
              {columns.filter((option) => option.key !== "done").map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
            </select>}
          </div>
        </article>)}
      </section>)}
    </div>
  </div>;
}
