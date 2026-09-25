import AttachmentPicker, { type Attachment } from "./Attachments";
import AiPicker, { initialAi } from "./AiPicker";
import ChatWorkspace from "./ChatWorkspace";
import GuideChat from "./GuideChat";
import DeployCenter from "./DeployCenter";
import BrowserTests from "./BrowserTests";
import MonacoCodeEditor from "./MonacoCodeEditor";
import IntegrationsPanel from "./IntegrationsPanel";
import ReviewPanel from "./ReviewPanel";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  Flame,
  Folder,
  FolderOpen,
  Globe2,
  GitPullRequest,
  GitBranch,
  History,
  Loader2,
  MessageSquare,
  Monitor,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  ShieldCheck,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Moon,
  Terminal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  api,
  connect,
  subscribe,
  type Project,
  type Message,
  type Checkpoint,
  type ForgeEvent,
} from "./api";
type Mode = "ask" | "plan" | "build";
type WebMode = "auto" | "web" | "off";
const providerName = (provider?: string) =>
  provider === "gemini"
    ? "Gemini"
    : provider === "ollama"
      ? "Local AI"
      : provider === "bonsai"
        ? "Bonsai"
      : provider?.startsWith("api:")
        ? "API Provider"
        : "Codex";
const hints = {
  ask: "Tanya dan pelajari proyek. File tidak diubah.",
  plan: "Susun rencana sebelum mulai. File tidak diubah.",
  build: "Agent membaca, mengedit, dan menguji proyek.",
};
export default function App() {
  const [space, setSpace] = useState<"build" | "chat">("build");
  const [ai, setAi] = useState(initialAi);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState<Project | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(""),
    [mode, setMode] = useState<Mode>("build");
  const [webMode, setWebMode] = useState<WebMode>(() => {
    const saved = localStorage.getItem("forge-web-mode");
    return saved === "web" || saved === "off" ? saved : "auto";
  });
  const [events, setEvents] = useState<ForgeEvent[]>([]),
    [approvals, setApprovals] = useState<any[]>([]),
    [active, setActive] = useState<string | null>(null),
    [stream, setStream] = useState(true),
    [runtime, setRuntime] = useState("Memeriksa Codex…");
  const [tab, setTab] = useState("preview"),
    [securityRevision, setSecurityRevision] = useState(0),
    [releaseRevision, setReleaseRevision] = useState(0),
    [files, setFiles] = useState<string[]>([]),
    [file, setFile] = useState(""),
    [source, setSource] = useState(""),
    [savedSource, setSavedSource] = useState(""),
    [editing, setEditing] = useState(false),
    [history, setHistory] = useState<Checkpoint[]>([]),
    [preview, setPreview] = useState<{ url: string; projectId: string } | null>(
      null,
    ),
    [frameKey, setFrameKey] = useState(0);
  const [integrationRevision, setIntegrationRevision] = useState(0);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [multiAgent, setMultiAgent] = useState(() => localStorage.getItem("forge-multi-agent") === "true");
  const [approvalSound, setApprovalSound] = useState(() => localStorage.getItem("forge-approval-sound") !== "false");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", next === "light" ? "#f9fcf6" : "#101112");
    try { localStorage.setItem("forge-theme", next); } catch { /* Private browsing can disable storage. */ }
    setTheme(next);
  };
  const [usageRevision, setUsageRevision] = useState(0);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [deployment, setDeployment] = useState<any>(null);
  const [modal, setModal] = useState<"new" | "open" | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{
      title: string;
      body: string;
      action: () => Promise<void>;
    } | null>(null),
    [deleting, setDeleting] = useState<{ project: Project; deleteFiles: boolean } | null>(null),
    [deleteConfirmation, setDeleteConfirmation] = useState(""),
    [clearingWorkspace, setClearingWorkspace] = useState<{ deleteFiles: boolean } | null>(null),
    [workspaceConfirmation, setWorkspaceConfirmation] = useState(""),
    [resolvingApproval, setResolvingApproval] = useState<string | null>(null),
    [connected, setConnected] = useState(false),
    [live, setLive] = useState(""),
    [mobile, setMobile] = useState(false);
  const [agentProgress, setAgentProgress] = useState<{
    projectId: string;
    stage: string;
    label: string;
    percent: number;
    status: "active" | "completed" | "failed";
    detail?: string;
    time?: number;
  } | null>(null);
  const [progressStartedAt, setProgressStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const current = useRef<Project | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const approvalAudio = useRef<AudioContext | null>(null);
  const approvalSoundEnabled = useRef(approvalSound);
  const soundedApprovals = useRef(new Set<string>());
  approvalSoundEnabled.current = approvalSound;
  const unlockApprovalAudio = async () => {
    if (!approvalAudio.current || approvalAudio.current.state === "closed")
      approvalAudio.current = new AudioContext();
    if (approvalAudio.current.state === "suspended")
      await approvalAudio.current.resume();
    return approvalAudio.current;
  };
  const playApprovalSound = async (force = false) => {
    if (!force && !approvalSoundEnabled.current) return;
    try {
      const context = await unlockApprovalAudio();
      if (context.state !== "running") return;
      const start = context.currentTime;
      for (const [frequency, delay] of [[740, 0], [1046, 0.18]] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start + delay);
        gain.gain.setValueAtTime(0.0001, start + delay);
        gain.gain.exponentialRampToValueAtTime(0.08, start + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.22);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start + delay);
        oscillator.stop(start + delay + 0.24);
      }
    } catch {
      // Browser dapat menahan audio sampai ada interaksi pengguna berikutnya.
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const decideApproval = async (id: string, accept: boolean) => {
    setError("");
    setResolvingApproval(id);
    try {
      await api("approve", { id, accept });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolvingApproval(null);
    }
  };
  const refresh = async (p: Project) => {
    const [f, h, m] = await Promise.all([
      api<string[]>("files?projectId=" + p.id),
      api<Checkpoint[]>("history?projectId=" + p.id),
      api<Message[]>("messages?projectId=" + p.id),
    ]);
    if (current.current?.id === p.id) {
      setFiles(f);
      setHistory(h);
      setMessages(m);
    }
  };
  const dirty = source !== savedSource;
  const select = async (p: Project) => {
    if (
      dirty &&
      !window.confirm(
        "Perubahan kode belum disimpan. Buang perubahan dan pindah proyek?",
      )
    )
      return false;
    revision.current++;
    current.current = p;
    setSelected(p);
    setAttachments([]);
    setLive("");
    setAgentProgress(null);
    setProgressStartedAt(null);
    setFile("");
    setSource("");
    setSavedSource("");
    setEditing(false);
    setMessages([]);
    await refresh(p);
    return true;
  };
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    void (async () => {
      try {
        await connect();
        const state = await api("state");
        if (!alive) return;
        setProjects(state.projects);
        setPreview(state.preview);
        setActive(state.active?.projectId || null);
        setApprovals(state.approvals);
        setDeployment(state.deployment || null);
        const restoredProgress = state.progress?.[state.projects[0]?.id];
        if (restoredProgress) {
          setAgentProgress(restoredProgress);
          if (restoredProgress.status === "active") setProgressStartedAt(restoredProgress.time || Date.now());
        }
        setConnected(true);
        if (state.projects[0]) await select(state.projects[0]);
        void subscribe(
          abort.signal,
          (e) => {
            if (e.type === "guide") return;
            if (
              !e.payload.method?.endsWith("/delta") &&
              !e.payload.method?.endsWith("outputDelta")
            )
              setEvents((v) => [...v.slice(-199), e]);
            const p = e.payload;
            if (e.type === "approval") {
              setApprovals((v) =>
                v.some((a) => a.id === p.id) ? v : [...v, p],
              );
              if (!soundedApprovals.current.has(String(p.id))) {
                soundedApprovals.current.add(String(p.id));
                void playApprovalSound();
              }
            }
            if (e.type === "approval-resolved")
              setApprovals((v) => v.filter((a) => a.id !== p.id));
            if (e.type === "preview") setPreview(p.url ? p : null);
            if (e.type === "deploy-started") setDeployment(p);
            if (e.type === "security-result") setSecurityRevision((v) => v + 1);
            if (e.type === "agent-progress" && p.projectId === current.current?.id) {
              setAgentProgress({ ...p, time: e.time });
              if (p.stage === "analyzing-request") {
                setProgressStartedAt(e.time);
                setElapsed(0);
              }
            }
            if (e.type === "web-research" && p.status === "completed" && current.current?.id === p.projectId) {
              const project = current.current;
              if (project) void refresh(project).catch((cause) => setError(cause.message));
            }
            if (e.type === "build-review-ready" && current.current?.id === p.projectId) {
              setReviewRevision((value) => value + 1);
              setTab("review");
              setActive(null);
              const project = current.current;
              if (project) void refresh(project).catch((cause) => setError(cause.message));
            }
            if (["build-task-applied", "build-task-discarded", "build-task-failed"].includes(e.type))
              setReviewRevision((value) => value + 1);
            if (e.type === "orchestration-task") {
              if (p.status === "active") setActive(p.projectId);
              if (["completed", "failed", "stopped"].includes(p.status)) setActive(null);
            }
            if (e.type === "deploy-completed") {
              setDeployment(null);
              setReleaseRevision((value) => value + 1);
              if (!p.ok) setError(p.error || "Deploy gagal.");
            }
            if (e.type === "runtime-error") {
              setActive(null);
              setApprovals([]);
              setError(p.message);
              setAttachments([]);
              setRuntime(`${providerName(p.provider)} terputus`);
            }
            if (e.type === "codex") {
              if (["gemini/usage_update", "account/rateLimits/updated", "turn/completed"].includes(p.method))
                setUsageRevision((value) => value + 1);
              if (p.method === "turn/started") setActive(p.projectId);
              if (
                p.method === "item/agentMessage/delta" &&
                p.projectId === current.current?.id
              )
                setLive((v) => v + p.params.delta);
              if (
                p.method === "item/completed" &&
                p.params.item?.type === "agentMessage" &&
                p.projectId === current.current?.id
              ) {
                setMessages((v) => [
                  ...v,
                  {
                    role: "assistant",
                    text: p.params.item.text,
                    provider: p.provider,
                  },
                ]);
                setLive("");
              }
              if (p.method === "turn/completed") {
                setActive(null);
                setApprovals([]);
                setLive("");
                if (p.params.turn?.error) setError(p.params.turn.error.message);
                if (current.current)
                  void refresh(current.current).catch((e) =>
                    setError(e.message),
                  );
              }
              if (p.method === "error")
                setError(p.params.error?.message || "Codex mengalami error.");
            }
          },
          setStream,
          state.eventId,
        );
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, []);
  useEffect(() => {
    const unlock = () => {
      if (approvalSoundEnabled.current) void unlockApprovalAudio();
    };
    window.addEventListener("pointerdown", unlock, { capture: true, once: true });
    window.addEventListener("keydown", unlock, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);
  useEffect(() => {
    if (!progressStartedAt || agentProgress?.status !== "active") return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - progressStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [progressStartedAt, agentProgress?.status]);
  useEffect(() => {
    if (messages.length || live)
      bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, live]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const send = () =>
    run(async () => {
      if (!selected || (!text.trim() && !attachments.length)) return;
      const value =
        text.trim() || "Analisis lampiran ini dan jelaskan temuan Anda.";
      setText("");
      setActive(selected.id);
      setMessages((v) => [
        ...v,
        {
          role: "user",
          text: value,
          mode,
          provider: ai.provider,
          model: ai.model,
          attachments,
        },
      ]);
      try {
        await api("chat", {
          projectId: selected.id,
          text: value,
          mode,
          webMode,
          multiAgent: mode === "build" && multiAgent,
          ...ai,
          attachments: attachments.map((a) => a.id),
        });
        setAttachments([]);
        setRuntime(`${providerName(ai.provider)} tersambung · ${ai.model}`);
      } catch (e) {
        setActive(null);
        setText(value);
        await refresh(selected);
        throw e;
      }
    });
  const create = () =>
    run(async () => {
      const p = await api<Project>(
        modal === "new" ? "projects/create" : "projects/open",
        modal === "new" ? { name } : { path: name },
      );
      setProjects((v) => (v.some((x) => x.id === p.id) ? v : [...v, p]));
      if (!(await select(p))) return;
      setModal(null);
      setName("");
    });
  const chooseFolder = () =>
    run(async () => {
      setName("");
      setModal("open");
    });
  const deleteSelectedProject = () =>
    run(async () => {
      if (!deleting) return;
      const result = await api<{ projects: Project[]; deletedFiles: boolean }>("projects/delete", {
        projectId: deleting.project.id,
        deleteFiles: deleting.deleteFiles,
        confirmationName: deleteConfirmation,
        confirmed: true,
      });
      setProjects(result.projects);
      setDeleting(null);
      setDeleteConfirmation("");
      setSelected(null);
      current.current = null;
      setMessages([]);
      setFiles([]);
      setFile("");
      setSource("");
      setSavedSource("");
      setHistory([]);
      setPreview(null);
      if (result.projects[0]) await select(result.projects[0]);
      setRuntime(result.deletedFiles ? "Proyek dipindahkan ke Trash" : "Proyek dihapus dari daftar Forge");
    });
  const clearWorkspace = () =>
    run(async () => {
      if (!clearingWorkspace) return;
      const result = await api<{ projects: Project[]; deletedFiles: boolean; count: number }>("projects/clear", {
        deleteFiles: clearingWorkspace.deleteFiles,
        confirmationText: workspaceConfirmation,
        confirmed: true,
      });
      setProjects(result.projects);
      setClearingWorkspace(null);
      setWorkspaceConfirmation("");
      setSelected(null);
      current.current = null;
      setMessages([]);
      setFiles([]);
      setFile("");
      setSource("");
      setSavedSource("");
      setHistory([]);
      setPreview(null);
      setRuntime(result.deletedFiles
        ? `${result.count} folder proyek dipindahkan ke Trash`
        : `${result.count} proyek dihapus dari Workspace`);
    });
  const startPreview = () =>
    run(async () => {
      if (!selected) return;
      const p = selected;
      const { script } = await api("preview/inspect", { projectId: p.id });
      setConfirm({
        title: "Jalankan preview lokal?",
        body: `Forge akan menjalankan npm run dev di ${p.path}. Script: ${script}. Script proyek berjalan dengan akses akun lokal Anda.`,
        action: async () => {
          const r = await api("preview/start", {
            projectId: p.id,
            confirmed: true,
          });
          setPreview({ url: r.url, projectId: p.id });
          setTab("preview");
        },
      });
    });
  const previewUrl = preview && preview.projectId === selected?.id &&
    /^http:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/|$)/.test(preview.url)
      ? preview.url
      : null;
  const openFile = (nextFile: string) =>
    run(async () => {
      if (
        dirty &&
        !window.confirm(
          nextFile === file
            ? "Perubahan kode belum disimpan. Buang perubahan dan muat ulang file ini?"
            : "Perubahan kode belum disimpan. Buang perubahan dan buka file lain?",
        )
      )
        return;
      const rev = revision.current;
      const r = await api<{ text: string }>(
        "file?projectId=" +
          selected!.id +
          "&file=" +
          encodeURIComponent(nextFile),
      );
      if (rev === revision.current) {
        setFile(nextFile);
        setSource(r.text);
        setSavedSource(r.text);
        setEditing(false);
      }
    });
  const saveFile = async () => {
    if (!selected || !file || !dirty) return;
    const result = await api<{ changed: boolean; history: Checkpoint[] }>(
      "file/save",
      {
        projectId: selected.id,
        file,
        text: source,
        expected: savedSource,
      },
    );
    setSavedSource(source);
    setEditing(false);
    setHistory(result.history);
    if (result.changed) setFrameKey((v) => v + 1);
  };
  const cancelEdit = () => {
    if (dirty && !window.confirm("Buang perubahan manual yang belum disimpan?"))
      return;
    setSource(savedSource);
    setEditing(false);
  };
  const runTerminalCommand = () => {
    if (!selected || !terminalCommand.trim()) return;
    const command = terminalCommand.trim();
    setConfirm({
      title: "Jalankan command di proyek ini?",
      body: `${command}\n\nFolder kerja: ${selected.path}. Command berjalan dengan akses akun lokal Anda dan output ditampilkan di Aktivitas.`,
      action: async () => {
        await api("terminal/run", {
          projectId: selected.id,
          command,
          confirmed: true,
        });
        setTerminalCommand("");
        await refresh(selected);
      },
    });
  };
  const visibleEvents = events.filter(
    (e) => !e.payload.projectId || e.payload.projectId === selected?.id,
  );
  const deploying = deployment?.projectId === selected?.id;
  if (space === "chat")
    return <ChatWorkspace connected={connected} theme={theme} onTheme={toggleTheme}
      onBuild={() => setSpace("build")}
      onSettings={() => { setSpace("build"); setTab("settings"); }} />;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Flame size={23} />
          </span>
          forge<span className="alpha">PERSONAL</span>
        </div>
        <button className="chat-space-entry" onClick={() => setSpace("chat")}>
          <MessageSquare size={16} /> Chat umum
        </button>
        <button
          className="new-project"
          disabled={!connected || busy}
          onClick={() => {
            setName("");
            setModal("new");
          }}
        >
          <Plus size={16} /> Proyek baru <span>⌘</span>
        </button>
        <div className="section-label">
          WORKSPACE
          <span className="workspace-actions">
            <span>{projects.length.toString().padStart(2, "0")}</span>
            <button
              className="clear-workspace-button"
              aria-label="Clear Workspace"
              title="Kosongkan daftar proyek atau pindahkan semua folder ke Trash"
              disabled={!projects.length || busy || !!active || deploying}
              onClick={() => {
                setError("");
                setWorkspaceConfirmation("");
                setClearingWorkspace({ deleteFiles: false });
              }}
            >
              <Trash2 size={12} /> Clear Workspace
            </button>
          </span>
        </div>
        <nav>
          {projects.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              className={"project " + (p.id === selected?.id ? "selected" : "")}
              onClick={() => void run(async () => void (await select(p)))}
            >
              <span className="project-icon">
                <Folder size={16} />
              </span>
              <span>
                {p.name}
                <small>Local project</small>
              </span>
              {p.id === selected?.id && <span className="dot" />}
            </button>
          ))}
        </nav>
        <button
          className="open-folder"
          disabled={!connected || busy}
          onClick={chooseFolder}
        >
          <FolderOpen size={15} /> Buka folder proyek
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={18} />
            <div>
              Ruang kerja pribadi
              <small>File & checkpoint di komputer Anda</small>
            </div>
          </div>
          <div className="profile">
            <div className="avatar">A</div>
            <div>
              Personal workspace<small>Forge · v0.7.0</small>
            </div>
            <span className="dot" />
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <Folder size={14} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{selected?.name || "Mulai proyek baru"}</strong>
          </div>
          <div className="top-actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
              title={theme === "dark" ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              <span>{theme === "dark" ? "Terang" : "Gelap"}</span>
            </button>
            <span className="local-badge">
              <span className="dot" /> LOCAL
            </span>
            <button
              className="delete-project-button"
              disabled={!selected || busy || !!active || deploying}
              onClick={() => {
                if (!selected) return;
                setError("");
                setDeleteConfirmation("");
                setDeleting({ project: selected, deleteFiles: false });
              }}
            >
              <Trash2 size={14} /> Hapus proyek
            </button>
            <button
              disabled={!selected || busy || !!active || deploying}
              onClick={() =>
                void run(async () => {
                  setHistory(
                    await api("checkpoint", { projectId: selected!.id }),
                  );
                  setTab("history");
                })
              }
            >
              <GitBranch size={14} /> Checkpoint
            </button>
          </div>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Tutup error" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        <div className="workspace">
          <section className="chat">
            <div className="panel-heading">
              <span>
                <Sparkles size={16} /> Builder
              </span>
              <span className="muted">IDEA → REALITY</span>
            </div>
            <div className="conversation">
              {messages.length === 0 ? (
                <div className="welcome">
                  <span className="welcome-icon">
                    <Flame size={29} />
                  </span>
                  <div className="eyebrow">YOUR NEXT IDEA STARTS HERE</div>
                  <h1>
                    Ide kecil.
                    <br />
                    Kemungkinan besar.
                  </h1>
                  <p>
                    Ceritakan apa yang ingin Anda buat.
                    <br />
                    Forge membantu mewujudkannya, langkah demi langkah.
                  </p>
                  <div className="suggestions">
                    {[
                      "Buat halaman landing yang modern",
                      "Jelaskan struktur proyek ini",
                      "Rencanakan fitur baru untuk aplikasi ini",
                    ].map((s, i) => (
                      <button
                        key={s}
                        disabled={!selected}
                        onClick={() => {
                          setText(s);
                          setMode(i === 1 ? "ask" : i === 2 ? "plan" : "build");
                        }}
                      >
                        {
                          [
                            <Code2 size={17} />,
                            <MessageSquare size={17} />,
                            <GitBranch size={17} />,
                          ][i]
                        }
                        {s}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                  <span className="welcome-foot">
                    {selected
                      ? "Anda pegang kendali. Mulai dengan Ask atau Plan."
                      : "Klik “Proyek baru” untuk memulai dengan demo siap pakai."}
                  </span>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={"message " + m.role}>
                    <div className="message-label">
                      {m.role === "web"
                        ? "↗ SUMBER WEB"
                        : m.role === "user"
                        ? "ANDA"
                        : m.role === "assistant"
                          ? "✳ FORGE"
                          : "SISTEM"}
                      {m.mode && <span>{m.mode}</span>}
                      {m.provider && (
                        <span>
                          {m.provider}
                          {m.model ? ` · ${m.model}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="message-text">{m.text}</div>
                    {!!m.sources?.length && (
                      <div className="web-sources">
                        {m.sources.map((source, index) => (
                          <a href={source.url} target="_blank" rel="noopener noreferrer" key={source.url}>
                            [{index + 1}] {source.title} <Globe2 size={11} />
                          </a>
                        ))}
                        {m.checkedAt && <small>Diperiksa {new Date(m.checkedAt).toLocaleString("id-ID")}</small>}
                      </div>
                    )}
                    {!!m.attachments?.length && (
                      <div className="message-attachments">
                        {m.attachments.map((a) => (
                          <span key={a.id}>
                            {a.kind === "video"
                              ? "▣"
                              : a.kind === "link"
                                ? "↗"
                                : "▧"}{" "}
                            {a.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              {live && (
                <div className="message assistant">
                  <div className="message-label">✳ FORGE</div>
                  <div className="message-text">
                    {live}
                    <span className="cursor" />
                  </div>
                </div>
              )}
              {active === selected?.id && !live && (
                <div className="working">
                  <Loader2 size={15} className="spin" /> Forge sedang bekerja…
                </div>
              )}
              <div ref={bottom} />
            </div>
            {approvals
              .filter((a) => a.projectId === selected?.id)
              .map((a) => (
                <div key={a.id} className="approval">
                  <strong>
                    <ShieldCheck size={17} /> Persetujuan diperlukan
                  </strong>
                  <p>{a.reason || "Codex meminta akses tambahan."}</p>
                  <pre>{a.command || JSON.stringify(a, null, 2)}</pre>
                  <div>
                    <button
                      disabled={resolvingApproval === a.id}
                      onClick={() => void decideApproval(a.id, false)}
                    >
                      Tolak
                    </button>
                    <button
                      className="primary"
                      disabled={resolvingApproval === a.id}
                      onClick={() => void decideApproval(a.id, true)}
                    >
                      Izinkan sekali
                    </button>
                  </div>
                </div>
              ))}
            <div className="composer-wrap">
              <AiPicker
                value={ai}
                onChange={setAi}
                projectId={selected?.id}
                disabled={busy || !!active || deploying}
                ready={connected}
                  onStatus={setRuntime}
                  integrationRevision={integrationRevision}
                  usageRevision={usageRevision}
              />
              <AttachmentPicker
                projectId={selected?.id}
                items={attachments}
                onChange={setAttachments}
                disabled={busy || !!active || deploying}
                onBusy={setBusy}
                onError={setError}
              />
              <div className="composer">
                <textarea
                  aria-label="Pesan untuk Forge"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    selected
                      ? "Apa yang ingin Anda buat hari ini?"
                      : "Pilih atau buat proyek untuk mulai…"
                  }
                  disabled={!selected}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      if (!active && !busy && !deploying) void send();
                    }
                  }}
                />
                <div className="composer-tools">
                  <div className="mode-switch">
                    {(["ask", "plan", "build"] as const).map((m) => (
                      <button
                        title={hints[m]}
                        className={mode === m ? "chosen" : ""}
                        key={m}
                        onClick={() => setMode(m)}
                      >
                        {m === "build" && <Sparkles size={12} />}{" "}
                        {m[0].toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                  <select
                    className="web-mode"
                    aria-label="Pencarian web"
                    title="Otomatis mencari saat informasi terbaru diperlukan; Web selalu mencari; Offline tidak mengirim pertanyaan ke pencarian. Atur API key di Settings."
                    value={webMode}
                    onChange={(event) => {
                      const next = event.target.value as WebMode;
                      setWebMode(next);
                      localStorage.setItem("forge-web-mode", next);
                    }}
                  >
                    <option value="auto">Web · Otomatis</option>
                    <option value="web">Web · Cari</option>
                    <option value="off">Web · Offline</option>
                  </select>
                  {mode === "build" && (
                    <button
                      type="button"
                      className={`agent-team-toggle ${multiAgent ? "chosen" : ""}`}
                      disabled={ai.provider !== "codex" && !ai.provider.startsWith("api:")}
                      title="Dua agent read-only memeriksa arsitektur dan risiko secara paralel, lalu satu builder mengerjakan perubahan."
                      onClick={() => {
                        const next = !multiAgent;
                        setMultiAgent(next);
                        localStorage.setItem("forge-multi-agent", String(next));
                      }}
                    >
                      <Users size={12} /> Tim agent
                    </button>
                  )}
                  {active ? (
                    <button
                      aria-label="Hentikan agent"
                      className="send"
                      onClick={() =>
                        void run(async () => {
                          await api("stop", {});
                        })
                      }
                    >
                      <Square size={16} />
                    </button>
                  ) : (
                    <button
                      aria-label="Kirim pesan"
                      className="send"
                      disabled={
                        !selected ||
                        (!text.trim() && !attachments.length) ||
                        busy ||
                        deploying ||
                        !stream
                      }
                      onClick={() => void send()}
                    >
                      <ArrowUp size={18} />
                    </button>
                  )}
                </div>
              </div>
              <div className="composer-caption">
                {hints[mode]}
                <span>↵ Kirim</span>
              </div>
            </div>
          </section>
          <section className="right-pane">
            <div className="tabs">
              {[
                { id: "preview", icon: Monitor, label: "Preview" },
                { id: "files", icon: Code2, label: "Code" },
                { id: "review", icon: GitPullRequest, label: "Review" },
                { id: "deploy", icon: Rocket, label: "Deploy" },
                { id: "history", icon: History, label: "Checkpoints" },
                { id: "settings", icon: Settings2, label: "Settings" },
              ].map((t) => (
                <button
                  key={t.id}
                  className={tab === t.id ? "active-tab" : ""}
                  onClick={() => setTab(t.id)}
                >
                  <t.icon size={15} />
                  {t.label}
                </button>
              ))}
              <span className="pane-spacer" />
              <span className="muted">WORKBENCH</span>
            </div>
            <div className="workbench">
              {tab === "preview" ? (
                <>
                  <div className="preview-toolbar">
                    <div className="address">
                      <span className="dot" />
                      {previewUrl || "localhost · siap saat Anda siap"}
                    </div>
                    {previewUrl ? (
                      <a
                        className="preview-new-tab"
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Buka preview dalam tab browser baru"
                        aria-label="Buka preview dalam tab browser baru"
                      >
                        <ArrowUpRight size={14} /> <span>Tab baru</span>
                      </a>
                    ) : (
                      <button
                        className="preview-new-tab"
                        disabled
                        title="Jalankan preview terlebih dahulu"
                        aria-label="Buka preview dalam tab browser baru (jalankan preview dahulu)"
                      >
                        <ArrowUpRight size={14} /> <span>Tab baru</span>
                      </button>
                    )}
                    <button
                      title="Ukuran preview"
                      aria-label="Ganti ukuran preview"
                      onClick={() => setMobile((v) => !v)}
                    >
                      <Monitor size={14} />
                    </button>
                    <button
                      title="Refresh preview"
                      aria-label="Refresh preview"
                      onClick={() => setFrameKey((v) => v + 1)}
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      disabled={!selected || busy || deploying}
                      className="preview-start"
                      onClick={
                        preview && preview.projectId === selected?.id
                          ? () =>
                              void run(async () => {
                                await api("preview/stop", {});
                                setPreview(null);
                              })
                          : startPreview
                      }
                    >
                      {preview && preview.projectId === selected?.id ? (
                        <Square size={12} />
                      ) : (
                        <Play size={12} />
                      )}{" "}
                      {preview && preview.projectId === selected?.id
                        ? "Stop"
                        : "Jalankan"}
                    </button>
                  </div>
                  {previewUrl ? (
                    <div className={"frame-wrap " + (mobile ? "mobile" : "")}>
                      <iframe
                        key={frameKey}
                        src={previewUrl}
                        title="Preview aplikasi lokal"
                        sandbox="allow-scripts allow-forms allow-same-origin"
                      />
                    </div>
                  ) : (
                    <div className="preview-empty">
                      <div className="preview-orbit">
                        <Monitor size={29} />
                        <span className="orbit-dot" />
                      </div>
                      <h2>Ide Anda, terlihat nyata.</h2>
                      <p>
                        Jalankan proyek untuk melihat hasilnya di sini.
                        <br />
                        Demo pertama sudah siap, tanpa install tambahan.
                      </p>
                      <button
                        className="primary"
                        disabled={!selected || busy || deploying}
                        onClick={startPreview}
                      >
                        <Play size={13} /> Jalankan preview
                      </button>
                      <small>LOCAL PREVIEW · HANYA DI KOMPUTER ANDA</small>
                    </div>
                  )}
                </>
              ) : tab === "files" ? (
                <div className="files-pane">
                  <div className="file-list">
                    {files.map((f) => (
                      <button
                        key={f}
                        className={file === f ? "selected-file" : ""}
                        onClick={() => void openFile(f)}
                      >
                        <FileCode2 size={13} />
                        {f}
                      </button>
                    ))}
                  </div>
                  <div className="file-content">
                    {file ? (
                      <>
                        <div className="file-toolbar">
                          <div className="file-meta">
                            <FileCode2 size={14} />
                            <span>
                              <strong>{file}</strong>
                              <small>
                                {source.split("\n").length} baris
                                {dirty ? " · belum disimpan" : " · tersimpan"}
                              </small>
                            </span>
                            {dirty && <i className="dirty-dot" />}
                          </div>
                          <div className="file-actions">
                            <button
                              title="Lihat hasil aplikasi"
                              disabled={!selected || busy}
                              onClick={() => setTab("preview")}
                            >
                              <Monitor size={13} /> Preview
                            </button>
                            {editing ? (
                              <>
                                <button disabled={busy} onClick={cancelEdit}>
                                  <RotateCcw size={13} /> Batal
                                </button>
                                <button
                                  className="primary"
                                  disabled={
                                    !dirty || busy || !!active || deploying
                                  }
                                  onClick={() => void run(saveFile)}
                                >
                                  <Save size={13} /> Simpan
                                </button>
                              </>
                            ) : (
                              <button
                                className="primary"
                                disabled={busy || !!active || deploying}
                                onClick={() => setEditing(true)}
                              >
                                <Pencil size={13} /> Edit kode
                              </button>
                            )}
                          </div>
                        </div>
                        {editing ? (
                          <MonacoCodeEditor
                            file={file}
                            value={source}
                            onChange={setSource}
                            theme={theme}
                            onSave={() => {
                              if (dirty && !busy && !active && !deploying)
                                void run(saveFile);
                            }}
                          />
                        ) : (
                          <div className="code-reader">
                            <pre aria-hidden="true" className="line-numbers">
                              {source
                                .split("\n")
                                .map((_, i) => i + 1)
                                .join("\n")}
                            </pre>
                            <pre className="code-view">{source}</pre>
                          </div>
                        )}
                        {editing && (
                          <div className="editor-tip">
                            <Sparkles size={12} /> Coba ubah teks atau warna,
                            lalu tekan ⌘S. Forge membuat checkpoint otomatis
                            agar aman untuk belajar.
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="code-empty">
                        <Code2 size={30} />
                        <h2>Belajar langsung dari kode.</h2>
                        <p>
                          Pilih file di sebelah kiri untuk membaca dan
                          mengeditnya. Simpan perubahan, lalu buka Preview untuk
                          melihat hasilnya.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : tab === "review" ? (
                <ReviewPanel
                  project={selected}
                  revision={reviewRevision}
                  busy={busy || !!active || deploying}
                  onBusy={setBusy}
                  onError={setError}
                  onApplied={async () => {
                    setReviewRevision((value) => value + 1);
                    if (selected) await refresh(selected);
                    setFrameKey((value) => value + 1);
                  }}
                />
              ) : tab === "deploy" ? (
                <DeployCenter
                  project={selected}
                  active={deployment}
                  securityRevision={securityRevision}
                  releaseRevision={releaseRevision}
                  busy={busy}
                  onBusy={setBusy}
                  onError={setError}
                  confirm={setConfirm}
                  onPrepare={(prompt) => {
                    setText(prompt);
                    setMode("build");
                    setTab("preview");
                  }}
                />
              ) : tab === "settings" ? (
                <IntegrationsPanel
                  project={selected}
                  onChanged={() => setIntegrationRevision((value) => value + 1)}
                  editorDirty={dirty}
                  onRestored={async (restored) => {
                    current.current = null;
                    setProjects(restored);
                    setSelected(null);
                    setPreview(null);
                    setFile("");
                    setSource("");
                    setSavedSource("");
                    setEditing(false);
                    setAttachments([]);
                    setMessages([]);
                    setHistory([]);
                    setFiles([]);
                    setIntegrationRevision((value) => value + 1);
                    if (restored[0]) {
                      current.current = restored[0];
                      setSelected(restored[0]);
                      await refresh(restored[0]);
                    }
                  }}
                  onSynced={async () => {
                    setFile("");
                    setSource("");
                    setSavedSource("");
                    setEditing(false);
                    if (selected) await refresh(selected);
                    setFrameKey((value) => value + 1);
                  }}
                  onProjectImported={(project) => {
                    setProjects((items) =>
                      items.some((item) => item.id === project.id)
                        ? items
                        : [...items, project],
                    );
                    void select(project);
                  }}
                />
              ) : (
                <div className="history">
                  <h2>Titik aman untuk bereksperimen.</h2>
                  <p>
                    Checkpoint otomatis sebelum Build dan restore. File rahasia
                    umum dikecualikan.
                  </p>
                  {history.length === 0 && (
                    <p>
                      Checkpoint pertama akan dibuat saat Anda mulai Build atau
                      klik Checkpoint.
                    </p>
                  )}
                  {history.map((h) => (
                    <div className="checkpoint" key={h.id}>
                      <GitBranch size={17} />
                      <div>
                        <strong>{h.label}</strong>
                        <small>
                          {new Date(h.date).toLocaleString("id-ID")} ·{" "}
                          {h.id.slice(0, 7)}
                        </small>
                      </div>
                      <button
                        disabled={!!active || busy || deploying}
                        onClick={() =>
                          setConfirm({
                            title: "Kembalikan ke checkpoint ini?",
                            body:
                              "File proyek akan dikembalikan ke " +
                              h.id.slice(0, 7) +
                              ". Forge menyimpan checkpoint kondisi sekarang terlebih dahulu. Preview akan dihentikan.",
                            action: async () => {
                              setHistory(
                                await api("restore", {
                                  projectId: selected!.id,
                                  id: h.id,
                                  confirmed: true,
                                }),
                              );
                              setPreview(null);
                              await refresh(selected!);
                            },
                          })
                        }
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {selected && <div style={{ display: tab === "preview" ? "block" : "none" }}>
                <BrowserTests key={selected.id} project={selected} preview={preview} events={events} />
              </div>}
            </div>
            <div className="activity">
              {agentProgress && (
                <div className={`agent-progress ${agentProgress.status}`} role="status" aria-live="polite">
                  <div className="agent-progress-copy">
                    {agentProgress.status === "active" ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                    <strong>{agentProgress.label}</strong>
                    {agentProgress.detail && <span>{agentProgress.detail}</span>}
                    <time>{elapsed}s</time>
                  </div>
                  <div className="agent-progress-track" aria-label={`${agentProgress.percent || 0}%`}>
                    <span style={{ width: `${Math.min(100, Math.max(0, agentProgress.percent || 0))}%` }} />
                  </div>
                </div>
              )}
              <div className="activity-header">
                <span>
                  <Terminal size={14} /> Aktivitas{" "}
                  <span className="event-count">{visibleEvents.length}</span>
                </span>
                <form
                  className="terminal-command"
                  onSubmit={(event) => {
                    event.preventDefault();
                    runTerminalCommand();
                  }}
                >
                  <span>$</span>
                  <input
                    aria-label="Command terminal"
                    placeholder="npm test"
                    value={terminalCommand}
                    onChange={(event) => setTerminalCommand(event.target.value)}
                    disabled={!selected || busy || !!active || deploying}
                  />
                  <button
                    disabled={
                      !selected ||
                      !terminalCommand.trim() ||
                      busy ||
                      !!active ||
                      deploying
                    }
                  >
                    Run
                  </button>
                </form>
                <button
                  type="button"
                  className={`approval-sound-toggle ${approvalSound ? "enabled" : ""}`}
                  title={approvalSound ? "Notifikasi suara persetujuan aktif" : "Aktifkan notifikasi suara persetujuan"}
                  aria-label={approvalSound ? "Matikan suara persetujuan" : "Aktifkan suara persetujuan"}
                  onClick={() => {
                    const next = !approvalSound;
                    approvalSoundEnabled.current = next;
                    setApprovalSound(next);
                    localStorage.setItem("forge-approval-sound", String(next));
                    if (next) void playApprovalSound(true);
                  }}
                >
                  {approvalSound ? <Bell size={12} /> : <BellOff size={12} />}
                  Suara izin
                </button>
                <span className="muted">
                  {active || deploying ? "● RUNNING" : "● IDLE"}
                </span>
              </div>
              <div className="activity-list">
                {visibleEvents.length === 0 ? (
                  <div className="activity-row">
                    <Check size={13} />
                    <span>Workspace siap. Mulai dari ide Anda.</span>
                    <time>sekarang</time>
                  </div>
                ) : (
                  visibleEvents
                    .slice(-40)
                    .reverse()
                    .map((e) => (
                      <details key={e.id}>
                        <summary>
                          <span
                            className={
                              "event-dot " +
                              (e.type.includes("error") ? "red" : "")
                            }
                          />
                          <span>{eventLabel(e)}</span>
                          <time>
                            {new Date(e.time).toLocaleTimeString("id-ID", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </summary>
                        <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                      </details>
                    ))
                )}
              </div>
            </div>
          </section>
        </div>
        <footer className="statusbar">
          <span>
            <span className={"dot " + (!stream ? "red" : "")} />
            {!stream ? "Menghubungkan ulang event stream…" : runtime}
          </span>
          <span>
            <ShieldCheck size={12} />{" "}
              {ai.provider.startsWith("api:")
                ? mode === "build"
                  ? "API Provider · approval tiap perubahan"
                  : "API Provider · read-only"
                : ai.provider === "gemini"
              ? mode === "build"
                ? "Gemini · approval default"
                : "Gemini · Plan read-only"
              : ["ollama", "bonsai"].includes(ai.provider)
                ? mode === "build"
                  ? "Local AI · izin tiap perubahan"
                  : "Local AI · read-only"
                : mode === "build"
                  ? "Workspace sandbox"
                  : "Read-only sandbox"}
            <span className="divider">|</span>
            <GitBranch size={12} /> Local checkpoints
          </span>
        </footer>
      </main>
      <GuideChat project={selected} ai={ai} mode={mode} webMode={webMode} ready={connected} integrationRevision={integrationRevision} />
      {(modal || confirm || deleting || clearingWorkspace) && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              clearingWorkspace ? "Hapus workspace" : deleting ? "Hapus proyek" : confirm?.title ||
              (modal === "new" ? "Proyek baru" : "Buka proyek")
            }
          >
            <button
              className="close-modal"
              disabled={busy}
              aria-label="Tutup dialog"
              onClick={() => {
                setModal(null);
                setConfirm(null);
                setDeleting(null);
                setClearingWorkspace(null);
                setDeleteConfirmation("");
                setWorkspaceConfirmation("");
              }}
            >
              <X size={18} />
            </button>
            <span className="modal-icon">
              {deleting || clearingWorkspace ? <Trash2 /> : confirm ? <ShieldCheck /> : <FolderOpen />}
            </span>
            <h2>
              {clearingWorkspace ? "Hapus seluruh Workspace?" : deleting ? `Hapus ${deleting.project.name}?` : confirm?.title ||
                (modal === "new"
                  ? "Mulai sesuatu yang baru."
                  : "Buka proyek lokal.")}
            </h2>
            <p>
              {clearingWorkspace
                ? clearingWorkspace.deleteFiles
                  ? `Seluruh ${projects.length} folder proyek beserta file-nya akan dipindahkan ke Trash macOS. Semua chat, memory agent, checkpoint, dan data per proyek di Forge juga dihapus. Backup dan pengaturan global tetap disimpan.`
                  : `Seluruh ${projects.length} proyek akan dihapus dari Workspace beserta chat, memory agent, checkpoint, dan data per proyek. Semua folder serta file proyek tetap berada di komputer.`
                : deleting
                ? deleting.deleteFiles
                  ? "Folder proyek beserta seluruh file akan dipindahkan ke Trash macOS. Chat, memory agent, checkpoint, dan data proyek di Forge juga dihapus. Backup Forge yang sudah ada tetap disimpan."
                  : "Proyek hanya dihapus dari daftar Forge beserta chat, memory agent, dan checkpoint-nya. Folder serta file proyek tetap berada di komputer."
                : confirm?.body ||
                (modal === "new"
                  ? "Beri nama proyek Anda. Forge menyiapkan demo Little Things dan folder lokal, siap untuk dikembangkan."
                  : "Masukkan path absolut folder proyek yang sudah ada.")}
            </p>
            {deleting && (
              <>
                <div className="delete-options">
                  <button className={!deleting.deleteFiles ? "chosen" : ""} onClick={() => setDeleting({ ...deleting, deleteFiles: false })}>
                    <Folder size={15} /> Hapus dari Forge saja
                    <small>Folder proyek tetap ada</small>
                  </button>
                  <button className={deleting.deleteFiles ? "chosen danger" : ""} onClick={() => setDeleting({ ...deleting, deleteFiles: true })}>
                    <Trash2 size={15} /> Folder dan semua file
                    <small>Dapat dipulihkan dari Trash Mac</small>
                  </button>
                </div>
                <label className="delete-confirmation">
                  Ketik <strong>{deleting.project.name}</strong> untuk konfirmasi
                  <input autoFocus value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} />
                </label>
              </>
            )}
            {clearingWorkspace && (
              <>
                <div className="delete-options">
                  <button className={!clearingWorkspace.deleteFiles ? "chosen" : ""} onClick={() => setClearingWorkspace({ deleteFiles: false })}>
                    <Folder size={15} /> Kosongkan Workspace
                    <small>Semua folder proyek tetap ada</small>
                  </button>
                  <button className={clearingWorkspace.deleteFiles ? "chosen danger" : ""} onClick={() => setClearingWorkspace({ deleteFiles: true })}>
                    <Trash2 size={15} /> Workspace dan semua folder
                    <small>Dapat dipulihkan dari Trash Mac</small>
                  </button>
                </div>
                <label className="delete-confirmation">
                  Ketik <strong>HAPUS WORKSPACE</strong> untuk konfirmasi
                  <input autoFocus value={workspaceConfirmation} onChange={(e) => setWorkspaceConfirmation(e.target.value)} />
                </label>
              </>
            )}
            {!confirm && !deleting && !clearingWorkspace && (
              <input
                autoFocus
                aria-label={modal === "new" ? "Nama proyek" : "Path folder"}
                placeholder={
                  modal === "new"
                    ? "Contoh: Palita"
                    : "/Users/anda/Projects/palita"
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy && name.trim()) void create();
                }}
              />
            )}
            <button
              className="primary modal-submit"
              disabled={busy || (clearingWorkspace
                ? workspaceConfirmation !== "HAPUS WORKSPACE"
                : deleting ? deleteConfirmation !== deleting.project.name : !confirm && !name.trim())}
              onClick={() =>
                clearingWorkspace
                  ? void clearWorkspace()
                  : deleting
                  ? void deleteSelectedProject()
                  : confirm
                  ? void run(async () => {
                      await confirm.action();
                      setConfirm(null);
                    })
                  : void create()
              }
            >
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : deleting || clearingWorkspace ? (
                <Trash2 size={15} />
              ) : confirm ? (
                <ShieldCheck size={15} />
              ) : (
                <Plus size={15} />
              )}{" "}
              {clearingWorkspace
                ? clearingWorkspace.deleteFiles ? "Pindahkan semua ke Trash" : "Kosongkan Workspace"
                : deleting
                ? deleting.deleteFiles ? "Pindahkan ke Trash" : "Hapus dari Forge"
                : confirm
                ? "Lanjutkan"
                : modal === "new"
                  ? "Buat proyek"
                  : "Buka proyek"}
            </button>
            {error && <p className="modal-error">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
function eventLabel(e: ForgeEvent) {
  const p = e.payload;
  if (e.type === "codex") {
    const method = p.method as string;
    const names: Record<string, string> = {
      "turn/started": "Agent mulai bekerja",
      "turn/completed": "Proses selesai",
      "item/agentMessage/delta": "Menulis jawaban",
      "item/commandExecution/outputDelta": "Output command",
      "item/started": "Memulai langkah",
      "item/completed": "Langkah selesai",
      "turn/diff/updated": "Perubahan file diperbarui",
      "turn/plan/updated": "Rencana diperbarui",
      "tool/budgetWarning": p.params?.message || "Agent sedang menyelesaikan pekerjaan",
    };
    return (
      (names[method] || method) +
      (p.params?.item?.type ? " · " + p.params.item.type : "")
    );
  }
  return (
    (
      {
        approval: "Menunggu persetujuan",
        checkpoint: "Checkpoint otomatis tersimpan",
        preview: "Status preview berubah",
        "preview-log": "Dev server output",
        "build-finished": p.ok ? "Build selesai · siap diuji" : "Build gagal",
        "build-task-started": "Worktree Build terisolasi dibuat",
        "build-review-ready": `Review siap · ${p.files || 0} file berubah`,
        "build-task-failed": `Build gagal · ${p.error || "periksa detail"}`,
        "build-task-applied": p.complete ? "Perubahan Build diterapkan" : "Sebagian perubahan diterapkan",
        "build-task-discarded": "Hasil Build dibuang",
        "orchestration-task": p.phase === "specialists" ? "Tim agent memeriksa proyek" : p.phase === "builder" ? "Builder mulai mengerjakan" : `Tim agent · ${p.status}`,
        "orchestration-agent": `${p.label || p.role} · ${p.status}`,
        "orchestration-action": `${p.role || "agent"} · ${p.action || "aksi"}`,
        "browser-result": p.ok ? "Uji browser lulus" : "Uji browser menemukan masalah",
        "approval-resolved": "Persetujuan diproses",
        "manual-edit": "Kode manual disimpan",
        "terminal-started": `Terminal · ${p.command || "command"}`,
        "terminal-output": "Output terminal",
        "terminal-completed": p.ok ? "Command selesai" : "Command gagal",
        github: `GitHub · ${p.action || "activity"}`,
        mcp: `MCP · ${p.action || "activity"}`,
        "web-research": p.status === "started" ? "Memeriksa kebutuhan sumber web" : `Sumber web · ${p.count} ditemukan`,
        "agent-progress": `${p.label}${p.detail ? ` · ${p.detail}` : ""}`,
        "deploy-started": p.operation === "rollback" ? "Rollback dimulai" : "Deploy dimulai",
        "deploy-log": "Output deploy",
        "deploy-completed": p.operation === "rollback" ? (p.ok ? "Rollback selesai" : "Rollback gagal") : (p.ok ? "Deploy selesai" : "Deploy gagal"),
      } as Record<string, string>
    )[e.type] ||
    p.message ||
    e.type
  );
}
