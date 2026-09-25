import { useEffect, useRef, useState } from "react";
import {
  Check,
  Cloud,
  Database,
  ExternalLink,
  Globe2,
  Loader2,
  Rocket,
  Settings2,
  Smartphone,
  Square,
  WandSparkles,
  ShieldCheck,
} from "lucide-react";
import { api, type Project } from "./api";
import ReleasePanel from "./ReleasePanel";
import MonitoringPanel from "./MonitoringPanel";
import BackendGuide from "./BackendGuide";

type Target = "web" | "ios" | "android";
type Config = {
  hosting: "cloudflare" | "vercel";
  database: "none" | "supabase" | "firebase" | "local";
  environment: "preview" | "production";
  mobileProfile: "preview" | "production";
  projectName: string;
  appId: string;
};
type Inspect = {
  config: Config;
  projectType: "expo" | "web" | "static";
  expo: boolean;
  buildScript: string | null;
  easConfigured: boolean;
  credentials: Record<string, boolean>;
  requirements: { web: string[]; mobile: string[] };
};
type ActiveDeploy = {
  projectId: string;
  target: Target;
  operation: "build" | "submit" | "rollback";
} | null;
type Finding = {
  severity: "critical" | "high" | "warning" | "error";
  code: string;
  file: string;
  message: string;
  fix: string;
  blocking: boolean;
};
type SecurityResult = {
  passed: boolean;
  checkedAt: string;
  findings: Finding[];
};

