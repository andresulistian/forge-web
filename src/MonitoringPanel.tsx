import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { api, type Project } from "./api";

type Monitor = {
  config: { url: string; expected: string; interval: number; enabled: boolean };
  checks: {
    ok: boolean;
    status: number | null;
    latencyMs: number | null;
    reason: string;
    checkedAt: string;
    url: string;
  }[];
};

export default function MonitoringPanel({
  project,
  revision,
}: {
  project: Project;
  revision: number;
}) {
  const [report, setReport] = useState<Monitor | null>(null);
  const [draft, setDraft] = useState<Monitor["config"]>({
    url: "",
    expected: "",
    interval: 15,
    enabled: false,
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    const next = await api<Monitor>(`monitor?projectId=${project.id}`);
    setReport(next);
    setDraft(next.config);
  };
  useEffect(() => {
    setReport(null);
    void load().catch((e) => setError(e.message));
  }, [project.id, revision]);
  const action = async (kind: "save" | "check") => {
    setWorking(true);
    setError("");
    try {
      const next =
        kind === "save"
          ? await api<Monitor>("monitor/config", {
              projectId: project.id,
              config: draft,
            })
          : await api<Monitor>("monitor/check", { projectId: project.id });
      setReport(next);
      setDraft(next.config);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const latest = report?.checks[0];
  return (
    <section className="monitor-panel">
      <h3>
        <Activity size={16} /> Monitoring situs setelah deploy
      </h3>
      <p>
        Periksa URL publik melalui HTTPS. Pemeriksaan berkala berjalan selama
        Forge terbuka. URL rilis dapat disalin dari Riwayat rilis; untuk
        memantau alamat yang dipakai pengguna, masukkan domain produksi Anda.
      </p>
      <div className="monitor-fields">
        <label>
          URL situs publik
          <input
            type="url"
            placeholder="https://contoh.pages.dev/"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
        </label>
        <label>
          Teks yang harus muncul (opsional)
          <input
            placeholder="Judul halaman"
            value={draft.expected}
            maxLength={100}
            onChange={(e) => setDraft({ ...draft, expected: e.target.value })}
          />
        </label>
        <label>
          Interval
          <select
            value={draft.interval}
            onChange={(e) =>
              setDraft({ ...draft, interval: Number(e.target.value) })
            }
          >
            {[5, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} menit
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="monitor-toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />{" "}
        Aktifkan pemeriksaan berkala
      </label>
      <div className="monitor-actions">
        <button disabled={working} onClick={() => void action("save")}>
          Simpan monitoring
        </button>
        <button
          disabled={working || !report?.config.url}
          onClick={() => void action("check")}
        >
          <RefreshCw size={13} /> Periksa sekarang
        </button>
      </div>
      {error && (
        <p role="alert" className="release-error">
          {error}
        </p>
      )}
      {latest && (
        <div
          className={latest.ok ? "monitor-ok" : "monitor-failed"}
          role="status"
        >
          <strong>{latest.ok ? "Situs tersedia" : "Perlu diperiksa"}</strong> ·{" "}
          {latest.reason} {latest.status && `HTTP ${latest.status}`}{" "}
          {latest.latencyMs !== null && `· ${latest.latencyMs} ms`}
          <small>
            {new Date(latest.checkedAt).toLocaleString("id-ID")} · {latest.url}
          </small>
        </div>
      )}
      {!!report?.checks.length && (
        <p>
          {report.checks.filter((c) => c.ok).length}/{report.checks.length}{" "}
          pemeriksaan terakhir berhasil. Kegagalan perlu ditinjau; Forge tidak
          melakukan rollback otomatis.
        </p>
      )}
    </section>
  );
}
