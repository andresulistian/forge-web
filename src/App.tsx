import AttachmentPicker, { type Attachment } from "./Attachments";
import AiPicker, { initialAi } from "./AiPicker";
import GuideChat from "./GuideChat";
import DeployCenter from "./DeployCenter";
import BrowserTests from "./BrowserTests";
const MonacoCodeEditor = lazy(() => import("./MonacoCodeEditor"));
import IntegrationsPanel from "./IntegrationsPanel";
import PreviewAnnotations, {
  type PreviewAnnotation,
} from "./PreviewAnnotations";
import AgentCenter from "./AgentCenter";
import VisualReview from "./VisualReview";
import { workflowStatus, type VisualState, type EditTarget } from "./workflow";
import { DraftController } from "./session-draft";
import KanbanPanel from "./KanbanPanel";
import { playApprovalSound, unlockNotificationAudio } from "./notifications";
import { useEffect, useRef, useState, Suspense, lazy } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Bell,
  BellOff,
  Bot,
  Check,
  ChevronRight,
  Code2,
  Columns3,
  Crosshair,
  ExternalLink,
  FileCode2,
  Flame,
  Folder,
  FolderOpen,
  Globe2,
  GitBranch,
  History,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
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
type Theme = "dark" | "light";
type WorkspaceView = "builder" | "chat";
type AgentMode = "single" | "multi";
type TeamState = Record<string, { status: string; detail: string }>;
type DeployResult = {
  projectId: string;
  url: string;
  environment?: string;
  provider?: string;
};
const providerName = (provider?: string) =>
  provider === "gemini"
    ? "Gemini"
    : provider === "ollama"
      ? "Local AI"
      : provider?.startsWith("api:")
        ? "API Provider"
        : "Codex";
