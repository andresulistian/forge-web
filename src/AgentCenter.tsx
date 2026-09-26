import { useEffect, useState } from "react";
import {
  Brain,
  Check,
  Clock3,
  FileDiff,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import { api, type Project } from "./api";

type Memory = {
  structure: string[];
  commands: Record<string, string>;
  conventions: string[];
  decisions: string[];
  frameworks: string[];
  updatedAt: number | null;
};
type Skill = {
  id: string;
  command: string;
  name: string;
  description: string;
  builtin: boolean;
};
type Run = {
  id: string;
  status: string;
  startedAt: number;
  elapsedMs: number;
  provider: string;
  model?: string;
  mode: string;
  request: string;
  retry: Record<string, unknown>;
  testStatus: string;
  buildStatus: string;
  reviewStatus: string;
  usage?: Record<string, number> | null;
  diff?: {
    files: { status: string; file: string }[];
    stat: string;
    patch: string;
    truncated?: boolean;
  } | null;
};
type Center = {
  run: Run | null;
  activities: {
    time: number;
    phase: string;
    label: string;
    detail?: string;
  }[];
  memory: Memory;
  skills: Skill[];
};

const empty: Center = {
  run: null,
  activities: [],
  memory: {
    structure: [],
    commands: {},
    conventions: [],
    decisions: [],
    frameworks: [],
    updatedAt: null,
  },
  skills: [],
};

export default function AgentCenter({
  project,
  active,
  busy,
  revision,
  onBusy,
  onError,
  onRetry,
  onUseSkill,
  onProjectChanged,
}: {
  project: Project | null;
  active: boolean;
  busy: boolean;
  revision: number;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onRetry: (request: Record<string, unknown>) => void;
  onUseSkill: (command: string) => void;
  onProjectChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<Center>(empty);
  const [conventions, setConventions] = useState("");
  const [decisions, setDecisions] = useState("");
  const [skillOpen, setSkillOpen] = useState(false);
  const [skill, setSkill] = useState({
    name: "",
    command: "/",
    description: "",
    prompt: "",
  });
  const load = async () => {
    if (!project) return setData(empty);
    const next = await api<Center>(`agent-center?projectId=${project.id}`);
    setData(next);
    setConventions(next.memory.conventions.join("\n"));
    setDecisions(next.memory.decisions.join("\n"));
  };
  useEffect(() => {
    void load().catch((error) => onError(error.message));
    if (!active) return;
    const timer = window.setInterval(
      () => void load().catch(() => {}),
      2000,
    );
    return () => window.clearInterval(timer);
  }, [project?.id, active, revision]);

  const act = async (action: () => Promise<void>) => {
    onBusy(true);
    onError("");
    try {
      await action();
      await load();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      onBusy(false);
    }
  };
  const elapsed = data.run
    ? Math.max(
        data.run.elapsedMs || 0,
        data.run.status === "running" ? Date.now() - data.run.startedAt : 0,
      )
    : 0;

  if (!project)
    return <div className="agent-center-empty">Pilih proyek untuk membuka Agent Center.</div>;

  return (
    <div className="agent-center">
      <section className="agent-card run-card">
        <header>
          <span><Clock3 size={15} /> Agent run</span>
          <b className={`run-status ${data.run?.status || "idle"}`}>
            {data.run?.status || "idle"}
          </b>
        </header>
        {data.run ? (
          <>
            <strong>{data.run.request}</strong>
            <div className="run-metrics">
              <span>{data.run.provider}{data.run.model ? ` · ${data.run.model}` : ""}</span>
              <span>{Math.round(elapsed / 1000)}s</span>
              <span>Test: {data.run.testStatus}</span>
              <span>Build: {data.run.buildStatus}</span>
              {data.run.usage && (
                <span>
                  Usage: {data.run.usage.total_tokens || data.run.usage.output_tokens || "tersedia"}
                  {data.run.usage.cost ? ` · $${Number(data.run.usage.cost).toFixed(4)}` : ""}
                </span>
              )}
            </div>
            <div className="agent-actions">
              {active ? (
                <button disabled={busy} onClick={() => void act(async () => { await api("stop", {}); })}>
                  <Square size={13} /> Stop
                </button>
              ) : (
                <button disabled={busy} onClick={() => onRetry(data.run!.retry)}>
                  <Play size={13} /> Retry
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="muted">Run berikutnya akan tampil dengan durasi, status test/build, usage, dan hasil review.</p>
        )}
      </section>

      {data.run?.diff && (
        <section className="agent-card review-card">
          <header>
            <span><FileDiff size={15} /> Review perubahan</span>
            <b>{data.run.reviewStatus}</b>
          </header>
          <pre className="diff-stat">{data.run.diff.stat || "Tidak ada perubahan file."}</pre>
          {!!data.run.diff.files.length && (
            <div className="changed-files">
              {data.run.diff.files.map((item) => (
                <span key={`${item.status}-${item.file}`}><b>{item.status}</b>{item.file}</span>
              ))}
            </div>
          )}
          {!!data.run.diff.patch && (
            <details className="diff-review">
              <summary>Lihat diff lengkap{data.run.diff.truncated ? " (dipotong)" : ""}</summary>
              <pre>{data.run.diff.patch}</pre>
            </details>
          )}
          {["ready", "accepted"].includes(data.run.reviewStatus) && (
            <div className="agent-actions">
              {data.run.reviewStatus === "ready" && (
                <button className="primary" disabled={busy || active} onClick={() => void act(async () => {
                  await api("review/accept", { projectId: project.id });
                  await onProjectChanged();
                })}><Check size={13} /> Accept</button>
              )}
              <button disabled={busy || active} onClick={() => {
                if (!window.confirm("Undo seluruh perubahan dari run agent ini? Forge membuat checkpoint pemulihan terlebih dahulu.")) return;
                void act(async () => {
                  await api("review/undo", { projectId: project.id, confirmed: true });
                  await onProjectChanged();
                });
              }}><RotateCcw size={13} /> Undo</button>
            </div>
          )}
        </section>
      )}

      <section className="agent-card">
        <header>
          <span><Wrench size={15} /> Reusable skills</span>
          <button onClick={() => setSkillOpen((value) => !value)}><Plus size={12} /> Custom</button>
        </header>
        <div className="skill-grid">
          {data.skills.map((item) => (
            <div className="skill-item" key={item.id}>
              <button className="skill-use" onClick={() => onUseSkill(item.command)}>
                <code>{item.command}</code><span>{item.description}</span>
              </button>
              {!item.builtin && (
                <button aria-label={`Hapus ${item.name}`} onClick={() => void act(async () => {
                  await api("skills/delete", { projectId: project.id, id: item.id });
                })}><Trash2 size={12} /></button>
              )}
            </div>
          ))}
        </div>
        {skillOpen && (
          <div className="skill-form">
            <input placeholder="Nama skill" value={skill.name} onChange={(event) => setSkill({ ...skill, name: event.target.value })} />
            <input placeholder="/command" value={skill.command} onChange={(event) => setSkill({ ...skill, command: event.target.value })} />
            <input placeholder="Deskripsi singkat" value={skill.description} onChange={(event) => setSkill({ ...skill, description: event.target.value })} />
            <textarea placeholder="Instruksi reusable untuk agent" value={skill.prompt} onChange={(event) => setSkill({ ...skill, prompt: event.target.value })} />
            <button className="primary" disabled={busy} onClick={() => void act(async () => {
              await api("skills/save", { projectId: project.id, skill });
              setSkill({ name: "", command: "/", description: "", prompt: "" });
              setSkillOpen(false);
            })}>Simpan skill</button>
          </div>
        )}
      </section>

      <section className="agent-card memory-card">
        <header>
          <span><Brain size={15} /> Project Memory</span>
          <button disabled={busy || active} onClick={() => void act(async () => {
            await api("memory/refresh", { projectId: project.id });
          })}><RefreshCw size={12} /> Scan ulang</button>
        </header>
        <div className="memory-summary">
          <span>{data.memory.frameworks.join(" · ") || "Framework belum terdeteksi"}</span>
          <span>{data.memory.structure.length} path dipetakan</span>
          <span>{Object.keys(data.memory.commands).length} command</span>
        </div>
        <label>CONVENTIONS<textarea value={conventions} onChange={(event) => setConventions(event.target.value)} placeholder="Satu convention per baris" /></label>
        <label>DECISIONS<textarea value={decisions} onChange={(event) => setDecisions(event.target.value)} placeholder="Satu keputusan penting per baris" /></label>
        <button className="primary" disabled={busy} onClick={() => void act(async () => {
          await api("memory/save", {
            projectId: project.id,
            memory: {
              conventions: conventions.split("\n").map((item) => item.trim()).filter(Boolean),
              decisions: decisions.split("\n").map((item) => item.trim()).filter(Boolean),
            },
          });
        })}>Simpan memory proyek</button>
      </section>

      <section className="agent-card activity-card">
        <header><span><Loader2 size={15} /> High-level activity</span></header>
        <div className="structured-activity">
          {data.activities.length ? data.activities.map((item, index) => (
            <div key={`${item.time}-${index}`}>
              <i className={item.phase === "error" ? "error-dot" : ""} />
              <span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
              <time>{new Date(item.time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>
            </div>
          )) : <p className="muted">Belum ada aktivitas agent untuk proyek ini.</p>}
        </div>
      </section>
    </div>
  );
}
