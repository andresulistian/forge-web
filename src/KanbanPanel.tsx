import { useCallback, useEffect, useState } from "react";
import { Columns3, Loader2, Trash2 } from "lucide-react";
import { api, type Project } from "./api";

type Mode = "economy" | "balanced" | "maximum";
type Column = "backlog" | "todo" | "in_progress" | "review_test" | "done";
export type KanbanTask = {
  id: string;
  title: string;
  request: string;
  subtasks: string[];
  column: Column;
  mode: Mode;
  provider?: string;
  model?: string;
  routing: { workers: number; complexity: string; specialists?: string[] };
  summary: string;
  review?: "pending" | "no-changes" | "accepted" | "undone" | null;
  changedFiles?: string[];
  buildTaskId?: string | null;
  checks?: {
    passed: boolean;
    results: { name: string; ok: boolean; output: string }[];
  } | null;
  pricing?: { inputPerMillion: number; outputPerMillion: number };
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimated: boolean;
    costUsd: number | null;
    estimatedCostUsd?: number | null;
  };
};
type Board = { tasks: KanbanTask[]; memory: string };

const columns: { key: Column; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "review_test", label: "Review/Test" },
  { key: "done", label: "Done" },
];
const modeLabels: Record<Mode, string> = {
  economy: "Economy",
  balanced: "Balanced",
  maximum: "Maximum",
};
const reviewLabels: Record<string, string> = {
  pending: "Menunggu Accept di tab Agent",
  "no-changes": "Tidak ada perubahan file",
  accepted: "Perubahan diterima",
  undone: "Perubahan di-undo",
};