export default function DeployCenter({
  project,
  active,
  securityRevision,
  releaseRevision,
  busy,
  onBusy,
  onError,
  onPrepare,
  confirm,
}: {
  project: Project | null;
  active: ActiveDeploy;
  securityRevision: number;
  releaseRevision: number;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (value: string) => void;
  onPrepare: (prompt: string) => void;
  confirm: (value: {
    title: string;
    body: string;
    action: () => Promise<void>;
  }) => void;
}) {
  const [target, setTarget] = useState<Target>("web");
  const [info, setInfo] = useState<Inspect | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);
  const [security, setSecurity] = useState<SecurityResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanNumber = useRef(0);

  const scanSecurity = async (projectId: string, selectedTarget: Target) => {
    const request = ++scanNumber.current;
    setScanning(true);
    try {
      const report = await api<SecurityResult>(
        `deploy/security?projectId=${encodeURIComponent(projectId)}&target=${selectedTarget}`,
      );
      if (request === scanNumber.current) setSecurity(report);
    } catch (error) {
      if (request === scanNumber.current) {
        setSecurity(null);
        onError((error as Error).message);
      }
    } finally {
      if (request === scanNumber.current) setScanning(false);
    }
  };

  const load = async () => {
    if (!project) return;
    onError("");
    onBusy(true);
    try {
      const next = await api<Inspect>(
        "deploy/inspect?projectId=" + project.id,
      );
      setInfo(next);
      setConfig(next.config);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      onBusy(false);
    }
  };
  useEffect(() => {
    setInfo(null);
    setConfig(null);
    setSaved(false);
    void load();
  }, [project?.id]);
  useEffect(() => {
    setSecurity(null);
    if (project) void scanSecurity(project.id, target);
    return () => { scanNumber.current++; };
  }, [project?.id, target, securityRevision]);

  if (!project)
    return (
      <div className="deploy-empty">
        <Rocket size={31} />
        <h2>Pilih proyek untuk mulai deploy.</h2>
      </div>
    );
  if (!info || !config)
    return (
      <div className="deploy-empty">
        <Loader2 className="spin" size={26} />
        <p>Memeriksa kesiapan proyek…</p>
      </div>
    );

  const isMobile = target !== "web";
  const projectActive = active?.projectId === project.id;
  const credentialKey =
    target === "web" ? config.hosting : "expo";
  const credentialReady = info.credentials[credentialKey];
  const ready = !isMobile || (info.expo && info.easConfigured);
  const preparePrompt = info.expo
    ? `Siapkan proyek ${project.name} untuk Expo EAS Build. Periksa app.json, atur ios.bundleIdentifier dan android.package menjadi ${config.appId}, lalu buat eas.json dengan profil preview dan production. Jangan melakukan build atau submit ke store dulu. Jalankan pemeriksaan yang relevan dan jelaskan perubahan kepada saya.`
    : `Buat versi mobile Expo/React Native untuk proyek web ${project.name} agar fitur utamanya dapat berjalan di iOS dan Android. Pertahankan proyek web yang ada, buat folder mobile yang rapi, gunakan app identifier ${config.appId}, siapkan eas.json profil preview dan production, lalu jalankan pemeriksaan lokal. Jangan build atau submit ke store dulu.`;
  const blocking = security?.findings.filter((finding) => finding.blocking) || [];
  const fixPrompt = `Perbaiki temuan Security Audit untuk proyek ${project.name} sebelum deploy. Periksa kode dan konteks setiap temuan berikut:\n${blocking.slice(0, 30).map((item) => `- ${item.severity}: ${item.file} — ${item.message} Saran: ${item.fix}`).join("\n")}\nJangan deploy. Buat checkpoint sebelum mengubah file. Jangan menampilkan atau menyimpan nilai rahasia dalam chat. Jika ada kredensial terpapar, jelaskan bahwa saya perlu merotasinya di layanan terkait. Gunakan perubahan yang sesuai dengan stack, jalankan tes, lalu minta saya kembali ke Deploy Center untuk Pindai ulang.`;

  const save = async () => {
    onError("");
    onBusy(true);
    try {
      const next = await api<Config>("deploy/config", {
        projectId: project.id,
        config,
      });
      setConfig(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      await load();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      onBusy(false);
    }
  };
  const launch = (operation: "build" | "submit") => {
    const destination =
      target === "web"
        ? `${config.hosting === "cloudflare" ? "Cloudflare Pages" : "Vercel"} (${config.environment})`
        : `${target === "ios" ? "Apple" : "Google Play"} · ${operation === "build" ? "build paket" : "submit ke toko"}`;
    confirm({
      title:
        operation === "submit" ? "Submit aplikasi ke toko?" : "Mulai deploy?",
      body: `Forge akan membuat checkpoint lalu menjalankan ${destination}. Source/build akan dikirim ke layanan eksternal dan dapat memakai kuota akun Anda. Pengaturan: database ${config.database}, app ID ${config.appId}.`,
      action: async () => {
        await api("deploy/run", {
          projectId: project.id,
          target,
          operation,
          confirmed: true,
        });
      },
    });
  };

  return (
    <div className="deploy-center">
      <div className="deploy-intro">
        <div>
          <span className="eyebrow">DEPLOY CENTER</span>
          <h2>Bawa aplikasi Anda ke pengguna.</h2>
          <p>
            Forge memeriksa proyek, menyimpan pilihan layanan, dan menjalankan
            alur deploy setelah persetujuan Anda.
          </p>
        </div>
        <span className={`readiness ${ready ? "ready" : "needs-work"}`}>
          {ready ? <Check size={13} /> : <Settings2 size={13} />}
          {ready ? "Struktur siap" : "Perlu persiapan"}
        </span>
      </div>

      <div className="deploy-targets">
        {(
          [
            ["web", Globe2, "Web", "Link publik"],
            ["ios", Smartphone, "iOS", "App Store / TestFlight"],
            ["android", Smartphone, "Android", "Play Store / APK"],
          ] as const
        ).map(([id, Icon, label, note]) => (
          <button
            key={id}
            className={target === id ? "chosen" : ""}
            onClick={() => setTarget(id)}
          >
            <Icon size={17} />
            <span>
              <strong>{label}</strong>
              <small>{note}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="deploy-grid">
        <section className="deploy-settings">
          <h3>
            <Settings2 size={14} /> Pengaturan
          </h3>
          {target === "web" ? (
            <label>
              Hosting
              <select
                value={config.hosting}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    hosting: e.target.value as Config["hosting"],
                  })
                }
              >
                <option value="cloudflare">Cloudflare Pages</option>
                <option value="vercel">Vercel</option>
              </select>
            </label>
          ) : (
            <label>
              Profil build
              <select
                value={config.mobileProfile}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    mobileProfile: e.target.value as Config["mobileProfile"],
                  })
                }
              >
                <option value="preview">Preview / internal testing</option>
                <option value="production">Production / store</option>
              </select>
            </label>
          )}
          <label>
            <Database size={12} /> Database
            <select
              value={config.database}
              onChange={(e) =>
                setConfig({
                  ...config,
                  database: e.target.value as Config["database"],
                })
              }
            >
              <option value="none">Tanpa database</option>
              <option value="supabase">Supabase · Postgres</option>
              <option value="firebase">Firebase</option>
              <option value="local">Lokal di perangkat</option>
            </select>
          </label>
          {target === "web" ? (
            <>
              <label>
                Environment
                <select
                  value={config.environment}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      environment: e.target.value as Config["environment"],
                    })
                  }
                >
                  <option value="preview">Preview</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label>
                Nama situs
                <input
                  value={config.projectName}
                  onChange={(e) =>
                    setConfig({ ...config, projectName: e.target.value })
                  }
                />
              </label>
            </>
          ) : (
            <label>
              App identifier
              <input
                value={config.appId}
                onChange={(e) => setConfig({ ...config, appId: e.target.value })}
              />
            </label>
          )}
          <button className="save-deploy-settings" disabled={busy} onClick={() => void save()}>
            {saved ? <Check size={13} /> : <Settings2 size={13} />}
            {saved ? "Tersimpan" : "Simpan pengaturan"}
          </button>
        </section>

        <section className="deploy-readiness">
          <h3>
            <Cloud size={14} /> Kesiapan
          </h3>
          <div className="stack-pill">
            {info.projectType === "expo" ? "Expo / React Native" : info.projectType === "web" ? "Web project" : "Static web"}
          </div>
          {(target === "web" ? info.requirements.web : info.requirements.mobile).map(
            (item) => (
              <div className="requirement" key={item}>
                <span className="event-dot" /> {item}
              </div>
            ),
          )}
          <div className={`credential ${credentialReady ? "ok" : "missing"}`}>
            {credentialReady ? <Check size={13} /> : <Settings2 size={13} />}
            {credentialReady
              ? "Kredensial environment terdeteksi"
              : `Token ${credentialKey} belum terdeteksi; sesi login CLI tetap dapat dipakai`}
          </div>
        </section>
      </div>

      <BackendGuide project={project} provider={info.config.database} onPrepare={onPrepare} />

      {!ready && isMobile && (
        <div className="prepare-card">
          <WandSparkles size={18} />
          <div>
            <strong>Versi mobile perlu disiapkan lebih dulu.</strong>
            <p>
              Forge akan menaruh instruksi lengkap di chat Build. Anda masih
              bisa meninjau prompt sebelum mengirimkannya.
            </p>
          </div>
          <button onClick={() => onPrepare(preparePrompt)}>
            Siapkan dengan Agent
          </button>
        </div>
      )}

      <section className="security-gate" aria-live="polite">
        <div className="security-heading">
          <h3><ShieldCheck size={16} /> Security Audit</h3>
          <button type="button" disabled={scanning || busy || projectActive} onClick={() => void scanSecurity(project.id, target)}>
            {scanning ? "Memindai…" : "Pindai ulang"}
          </button>
        </div>
        <p>{scanning ? "Memeriksa source dan dependensi…" : security?.passed
          ? security.findings.length ? `Siap deploy dengan ${security.findings.length} catatan.` : "Lulus audit. Forge memeriksa ulang saat deploy dan setelah build web."
          : security ? `${blocking.length} temuan harus diperbaiki sebelum deploy.`
          : "Hasil audit belum tersedia; deploy ditahan."}</p>
        {security?.findings.map((item, index) => (
          <div className="security-finding" key={`${item.code}-${item.file}-${index}`}>
            <strong>{item.severity.toUpperCase()}</strong> {item.file}: {item.message}
            <small>Perbaikan: {item.fix}</small>
          </div>
        ))}
        {blocking.length > 0 && (
          <button type="button" className="security-fix" onClick={() => onPrepare(fixPrompt)}>
            <WandSparkles size={14} /> Perbaiki dengan Agent
          </button>
        )}
      </section>

      <ReleasePanel
        project={project}
        target={target}
        configured={target !== "web" || (config.hosting === info.config.hosting && config.projectName === info.config.projectName)}
        active={projectActive}
        revision={releaseRevision}
        confirm={confirm}
      />
      {target === "web" && <MonitoringPanel project={project} revision={releaseRevision} />}

      <div className="deploy-actions">
        <a
          href={
            target === "web"
              ? config.hosting === "cloudflare"
                ? "https://dash.cloudflare.com/"
                : "https://vercel.com/dashboard"
              : "https://expo.dev/accounts"
          }
          target="_blank"
          rel="noreferrer"
        >
          Buka dashboard <ExternalLink size={12} />
        </a>
        {projectActive && active?.operation === "rollback" ? (
          <button className="deploy-main danger" disabled>Rollback sedang berjalan…</button>
        ) : projectActive ? (
          <button
            className="deploy-main danger"
            onClick={() =>
              void api("deploy/stop", { projectId: project.id }).catch((e) =>
                onError(e.message),
              )
            }
          >
            <Square size={13} /> Hentikan deploy
          </button>
        ) : (
          <>
            {isMobile && ready && (
              <button
                disabled={busy || scanning || !security?.passed}
                onClick={() => launch("submit")}
                title="Mengunggah build ke App Store Connect atau Google Play Console"
              >
                Submit ke toko
              </button>
            )}
            <button
              className="deploy-main"
              disabled={busy || scanning || !ready || !security?.passed}
              onClick={() => launch("build")}
            >
              <Rocket size={14} />
              {target === "web" ? "Deploy web" : `Build ${target.toUpperCase()}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
