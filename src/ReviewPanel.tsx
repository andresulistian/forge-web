import { useEffect, useState } from "react";
import { Check, FileDiff, Loader2, Trash2 } from "lucide-react";
import { api, type Project } from "./api";

type BuildTask = {
  id: string;
  status: "active" | "review" | "failed" | "applied" | "discarded";
  provider?: string;
  model?: string;
  createdAt: number;
  error?: string | null;
};
type ChangedFile = {
  path: string;
  status: "A" | "M" | "D";
  added: number;
  deleted: number;
  binary?: boolean;
  applied?: boolean;
};
type Review = { task: BuildTask; files: ChangedFile[] };
type Diff = ChangedFile & { patch: string; truncated: boolean; unavailable?: boolean };

export default function ReviewPanel({
  project,
  revision,
  busy,
  onBusy,
  onError,
  onApplied,
}: {
  project: Project | null;
  revision: number;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (value: string) => void;
  onApplied: () => void | Promise<void>;
}) {
  const [tasks, setTasks] = useState<BuildTask[]>([]);
  const [taskId, setTaskId] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState("");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const list = await api<BuildTask[]>(`build/tasks?projectId=${project.id}`);
      setTasks(list);
      const next = list.find((item) => ["review", "failed", "active"].includes(item.status)) || list[0];
      setTaskId((current) => (list.some((item) => item.id === current) ? current : next?.id || ""));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setReview(null);
    setSelected([]);
    setFile("");
    setDiff(null);
    void load();
  }, [project?.id, revision]);

  useEffect(() => {
    const task = tasks.find((item) => item.id === taskId);
    if (!project || !taskId || !task || task.status === "active") {
      setReview(null);
      return;
    }
    setLoading(true);
    void api<Review>(`build/review?projectId=${project.id}&taskId=${taskId}`)
      .then((value) => {
        setReview(value);
        const available = value.files.filter((item) => !item.applied).map((item) => item.path);
        setSelected(available);
        setFile(available[0] || value.files[0]?.path || "");
      })
      .catch((error) => onError(error.message))
      .finally(() => setLoading(false));
  }, [project?.id, taskId, tasks]);

  useEffect(() => {
    if (!project || !taskId || !file) {
      setDiff(null);
      return;
    }
    setLoading(true);
    void api<Diff>(
      `build/diff?projectId=${project.id}&taskId=${taskId}&file=${encodeURIComponent(file)}`,
    )
      .then(setDiff)
      .catch((error) => onError(error.message))
      .finally(() => setLoading(false));
  }, [project?.id, taskId, file]);

  const mutate = async (route: "build/apply" | "build/discard") => {
    if (!project || !taskId) return;
    if (route === "build/discard" && !window.confirm("Buang seluruh hasil Build terisolasi ini?")) return;
    if (route === "build/apply" && activeTask?.status === "failed" &&
        !window.confirm("Build ini berhenti sebelum selesai. Terapkan file yang dipilih setelah Anda memeriksa diff-nya?")) return;
    onError("");
    onBusy(true);
    try {
      await api(route, {
        projectId: project.id,
        taskId,
        ...(route === "build/apply" ? { files: selected } : {}),
        confirmed: true,
      });
      await load();
      await onApplied();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      onBusy(false);
    }
  };

  const activeTask = tasks.find((item) => item.id === taskId);
  if (!project)
    return <div className="review-empty">Pilih proyek untuk melihat hasil Build.</div>;
  if (!tasks.length && !loading)
    return (
      <div className="review-empty">
        <FileDiff size={31} />
        <h2>Belum ada perubahan untuk ditinjau.</h2>
        <p>Jalankan mode Build. Forge akan mengerjakannya secara terisolasi sebelum Anda menerapkan hasilnya.</p>
      </div>
    );

  return (
    <div className="review-pane">
      <div className="review-toolbar">
        <div>
          <strong>Review perubahan Build</strong>
          <small>Proyek utama belum berubah sampai Anda menekan Terapkan.</small>
        </div>
        <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {new Date(task.createdAt).toLocaleString("id-ID")} · {task.status}
            </option>
          ))}
        </select>
        {activeTask && ["review", "failed", "active"].includes(activeTask.status) && (
          <button disabled={busy} onClick={() => void mutate("build/discard")}>
            <Trash2 size={13} /> Buang
          </button>
        )}
        <button
          className="primary"
          disabled={busy || !["review", "failed"].includes(activeTask?.status || "") || !selected.length}
          onClick={() => void mutate("build/apply")}
        >
          <Check size={13} /> Terapkan {selected.length || ""}
        </button>
      </div>
      {activeTask?.status === "active" ? (
        <div className="review-empty"><Loader2 className="spin" size={23} /> Build masih berjalan di worktree terisolasi…</div>
      ) : activeTask?.status === "failed" && !review?.files.length ? (
        <div className="review-empty review-failed"><h2>Build gagal</h2><p>{activeTask.error}</p></div>
      ) : (
        <div className="review-body">
          <aside className="review-files">
            {review?.files.map((item) => (
              <button key={item.path} className={file === item.path ? "selected-file" : ""} onClick={() => setFile(item.path)}>
                <input
                  type="checkbox"
                  aria-label={`Pilih ${item.path}`}
                  checked={selected.includes(item.path)}
                  disabled={item.applied || !["review", "failed"].includes(activeTask?.status || "")}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked ? [...current, item.path] : current.filter((name) => name !== item.path),
                    )
                  }
                />
                <span className={`change-status status-${item.status.toLowerCase()}`}>{item.status}</span>
                <span>{item.path}<small>+{item.added} −{item.deleted}{item.applied ? " · diterapkan" : ""}</small></span>
              </button>
            ))}
          </aside>
          <div className="diff-view">
            {loading && !diff ? <Loader2 className="spin" size={18} /> : diff ? (
              <><div className="diff-heading"><FileDiff size={14} /> {diff.path}{diff.unavailable ? <small>Arsip diff tidak tersedia.</small> : diff.truncated && <small>Diff dipotong karena terlalu besar.</small>}</div><pre>{diff.binary && !diff.patch ? "File biner berubah; preview teks tidak tersedia." : diff.patch}</pre></>
            ) : <div className="review-empty">Pilih file untuk melihat diff.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