const hints = {
  ask: "Tanya dan pelajari proyek. File tidak diubah.",
  plan: "Susun rencana sebelum mulai. File tidak diubah.",
  build: "Agent membaca, mengedit, dan menguji proyek.",
};
export default function App() {
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
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("forge-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  });
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() =>
    localStorage.getItem("forge-workspace-view") === "chat"
      ? "chat"
      : "builder",
  );
  const [agentMode, setAgentMode] = useState<AgentMode>(() =>
    localStorage.getItem("forge-agent-mode") === "multi" ? "multi" : "single",
  );
  const [teamState, setTeamState] = useState<TeamState>({});
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
  const [usageRevision, setUsageRevision] = useState(0);
  const [agentRevision, setAgentRevision] = useState(0);
  const [kanbanRevision, setKanbanRevision] = useState(0);
  const [kanbanTaskId, setKanbanTaskId] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [deployment, setDeployment] = useState<any>(null);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [modal, setModal] = useState<"new" | "open" | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{
      title: string;
      body: string;
      action: () => Promise<void>;
    } | null>(null),
    [deleting, setDeleting] = useState<{
      project: Project;
      deleteFiles: boolean;
    } | null>(null),
    [deleteConfirmation, setDeleteConfirmation] = useState(""),
    [clearingWorkspace, setClearingWorkspace] = useState<{
      deleteFiles: boolean;
    } | null>(null),
    [workspaceConfirmation, setWorkspaceConfirmation] = useState(""),
    [resolvingApproval, setResolvingApproval] = useState<string | null>(null),
    [connected, setConnected] = useState(false),
    [live, setLive] = useState(""),
    [mobile, setMobile] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotations, setAnnotations] = useState<PreviewAnnotation[]>([]);
  const [notificationSound, setNotificationSound] = useState(
    () => localStorage.getItem("forge-approval-sound") !== "off",
  );
  const notificationSoundRef = useRef(notificationSound);
  const current = useRef<Project | null>(null);
  const draftController = useRef<DraftController | null>(null);
  const [draftReady, setDraftReady] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState("Memulihkan draft…");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [visualState, setVisualState] = useState<VisualState | null>(null);
  const [hasDesign, setHasDesign] = useState(false);
  const [visualOpen, setVisualOpen] = useState(false);
  const flow = workflowStatus(visualState?.run || null, visualState?.captures || [], messages.some(m => m.role === "user" && ["ask", "plan"].includes(m.mode || "")), hasDesign);
  const refreshVisual = async (p: Project) => {
    const value = await api<VisualState>(`visual?projectId=${p.id}`);
    if (current.current?.id === p.id) setVisualState(value);
  };
  useEffect(() => {
    if (!selected) return;
    const p = selected; let alive = true;
    void refreshVisual(p).catch(e => { if (alive) setError(e.message); });
    void api(`design-identity?projectId=${p.id}`).then(value => { if (alive && current.current?.id === p.id) setHasDesign(value.exists === true && !value.needsImport); }).catch(() => {});
    const timer = active ? setInterval(() => void refreshVisual(p).catch(() => {}), 2500) : undefined;
    return () => { alive = false; clearInterval(timer); };
  }, [selected?.id, agentRevision, active]);
  useEffect(() => {
    const controller = draftController.current;
    if (!selected || draftReady !== selected.id || controller?.projectId !== selected.id) return;
    controller.edit({ text, mode, ...ai, tab, target: editTarget ? { captureId: editTarget.captureId, index: editTarget.index } : null });
    setDraftStatus("Menyimpan draft…");
    const timer = setTimeout(() => void controller.flush().then(() => { if (draftController.current === controller) setDraftStatus("Draft tersimpan lokal di server"); }).catch(e => { if (draftController.current === controller) setDraftStatus(`Draft belum tersimpan: ${e.message}`); }), 350);
    return () => clearTimeout(timer);
  }, [selected?.id, draftReady, text, mode, ai.provider, ai.model, tab, editTarget]);
  useEffect(() => {
    const flush = () => { void draftController.current?.flush().catch(() => {}); };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
  const bottom = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("forge-theme", theme);
  }, [theme]);
  useEffect(() => {
    notificationSoundRef.current = notificationSound;
    localStorage.setItem(
      "forge-approval-sound",
      notificationSound ? "on" : "off",
    );
  }, [notificationSound]);
  useEffect(() => {
    const unlock = () => void unlockNotificationAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
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
  const resetProjectState = (nextProject?: Project | null) => {
    if (nextProject) {
      revision.current++;
      current.current = nextProject;
      setSelected(nextProject);
    } else {
      current.current = null;
      setSelected(null);
    }
    setDraftReady(null);
    setEditTarget(null);
    setVisualState(null);
    setHasDesign(false);
    setText("");
    setAttachments([]);
    setAnnotations([]);
    setAnnotationMode(false);
    setLive("");
    setFile("");
    setSource("");
    setSavedSource("");
    setEditing(false);
    setMessages([]);
    setHistory([]);
    setFiles([]);
    setApprovals([]);
    setTeamState({});
    setPreview(null);
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
  const refreshFiles = async (projectId: string) => {
    const p = current.current;
    if (!p || p.id !== projectId) return;
    const list = await api<string[]>("files?projectId=" + p.id);
    setFiles(list);
    if (file && list.includes(file) && !dirty) {
      try {
        const r = await api<{ text: string }>(
          "file?projectId=" + p.id + "&file=" + encodeURIComponent(file),
        );
        if (current.current?.id === p.id) {
          setSource(r.text);
          setSavedSource(r.text);
        }
      } catch {
        /* ignore missing file */
      }
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
    await draftController.current?.flush();
    resetProjectState(p);
    const controller = new DraftController(p.id, api);
    draftController.current = controller;
    await controller.load();
    if (current.current?.id !== p.id || draftController.current !== controller) return false;
    if (controller.conflict && !window.confirm("Ada draft lokal belum terkirim yang berbeda dari server. Pulihkan draft lokal? Batal memakai versi server. Tidak ada Build yang dikirim.")) controller.discardLocal();
    const draft = controller.draft;
    if (current.current?.id !== p.id || draftController.current !== controller) return false;
    setText(draft.text);
    setMode((["ask", "plan", "build"].includes(draft.mode || "") ? draft.mode : "build") as Mode);
    setAi({ provider: draft.provider || "codex", model: draft.model || "" });
    setTab(draft.tab || "preview");
    if (draft.target) {
      try { const target = await api<EditTarget>("visual/target", { projectId: p.id, ...draft.target }); if (current.current?.id === p.id) setEditTarget(target); }
      catch { setDraftStatus("Target lama tidak valid; ambil screenshot baru."); }
    }
    if (current.current?.id !== p.id) return false;
    setDraftReady(p.id);
    await refresh(p);
    const state = await api("state");
    if (current.current?.id === p.id) setPreview(state.preview);
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
        setConnected(true);
        const recovered = state.projects.find((p: Project) => p.id === state.session?.projectId) || state.projects[0];
        if (recovered) await select(recovered);
        void subscribe(
          abort.signal,
          (e) => {
            if (e.type === "session-state") {
              setActive(e.payload.active?.projectId || null);
              setPreview(e.payload.preview);
              setApprovals(e.payload.approvals);
              setDeployment(e.payload.deployment || null);
              setLive("");
              setAgentRevision(v => v + 1);
              if (current.current) void refresh(current.current).catch(err => setError(err.message));
              return;
            }
            if (e.type === "guide") return;
            if (
              !e.payload.method?.endsWith("/delta") &&
              !e.payload.method?.endsWith("outputDelta")
            )
              setEvents((v) => [...v.slice(-199), e]);
            const p = e.payload;
            if (e.type === "approval") {
              if (notificationSoundRef.current) playApprovalSound();
              setApprovals((v) =>
                v.some((a) => a.id === p.id) ? v : [...v, p],
              );
            }
            if (e.type === "approval-resolved")
              setApprovals((v) => v.filter((a) => a.id !== p.id));
            if (
              ["agent-activity", "review-updated", "checkpoint", "visual-updated"].includes(e.type) ||
              (e.type === "codex" && p.method === "turn/completed")
            )
              setAgentRevision((value) => value + 1);
            if (e.type === "kanban-updated" && current.current?.id === p.projectId)
              setKanbanRevision((value) => value + 1);
            if (e.type === "preview") setPreview(p.url ? p : null);
            if (e.type === "deploy-started") {
              setDeployment(p);
              if (p.projectId === current.current?.id) setDeployResult(null);
            }
            if (e.type === "agent-team" && p.projectId === current.current?.id)
              setTeamState((value) => ({
                ...value,
                [p.role || "lead"]: {
                  status: p.status || "working",
                  detail: p.detail || "",
                },
              }));
            if (e.type === "security-result") setSecurityRevision((v) => v + 1);
            if (e.type === "github") {
              // Refresh GitHub panel and file list after backup/import/pull
              if (current.current) void refreshFiles(current.current.id);
            }
            if (
              e.type === "project-files-changed" &&
              current.current?.id === p.projectId
            ) {
              void refreshFiles(p.projectId);
            }
            if (
              e.type === "web-research" &&
              p.status === "completed" &&
              current.current?.id === p.projectId
            ) {
              const project = current.current;
              if (project)
                void refresh(project).catch((cause) => setError(cause.message));
            }
            if (e.type === "deploy-completed") {
              setDeployment(null);
              setReleaseRevision((value) => value + 1);
              if (!p.ok) setError(p.error || "Deploy gagal.");
              else if (p.url && p.projectId === current.current?.id) {
                setError("");
                setDeployResult({
                  projectId: p.projectId,
                  url: p.url,
                  environment: p.environment,
                  provider: p.provider,
                });
              }
            }
            if (e.type === "runtime-error") {
              setActive(null);
              setApprovals([]);
              setError(p.message);
              setAttachments([]);
              setRuntime(`${providerName(p.provider)} terputus`);
            }
            if (e.type === "codex") {
              if (
                [
                  "gemini/usage_update",
                  "account/rateLimits/updated",
                  "turn/completed",
                ].includes(p.method)
              )
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
        ).catch(e => { if (alive) { setStream(false); setError(e.message); } });
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (modal || confirm || deleting || clearingWorkspace)) {
        event.preventDefault();
        setModal(null);
        setConfirm(null);
        setDeleting(null);
        setClearingWorkspace(null);
        setDeleteConfirmation("");
        setWorkspaceConfirmation("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, confirm, deleting, clearingWorkspace]);

  const send = () =>
    run(async () => {
      if (!selected || (!text.trim() && !attachments.length)) return;
      const value =
        text.trim() || "Analisis lampiran ini dan jelaskan temuan Anda.";
      setText("");
      setTeamState(
        agentMode === "multi" && mode === "build"
          ? {
              lead: {
                status: "queued",
                detail: "Menyiapkan tim multi-agent",
              },
            }
          : {},
      );
      setActive(selected.id);
      setMessages((v) => [
        ...v,
        {
          role: "user",
          text: value,
          mode,
          provider: ai.provider,
          model: ai.model,
          multiAgent:
            agentMode === "multi" && mode === "build" && multiAgentSupported,
          attachments,
        },
      ]);
      try {
        await api("chat", {
          projectId: selected.id,
          text: value,
          mode,
          webMode,
          multiAgent:
            agentMode === "multi" && mode === "build" && multiAgentSupported,
          orchestrationMode:
            localStorage.getItem("forge-orchestration-mode") || "balanced",
          ...(mode === "build" && kanbanTaskId ? { kanbanTaskId } : {}),
          ...ai,
          attachments: attachments.map((a) => a.id),
        });
        setAttachments([]);
        setKanbanTaskId(null);
        setRuntime(`${providerName(ai.provider)} tersambung · ${ai.model}`);
      } catch (e) {
        setActive(null);
        setText(value);
        await refresh(selected);
        throw e;
      }
    });
  const retryAgent = (request: Record<string, unknown>) =>
    run(async () => {
      if (!selected || active) return;
      if (!window.confirm("Jalankan ulang permintaan ini sebagai run baru? Tidak ada aksi dilanjutkan otomatis.")) return;
      const value = String(request.text || "").trim();
      if (!value) return;
      const nextMode = ["ask", "plan", "build"].includes(String(request.mode))
        ? (request.mode as Mode)
        : "build";
      const provider = String(request.provider || ai.provider);
      const model = String(request.model || ai.model);
      const nextWebMode = ["auto", "web", "off"].includes(String(request.webMode))
        ? (request.webMode as WebMode)
        : webMode;
      const multiAgent = request.multiAgent === true && nextMode === "build";
      setMode(nextMode);
      setWebMode(nextWebMode);
      setAi({ provider, model });
      setActive(selected.id);
      setMessages((items) => [
        ...items,
        { role: "user", text: value, mode: nextMode, provider, model, multiAgent },
      ]);
      try {
        await api("chat", {
          projectId: selected.id,
          text: value,
          mode: nextMode,
          webMode: nextWebMode,
          provider,
          model,
          multiAgent,
          attachments: [],
        });
      } catch (error) {
        setActive(null);
        await refresh(selected);
        throw error;
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
      const result = await api<{ projects: Project[]; deletedFiles: boolean }>(
        "projects/delete",
        {
          projectId: deleting.project.id,
          deleteFiles: deleting.deleteFiles,
          confirmationName: deleteConfirmation,
          confirmed: true,
        },
      );
      setProjects(result.projects);
      setDeleting(null);
      setDeleteConfirmation("");
      resetProjectState(null);
      if (result.projects[0]) await select(result.projects[0]);
      setRuntime(
        result.deletedFiles
          ? "Proyek dan folder dipindahkan ke Trash · nama dapat digunakan kembali"
          : "Proyek dihapus dari daftar Forge",
      );
    });
  const clearWorkspace = () =>
    run(async () => {
      if (!clearingWorkspace) return;
      const result = await api<{
        projects: Project[];
        deletedFiles: boolean;
        count: number;
      }>("projects/clear", {
        deleteFiles: clearingWorkspace.deleteFiles,
        confirmationText: workspaceConfirmation,
        confirmed: true,
      });
      setProjects(result.projects);
      setClearingWorkspace(null);
      setWorkspaceConfirmation("");
      resetProjectState(null);
      setRuntime(
        result.deletedFiles
          ? `${result.count} folder proyek dipindahkan ke Trash · nama dapat digunakan kembali`
          : `${result.count} proyek dihapus dari Workspace`,
      );
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
          setAnnotations([]);
          setAnnotationMode(false);
          setTab("preview");
        },
      });
    });
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
      const rev = ++revision.current;
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
  const multiAgentSupported =
    ai.provider === "codex" || ai.provider.startsWith("api:");
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Flame size={23} />
          </span>
          forge<span className="alpha">PERSONAL</span>
        </div>
        <div className="workspace-switcher" aria-label="Ruang kerja Forge">
          <button
            className={workspaceView === "builder" ? "active" : ""}
            onClick={() => {
              setWorkspaceView("builder");
              localStorage.setItem("forge-workspace-view", "builder");
            }}
          >
            <Code2 size={14} /> Builder
          </button>
          <button
            className={workspaceView === "chat" ? "active" : ""}
            onClick={() => {
              setWorkspaceView("chat");
              localStorage.setItem("forge-workspace-view", "chat");
            }}
          >
            <MessageSquare size={14} /> Dedicated Chat
          </button>
        </div>
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
                setClearingWorkspace({ deleteFiles: true });
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
              Personal workspace<small>Forge · v0.9.0</small>
            </div>
            <span className="dot" />
          </div>
        </div>
      </aside>
      <main className={workspaceView === "chat" ? "dedicated-mode" : ""}>
        <header className="topbar">
          <div className="breadcrumb">
            <Folder size={14} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{selected?.name || "Mulai proyek baru"}</strong>
          </div>
          <div className="top-actions">
            <button
              className="sound-toggle"
              aria-label={
                notificationSound
                  ? "Matikan suara persetujuan"
                  : "Aktifkan suara persetujuan"
              }
              title={
                notificationSound
                  ? "Notifikasi izin bersuara"
                  : "Notifikasi izin tanpa suara"
              }
              onClick={() => {
                void unlockNotificationAudio();
                setNotificationSound((value) => !value);
              }}
            >
              {notificationSound ? <Bell size={14} /> : <BellOff size={14} />}
              Izin
            </button>
            <button
              className="theme-toggle"
              aria-label={
                theme === "dark" ? "Aktifkan light mode" : "Aktifkan dark mode"
              }
              title={theme === "dark" ? "Light mode" : "Dark mode"}
              onClick={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              {theme === "dark" ? "Terang" : "Gelap"}
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
                setDeleting({ project: selected, deleteFiles: true });
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
        {deployResult && deployResult.projectId === selected?.id && (
          <div className="deploy-result" role="status">
            <Check size={15} />
            <span>
              <strong>
                {deployResult.provider === "cloudflare" &&
                deployResult.environment === "preview"
                  ? "Cloudflare Preview siap:"
                  : "Deploy berhasil:"}
              </strong>
              <a
                href={deployResult.url}
                target="_blank"
                rel="noreferrer"
              >
                {deployResult.url}
              </a>
            </span>
            <a
              className="deploy-result-open"
              href={deployResult.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Buka hasil deploy"
            >
              Buka Preview <ExternalLink size={13} />
            </a>
            <button
              aria-label="Tutup link deploy"
              onClick={() => setDeployResult(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <div
          className={
            "workspace " + (workspaceView === "chat" ? "dedicated-chat" : "")
          }
        >
          <section className="chat">
            <div className="panel-heading">
              <span>
                {workspaceView === "chat" ? (
                  <>
                    <MessageSquare size={16} /> Dedicated Chat
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Builder
                  </>
                )}
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
                      {m.multiAgent && <span>MULTI-AGENT</span>}
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
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            key={source.url}
                          >
                            [{index + 1}] {source.title} <Globe2 size={11} />
                          </a>
                        ))}
                        {m.checkedAt && (
                          <small>
                            Diperiksa{" "}
                            {new Date(m.checkedAt).toLocaleString("id-ID")}
                          </small>
                        )}
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
                                : a.kind === "archive"
                                  ? "◇"
                                  : a.kind === "code"
                                    ? "⌘"
                                    : a.kind === "document"
                                      ? "▤"
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
              {!!Object.keys(teamState).length && (
                <div
                  className="agent-team-status"
                  aria-label="Status multi-agent"
                >
                  <div className="agent-team-title">
                    <Users size={15} /> Multi-Agent Team
                  </div>
                  {(["lead", "explorer", "builder", "reviewer"] as const)
                    .filter((role) => teamState[role])
                    .map((role) => (
                      <div className="agent-team-row" key={role}>
                        <span
                          className={`agent-state ${teamState[role].status}`}
                        />
                        <strong>{role[0].toUpperCase() + role.slice(1)}</strong>
                        <small>
                          {teamState[role].detail || teamState[role].status}
                        </small>
                      </div>
                    ))}
                </div>
              )}
              <div ref={bottom} />
            </div>
            {active === selected?.id && (
              <section
                className="agent-progress"
                role="status"
                aria-live="polite"
                aria-label="Progress agent Forge"
              >
                <div className="agent-progress-heading">
                  <Loader2 size={15} className="spin" />
                  <span>
                    <strong>Forge sedang bekerja…</strong>
                    <small>
                      {visibleEvents.length
                        ? eventLabel(visibleEvents[visibleEvents.length - 1])
                        : "Menganalisis permintaan"}
                    </small>
                  </span>
                  <b>{live ? "MENULIS" : "MEMPROSES"}</b>
                </div>
                <div className="agent-progress-track" aria-hidden="true">
                  <span />
                </div>
                {!!visibleEvents.length && (
                  <div className="agent-progress-steps">
                    {visibleEvents
                      .slice(-3)
                      .reverse()
                      .map((event) => (
                        <span key={event.id}>
                          <i /> {eventLabel(event)}
                        </span>
                      ))}
                  </div>
                )}
              </section>
            )}
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
              <div className="composer">
                <AttachmentPicker
                  projectId={selected?.id}
                  items={attachments}
                  onChange={setAttachments}
                  disabled={busy || !!active || deploying}
                  onBusy={setBusy}
                  onError={setError}
                />
                <textarea
                  aria-label="Pesan untuk Forge"
                  id="forge-composer"
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setKanbanTaskId(null);
                  }}
                  onInput={(event) => {
                    event.currentTarget.style.height = "auto";
                    event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
                  }}
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
                      if (!active && !busy && !deploying && stream) void send();
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
                    className="agent-mode"
                    aria-label="Mode agent"
                    title="Multi-Agent memakai Lead, Explorer, Builder, dan Reviewer seperti workflow Codex. Hanya aktif pada Build."
                    value={multiAgentSupported ? agentMode : "single"}
                    disabled={
                      mode !== "build" || !!active || !multiAgentSupported
                    }
                    onChange={(event) => {
                      const next = event.target.value as AgentMode;
                      setAgentMode(next);
                      localStorage.setItem("forge-agent-mode", next);
                    }}
                  >
                    <option value="single">Single Agent</option>
                    <option value="multi">
                      Multi-Agent · Codex/Vikey/OpenRouter
                    </option>
                  </select>
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
                {hints[mode]} · {draftStatus}
                <span>↵ Kirim</span>
              </div>
            </div>
          </section>
          <section className="right-pane">
            <nav className="workflow-strip" aria-label="Brief Design Build Review">
              <div className="workflow-steps">
                <button disabled={!selected} onClick={() => { setMode("plan"); document.getElementById("forge-composer")?.focus(); }}><strong>1 · Brief</strong><small>{flow.brief}</small></button>
                <button disabled={!selected} onClick={() => setTab("agent")}><strong>2 · Design</strong><small>{flow.design}</small></button>
                <button disabled={!selected || !!active} onClick={() => { setMode("build"); document.getElementById("forge-composer")?.focus(); }}><strong>3 · Build</strong><small>{flow.build}</small></button>
                <button disabled={!selected} onClick={() => { setTab("preview"); setVisualOpen(true); }}><strong>4 · Review{flow.accepted ? " · Accepted" : ""}</strong><small>{flow.review}</small></button>
              </div><p className="workflow-next">Berikutnya: {flow.next}</p>
            </nav>
            <div className="tabs">
              {[
                { id: "preview", icon: Monitor, label: "Preview" },
                { id: "files", icon: Code2, label: "Kode" },
                { id: "kanban", icon: Columns3, label: "Kanban" },
                { id: "deploy", icon: Rocket, label: "Deploy" },
                { id: "agent", icon: Bot, label: "Agent" },
                { id: "history", icon: History, label: "Checkpoint" },
                { id: "settings", icon: Settings2, label: "Pengaturan" },
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
            </div>
            <div className="workbench">
              {tab === "preview" ? (
                <>
                  {selected && visualState && <details className="visual-entry" open={visualOpen} onToggle={e => setVisualOpen(e.currentTarget.open)}><summary>Screenshot · before / after · click-to-edit</summary><VisualReview key={selected.id} project={selected} state={visualState} active={!!active} ai={ai} target={editTarget} onTarget={target => { if (current.current?.id === selected.id) setEditTarget(target); }} onCompose={value => { if (current.current?.id === selected.id) { setText(old => old.trim() ? `${old}\n\n${value}` : value); setMode("build"); document.getElementById("forge-composer")?.focus(); } }} onChanged={() => refreshVisual(selected)} onProjectChanged={() => refresh(selected)} /></details>}
                  <div className="preview-toolbar">
                    <div className="address">
                      <span className="dot" />
                      {preview && preview.projectId === selected?.id
                        ? preview.url
                        : "localhost · siap saat Anda siap"}
                    </div>
                    <button
                      disabled={!preview || preview.projectId !== selected?.id}
                      className={annotationMode ? "annotation-active" : ""}
                      title="Annotation preview"
                      aria-label="Annotation preview"
                      onClick={() => setAnnotationMode((value) => !value)}
                    >
                      <Crosshair size={14} />
                    </button>
                    <button
                      disabled={!preview || preview.projectId !== selected?.id}
                      title="Buka preview di tab baru"
                      aria-label="Buka preview di tab baru"
                      onClick={() =>
                        window.open(
                          preview!.url,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      <ArrowUpRight size={14} />
                    </button>
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
                  {preview && preview.projectId === selected?.id ? (
                    <div className={"frame-wrap " + (mobile ? "mobile" : "")}>
                      <div className="preview-canvas">
                        <iframe
                          key={frameKey}
                          src={preview.url}
                          title="Preview aplikasi lokal"
                          sandbox="allow-scripts allow-forms allow-same-origin"
                        />
                        <PreviewAnnotations
                          enabled={annotationMode}
                          annotations={annotations}
                          onChange={setAnnotations}
                        />
                      </div>
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
                  {!!annotations.length && (
                    <div className="annotation-summary">
                      <span>
                        {annotations.length} annotation · klik marker untuk edit
                      </span>
                      <button
                        onClick={() => {
                          const details = annotations
                            .map(
                              (item, index) =>
                                `${index + 1}. Posisi ${item.x.toFixed(1)}% dari kiri, ${item.y.toFixed(1)}% dari atas: ${item.note.trim() || "Belum ada catatan"}`,
                            )
                            .join("\n");
                          const context = `Perbaiki UI berdasarkan annotation preview berikut. Preview: ${preview?.url}. Viewport: ${mobile ? "mobile 375px" : "desktop"}.\n${details}`;
                          setText((value) =>
                            value.trim()
                              ? `${value.trim()}\n\n${context}`
                              : context,
                          );
                          setMode("build");
                          setAnnotationMode(false);
                        }}
                      >
                        <MessageSquare size={13} /> Kirim ke chat
                      </button>
                      <button onClick={() => setAnnotations([])}>
                        Hapus semua
                      </button>
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
                          <Suspense
                            fallback={
                              <div className="code-empty">
                                <Loader2 size={22} className="spin" /> Memuat editor…
                              </div>
                            }
                          >
                            <MonacoCodeEditor
                              file={file}
                              value={source}
                              theme={theme}
                              onChange={setSource}
                              onSave={() => {
                                if (dirty && !busy && !active && !deploying)
                                  void run(saveFile);
                              }}
                            />
                          </Suspense>
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
                    setProjects(restored);
                    resetProjectState(restored[0] || null);
                    setIntegrationRevision((value) => value + 1);
                    if (restored[0]) await refresh(restored[0]);
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
              ) : tab === "kanban" ? (
                <KanbanPanel
                  project={selected}
                  revision={kanbanRevision}
                  busy={busy || !!active}
                  onError={setError}
                  onUse={(task) => {
                    setMode("build");
                    setText(task.request);
                    setKanbanTaskId(task.id);
                  }}
                />
              ) : tab === "agent" ? (
                <AgentCenter
                  project={selected}
                  active={active === selected?.id}
                  busy={busy}
                  revision={agentRevision}
                  onBusy={setBusy}
                  onError={setError}
                  onRetry={(request) => void retryAgent(request)}
                  onUseSkill={(command) => {
                    setText(`${command} `);
                    setMode("build");
                  }}
                  onProjectChanged={async () => {
                    if (selected) await refresh(selected);
                    setPreview(null);
                    setFrameKey((value) => value + 1);
                    setAgentRevision((value) => value + 1);
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
              {selected && (
                <div style={{ display: tab === "preview" ? "block" : "none" }}>
                  <BrowserTests
                    key={selected.id}
                    project={selected}
                    preview={preview}
                    events={events}
                  />
                </div>
              )}
            </div>
            <div className="activity">
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
                ? "OpenRouter · izin tiap perubahan"
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
      <GuideChat
        project={selected}
        ai={ai}
        mode={mode}
        webMode={webMode}
        ready={connected}
        integrationRevision={integrationRevision}
      />
      {(modal || confirm || deleting || clearingWorkspace) && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              clearingWorkspace
                ? "Hapus workspace"
                : deleting
                  ? "Hapus proyek"
                  : confirm?.title ||
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
              {deleting || clearingWorkspace ? (
                <Trash2 />
              ) : confirm ? (
                <ShieldCheck />
              ) : (
                <FolderOpen />
              )}
            </span>
            <h2>
              {clearingWorkspace
                ? "Hapus seluruh Workspace?"
                : deleting
                  ? `Hapus ${deleting.project.name}?`
                  : confirm?.title ||
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
                    ? "Folder proyek beserta seluruh file akan dipindahkan ke Trash macOS. Chat, memory agent, checkpoint, dan data proyek di Forge juga dihapus. Nama proyek langsung dapat digunakan kembali. Backup Forge yang sudah ada tetap disimpan."
                    : "Proyek hanya dihapus dari daftar Forge beserta chat, memory agent, dan checkpoint-nya. Folder serta file proyek tetap berada di komputer."
                  : confirm?.body ||
                    (modal === "new"
                      ? "Beri nama proyek Anda. Forge menyiapkan demo Little Things dan folder lokal, siap untuk dikembangkan."
                      : "Masukkan path absolut folder proyek yang sudah ada.")}
            </p>
            {deleting && (
              <>
                <div className="delete-options">
                  <button
                    className={!deleting.deleteFiles ? "chosen" : ""}
                    onClick={() =>
                      setDeleting({ ...deleting, deleteFiles: false })
                    }
                  >
                    <Folder size={15} /> Hapus dari Forge saja
                    <small>Folder proyek tetap ada</small>
                  </button>
                  <button
                    className={deleting.deleteFiles ? "chosen danger" : ""}
                    onClick={() =>
                      setDeleting({ ...deleting, deleteFiles: true })
                    }
                  >
                    <Trash2 size={15} /> Folder dan semua file
                    <small>Dapat dipulihkan dari Trash Mac</small>
                  </button>
                </div>
                <label className="delete-confirmation">
                  Ketik <strong>{deleting.project.name}</strong> untuk
                  konfirmasi
                  <input
                    autoFocus
                    value={deleteConfirmation}
                    onChange={(e) => setDeleteConfirmation(e.target.value)}
                  />
                </label>
              </>
            )}
            {clearingWorkspace && (
              <>
                <div className="delete-options">
                  <button
                    className={!clearingWorkspace.deleteFiles ? "chosen" : ""}
                    onClick={() => setClearingWorkspace({ deleteFiles: false })}
                  >
                    <Folder size={15} /> Kosongkan Workspace
                    <small>Semua folder proyek tetap ada</small>
                  </button>
                  <button
                    className={
                      clearingWorkspace.deleteFiles ? "chosen danger" : ""
                    }
                    onClick={() => setClearingWorkspace({ deleteFiles: true })}
                  >
                    <Trash2 size={15} /> Workspace dan semua folder
                    <small>Dapat dipulihkan dari Trash Mac</small>
                  </button>
                </div>
                <label className="delete-confirmation">
                  Ketik <strong>HAPUS WORKSPACE</strong> untuk konfirmasi
                  <input
                    autoFocus
                    value={workspaceConfirmation}
                    onChange={(e) => setWorkspaceConfirmation(e.target.value)}
                  />
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
              disabled={
                busy ||
                (clearingWorkspace
                  ? workspaceConfirmation !== "HAPUS WORKSPACE"
                  : deleting
                    ? deleteConfirmation !== deleting.project.name
                    : !confirm && !name.trim())
              }
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
                ? clearingWorkspace.deleteFiles
                  ? "Pindahkan semua ke Trash"
                  : "Kosongkan Workspace"
                : deleting
                  ? deleting.deleteFiles
                    ? "Pindahkan ke Trash"
                    : "Hapus dari Forge"
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
        "agent-team": `${p.role || "Agen"} · ${p.detail || p.status || "bekerja"}`,
        "browser-result": p.ok
          ? "Uji browser lulus"
          : "Uji browser menemukan masalah",
        "approval-resolved": "Persetujuan diproses",
        "manual-edit": "Kode manual disimpan",
        "project-files-changed": "File proyek diperbarui",
        "terminal-started": `Terminal · ${p.command || "command"}`,
        "terminal-output": "Output terminal",
        "terminal-completed": p.ok ? "Command selesai" : "Command gagal",
        github: `GitHub · ${p.action || "activity"}`,
        mcp: `MCP · ${p.action || "activity"}`,
        "web-research":
          p.status === "started"
            ? "Memeriksa kebutuhan sumber web"
            : `Sumber web · ${p.count} ditemukan`,
        "deploy-started":
          p.operation === "rollback" ? "Rollback dimulai" : "Deploy dimulai",
        "deploy-log": "Output deploy",
        "deploy-completed":
          p.operation === "rollback"
            ? p.ok
              ? "Rollback selesai"
              : "Rollback gagal"
            : p.ok
              ? "Deploy selesai"
              : "Deploy gagal",
      } as Record<string, string>
    )[e.type] ||
    p.message ||
    e.type
  );
}
