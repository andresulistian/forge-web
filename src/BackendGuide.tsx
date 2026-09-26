import { useEffect, useState } from "react";
import { Database, WandSparkles } from "lucide-react";
import { api, type Project } from "./api";

type Guide = {
  config: { data: string; auth: boolean; api: boolean };
  provider: string;
  detected: string[];
  notes: string[];
  steps: string[];
  prompt: string;
};
export default function BackendGuide({
  project,
  provider,
  onPrepare,
}: {
  project: Project;
  provider: string;
  onPrepare: (prompt: string) => void;
}) {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [draft, setDraft] = useState({ data: "", auth: false, api: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setGuide(null);
    setError("");
    void api<Guide>(`backend/guide?projectId=${project.id}`)
      .then((next) => {
        if (current) {
          setGuide(next);
          setDraft(next.config);
        }
      })
      .catch((cause) => {
        if (current) setError(cause.message);
      });
    return () => {
      current = false;
    };
  }, [project.id, provider]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await api<Guide>("backend/guide", {
        projectId: project.id,
        config: draft,
      });
      setGuide(next);
      setDraft(next.config);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="backend-guide">
      <h3>
        <Database size={16} /> Panduan backend & database
      </h3>
      <p>
        Stack terdeteksi:{" "}
        {guide?.detected.length
          ? guide.detected.join(", ")
          : "belum ada SDK terdeteksi"}
        . Pilihan database mengikuti pengaturan deploy yang tersimpan.
      </p>
      <div className="backend-fields">
        <label>
          Data utama aplikasi
          <input
            maxLength={80}
            placeholder="Contoh: proyek dan tugas"
            value={draft.data}
            onChange={(e) => setDraft({ ...draft, data: e.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.auth}
            onChange={(e) => setDraft({ ...draft, auth: e.target.checked })}
          />{" "}
          Butuh login pengguna
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.api}
            onChange={(e) => setDraft({ ...draft, api: e.target.checked })}
          />{" "}
          Butuh API/server functions
        </label>
      </div>
      {!!guide?.steps.length && (
        <ol>
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {guide?.provider === "none" && (
        <p>
          Pilih database, lalu klik Simpan pengaturan untuk membuat rencana.
        </p>
      )}
      {guide?.provider === "local" && draft.api && (
        <p>
          Database lokal tidak menyediakan sinkronisasi atau endpoint publik;
          pertimbangkan Supabase atau Firebase.
        </p>
      )}
      {error && (
        <p className="release-error" role="alert">
          {error}
        </p>
      )}
      <div className="monitor-actions">
        <button
          disabled={busy || !guide || guide.provider === "none"}
          onClick={() => void save()}
        >
          Simpan rencana
        </button>
        <button
          disabled={
            busy ||
            !guide?.prompt ||
            JSON.stringify(draft) !== JSON.stringify(guide.config)
          }
          onClick={() => guide?.prompt && onPrepare(guide.prompt)}
        >
          <WandSparkles size={13} /> Tinjau di Build
        </button>
      </div>
      <small>
        Agent akan memeriksa proyek sebelum mengubah kode. Koneksi layanan dan
        kredensial tetap disiapkan oleh Anda.
      </small>
    </section>
  );
}
