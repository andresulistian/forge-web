import { useEffect, useState } from "react";
import { Archive, Loader2, RotateCcw } from "lucide-react";
import { api, type Project } from "./api";

type Backup = { id: string; createdAt: string; projects: number; files: number; bytes: number; label: string };

export default function BackupPanel({ editorDirty, onRestored }: {
  editorDirty: boolean;
  onRestored: (projects: Project[]) => Promise<void>;
}) {
  const [items, setItems] = useState<Backup[]>([]);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const refresh = async () => {
    const result = await api<{ location: string; backups: Backup[] }>("backups");
    setLocation(result.location);
    setItems(result.backups);
  };
  useEffect(() => { void refresh().catch((cause) => setError(cause.message)); }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api<Backup>("backups/create", {});
      await refresh();
      setMessage(`Backup tersimpan · ${result.projects} proyek · ${result.files} file.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const restore = async (item: Backup) => {
    if (!window.confirm(`Pulihkan backup ${new Date(item.createdAt).toLocaleString("id-ID")} (${item.projects} proyek)? Forge membuat backup keadaan saat ini dahulu. Proyek lama tidak ditimpa; sesi Forge akan memuat ulang data yang dipulihkan.`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ projects: Project[] }>("backups/restore", { id: item.id, confirmed: true });
      await onRestored(result.projects);
      await refresh();
      setMessage(`${result.projects.length} proyek dipulihkan. Periksa kembali koneksi AI dan konfigurasi proyek.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section className="integration-card backup-card">
      <header>
        <Archive size={17} />
        <div><h3>Backup &amp; pemulihan Forge</h3><p>Proyek, chat, checkpoint, lampiran, dan pengaturan disimpan di luar folder instalasi.</p></div>
      </header>
      <p className="integration-note">Backup otomatis dibuat saat Forge dibuka, paling banyak sekali per hari. Folder: <code>{location || "Memuat…"}</code>. File proyek bisa mengandung konfigurasi rahasia; jaga folder ini. API key di Keychain dan file <code>.env</code> instalasi tidak disalin. Dependensi <code>node_modules</code> dapat dipasang ulang.</p>
      <div className="integration-actions">
        <button className="primary" disabled={busy} onClick={() => void create()}>
          {busy ? <Loader2 className="spin" size={14} /> : <Archive size={14} />} Buat backup sekarang
        </button>
      </div>
      {editorDirty && <p className="integration-note">Simpan perubahan editor sebelum memulihkan backup.</p>}
      {error && <div className="integration-alert error">{error}</div>}
      {message && <div className="integration-alert">{message}</div>}
      <div className="backup-list">
        {items.length === 0 && <p>Belum ada backup. Klik Buat backup sekarang untuk menyimpan keadaan Forge saat ini.</p>}
        {items.map((item) => (
          <div className="backup-entry" key={item.id}>
            <div><strong>{new Date(item.createdAt).toLocaleString("id-ID")}</strong>
              <small>{item.label} · {item.projects} proyek · {(item.bytes / 1024 / 1024).toFixed(1)} MB</small></div>
            <button disabled={busy || editorDirty} onClick={() => void restore(item)}>
              <RotateCcw size={13} /> Pulihkan
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