export default function KanbanPanel({
  project,
  revision,
  busy,
  onError,
  onUse,
}: {
  project: Project | null;
  revision: number;
  busy: boolean;
  onError: (error: string) => void;
  onUse: (task: KanbanTask) => void;
}) {
  const [board, setBoard] = useState<Board>({ tasks: [], memory: "" });
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem("forge-orchestration-mode");
    return saved === "economy" || saved === "maximum" ? saved : "balanced";
  });
  const [working, setWorking] = useState(false);
  const projectId = project?.id;
  const load = useCallback(async () => {
    if (projectId)
      setBoard(await api<Board>(`kanban?projectId=${encodeURIComponent(projectId)}`));
    else setBoard({ tasks: [], memory: "" });
  }, [projectId]);
  useEffect(() => {
    void load().catch((error) => onError(error.message));
  }, [load, revision, onError]);
  const action = async (fn: () => Promise<unknown>) => {
    if (!project) return;
    setWorking(true);
    onError("");
    try {
      await fn();
      await load();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setWorking(false);
    }
  };
  if (!project)
    return <div className="kanban-empty">Pilih proyek untuk membuka Kanban.</div>;
  const disabled = busy || working;
  return (
    <div className="kanban-panel">
      <header className="kanban-header">
        <div>
          <h2>
            <Columns3 size={17} /> Kanban · Agent Orchestration
          </h2>
          <p>
            Task tersimpan per proyek. Build memindahkan task ke In Progress lalu Review/Test. Done
            memerlukan Accept di tab Agent dan regression checks (lint/test/build) lulus.
          </p>
        </div>
        <label>
          Mode biaya
          <select
            value={mode}
            onChange={(event) => {
              const next = event.target.value as Mode;
              setMode(next);
              localStorage.setItem("forge-orchestration-mode", next);
            }}
          >
            {Object.entries(modeLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="kanban-create">
        <textarea
          aria-label="Task baru"
          value={request}
          maxLength={40000}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Tulis tujuan. Daftar bernomor akan dipecah menjadi langkah task otomatis."
        />
        <button
          disabled={!request.trim() || disabled}
          onClick={() =>
            void action(async () => {
              await api("kanban/create", { projectId: project.id, request, mode });
              setRequest("");
            })
          }
        >
          {working ? <Loader2 className="spin" size={14} /> : null} Tambah task
        </button>
      </div>
      {board.memory && (
        <details className="kanban-memory">
          <summary>Ringkasan task selesai</summary>
          <p>{board.memory}</p>
        </details>
      )}
      <div className="kanban-columns">
        {columns.map((column) => {
          const tasks = board.tasks.filter((task) => task.column === column.key);
          return (
            <section className="kanban-column" key={column.key}>
              <h3>
                {column.label} <span>{tasks.length}</span>
              </h3>
              {tasks.map((task) => (
                <article className="kanban-card" key={task.id}>
                  <strong>{task.title}</strong>
                  <small>
                    {modeLabels[task.mode]} · {task.routing?.workers || 1} agent ·{" "}
                    {task.routing?.complexity || "small"}
                  </small>
                  {task.subtasks.length > 1 && (
                    <details>
                      <summary>{task.subtasks.length} langkah otomatis</summary>
                      <ol>
                        {task.subtasks.map((part, index) => (
                          <li key={index}>{part}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {task.summary && <p>{task.summary}</p>}
                  {task.column === "review_test" && task.review && (
                    <p className="kanban-review">{reviewLabels[task.review] || task.review}</p>
                  )}
                  {!!task.changedFiles?.length && (
                    <details>
                      <summary>{task.changedFiles.length} file berubah</summary>
                      <ul>
                        {task.changedFiles.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <details>
                    <summary>Token & biaya</summary>
                    <p>
                      {task.usage.inputTokens.toLocaleString()} masuk ·{" "}
                      {task.usage.outputTokens.toLocaleString()} keluar
                      {task.usage.estimated ? " (estimasi)" : " (dilaporkan provider)"}
                    </p>
                    <p>
                      {task.usage.costUsd == null
                        ? "Biaya belum dilaporkan provider"
                        : `Biaya dilaporkan: $${task.usage.costUsd.toFixed(5)}`}
                    </p>
                    {task.usage.estimatedCostUsd != null && (
                      <p>Estimasi berdasarkan tarif Anda: ${task.usage.estimatedCostUsd.toFixed(5)}</p>
                    )}
                    <form
                      className="kanban-pricing"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        void action(() =>
                          api("kanban/pricing", {
                            projectId: project.id,
                            taskId: task.id,
                            inputPerMillion: Number(data.get("inputRate")),
                            outputPerMillion: Number(data.get("outputRate")),
                          }),
                        );
                      }}
                    >
                      <label>
                        Masuk $/1M
                        <input
                          name="inputRate"
                          type="number"
                          min="0"
                          step="0.001"
                          required
                          defaultValue={task.pricing?.inputPerMillion ?? ""}
                        />
                      </label>
                      <label>
                        Keluar $/1M
                        <input
                          name="outputRate"
                          type="number"
                          min="0"
                          step="0.001"
                          required
                          defaultValue={task.pricing?.outputPerMillion ?? ""}
                        />
                      </label>
                      <button disabled={disabled}>Hitung</button>
                    </form>
                    {task.provider && (
                      <p>
                        {task.provider} · {task.model || "model default"}
                      </p>
                    )}
                  </details>
                  {task.checks && (
                    <details open={!task.checks.passed}>
                      <summary>{task.checks.passed ? "Checks lulus" : "Checks gagal"}</summary>
                      {task.checks.results.map((check) => (
                        <p key={check.name}>
                          {check.ok ? "✓" : "✕"} {check.name}: {check.output || "OK"}
                        </p>
                      ))}
                    </details>
                  )}
                  <div className="kanban-actions">
                    {!task.buildTaskId && task.column !== "done" && (
                      <button disabled={disabled} onClick={() => onUse(task)}>
                        Gunakan di Build
                      </button>
                    )}
                    {task.column === "review_test" && task.buildTaskId && (
                      <button
                        disabled={
                          disabled || !(task.review === "accepted" || task.review === "no-changes")
                        }
                        title="Menjalankan script lint, test, dan build dari package.json proyek"
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Jalankan script lint/test/build proyek ini untuk regression checks?",
                            )
                          )
                            return;
                          void action(() =>
                            api("kanban/verify", {
                              projectId: project.id,
                              taskId: task.id,
                              confirmed: true,
                            }),
                          );
                        }}
                      >
                        Jalankan checks → Done
                      </button>
                    )}
                    {!task.buildTaskId && (task.column === "backlog" || task.column === "todo") && (
                      <select
                        aria-label={`Pindah ${task.title}`}
                        value={task.column}
                        disabled={disabled}
                        onChange={(event) =>
                          void action(() =>
                            api("kanban/move", {
                              projectId: project.id,
                              taskId: task.id,
                              column: event.target.value,
                            }),
                          )
                        }
                      >
                        <option value="backlog">Backlog</option>
                        <option value="todo">To Do</option>
                      </select>
                    )}
                    {task.column !== "in_progress" && (
                      <button
                        className="kanban-delete"
                        aria-label={`Hapus task ${task.title}`}
                        disabled={disabled}
                        onClick={() => {
                          if (!window.confirm(`Hapus task "${task.title}"?`)) return;
                          void action(() =>
                            api("kanban/delete", { projectId: project.id, taskId: task.id }),
                          );
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
