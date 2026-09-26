import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ExternalLink, RefreshCw } from "lucide-react";
import { api, type Project } from "./api";

type Target = "web" | "ios" | "android";
type Release = {
  id: string;
  provider: string;
  projectName: string;
  environment: string;
  target: Target;
  operation?: string;
  status: string;
  createdAt: string;
  url?: string | null;
  source: "provider" | "forge";
  rollbackable?: boolean;
  rollbackOf?: string;
};
type History = { online: boolean; note?: string; entries: Release[] };

export default function ReleasePanel({
  project,
  target,
  configured,
  active,
  revision,
  confirm,
}: {
  project: Project;
  target: Target;
  configured: boolean;
  active: boolean;
  revision: number;
  confirm: (value: {
    title: string;
    body: string;
    action: () => Promise<void>;
  }) => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  const load = async () => {
    const current = ++request.current;
    setLoading(true);
    setError("");
    try {
      const data = await api<History>(
        `deploy/releases?projectId=${project.id}&target=${target}`,
      );
      if (request.current === current) setHistory(data);
    } catch (cause) {
      if (request.current === current) setError((cause as Error).message);
    } finally {
      if (request.current === current) setLoading(false);
    }
  };
  useEffect(() => {
    setHistory(null);
    if (configured) void load();
    return () => {
      request.current++;
    };
  }, [project.id, target, configured, revision]);

  return (
    <section className="release-panel">
      <div className="release-heading">
        <h3>Riwayat rilis {target === "web" ? "web" : target.toUpperCase()}</h3>
        <button
          disabled={loading || active || !configured}
          onClick={() => void load()}
        >
          <RefreshCw size={13} /> {loading ? "Memuat…" : "Segarkan"}
        </button>
      </div>
      {!configured && (
        <p>
          Simpan pengaturan hosting dan nama situs untuk melihat rilis proyek
          ini.
        </p>
      )}
      {history?.note && (
        <p className="release-note">
          {history.note}{" "}
          {target === "web" && "Catatan deploy Forge tetap ditampilkan."}
        </p>
      )}
      {error && (
        <p className="release-error" role="alert">
          {error}
        </p>
      )}
      {configured && !loading && history?.entries.length === 0 && (
        <p>Belum ada rilis tercatat untuk proyek ini.</p>
      )}
      {history?.entries.map((release) => {
        const allowed =
          target === "web" &&
          history.online &&
          release.source === "provider" &&
          release.rollbackable &&
          !active;
        return (
          <div className="release-row" key={`${release.source}-${release.id}`}>
            <div>
              <strong>
                {release.operation === "rollback"
                  ? "Rollback"
                  : release.environment === "production"
                    ? "Produksi"
                    : "Preview"}
              </strong>
              <span
                className={
                  release.status === "success"
                    ? "release-success"
                    : "release-failed"
                }
              >
                {" "}
                {release.status === "success" ? "Berhasil" : release.status}
              </span>
              <small>
                {new Date(release.createdAt).toLocaleString("id-ID")} ·{" "}
                {release.source === "provider" ? "online" : "catatan Forge"} ·{" "}
                {release.id.slice(0, 12)}
              </small>
              {release.rollbackOf && (
                <small>
                  Dipulihkan ke rilis {release.rollbackOf.slice(0, 12)}
                </small>
              )}
              {release.url && (
                <a
                  className="release-url"
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {release.url}
                </a>
              )}
            </div>
            <div className="release-row-actions">
              {release.url && (
                <a
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Buka rilis"
                >
                  <ExternalLink size={14} />
                </a>
              )}
              {allowed && (
                <button
                  disabled={active}
                  onClick={() =>
                    confirm({
                      title: "Rollback rilis produksi?",
                      body: `Situs produksi akan langsung memakai rilis ${release.id.slice(0, 12)} dari ${release.provider}. Proyek dan database lokal tidak diubah. Tindakan ini memengaruhi pengguna online.`,
                      action: async () => {
                        await api("deploy/rollback", {
                          projectId: project.id,
                          id: release.id,
                          confirmed: true,
                        });
                      },
                    })
                  }
                >
                  <ArrowDownToLine size={13} /> Rollback
                </button>
              )}
            </div>
          </div>
        );
      })}
      {target === "web" && (
        <p className="release-hint">
          Rollback hanya untuk deployment produksi yang berhasil. Rilis preview
          dan build mobile tidak dapat dipilih.
        </p>
      )}
    </section>
  );
}
