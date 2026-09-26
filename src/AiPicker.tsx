import { useEffect, useState } from "react";
import { RefreshCw, LogIn, Trash2, Cpu } from "lucide-react";
import { api } from "./api";
export type AiSelection = {
  provider: string;
  model: string;
};
type IntegrationProvider = {
  id: string;
  label: string;
  defaultModel: string;
  enabled: boolean;
};
type Catalog = {
  connected: boolean;
  name?: string;
  authenticated?: boolean;
  error?: string;
  models: { id: string; name: string }[];
  defaultModel?: string;
  loaded?: string[];
  memoryCount?: number;
};
type Usage = {
  provider: "codex" | "gemini";
  available?: boolean;
  windows?: {
    id: string;
    name: string;
    window: string;
    remainingPercent: number;
    windowDurationMins: number | null;
    resetsAt: number | null;
  }[];
  context?: { used: number; size: number } | null;
};
export function initialAi(): AiSelection {
  try {
    const s = JSON.parse(localStorage.getItem("forge-ai") || "null");
    if (s && typeof s.provider === "string" && typeof s.model === "string")
      return s;
  } catch {
    /* default */
  }
  return { provider: "codex", model: "gpt-6-astra" };
}
export default function AiPicker({
  value,
  onChange,
  projectId,
  disabled,
  ready,
  onStatus,
  integrationRevision = 0,
  usageRevision = 0,
}: {
  value: AiSelection;
  onChange: (s: AiSelection) => void;
  projectId?: string;
  disabled: boolean;
  ready: boolean;
  onStatus: (s: string) => void;
  integrationRevision?: number;
  usageRevision?: number;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0),
    [providers, setProviders] = useState<IntegrationProvider[]>([]),
    [loginError, setLoginError] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (!ready || !["codex", "gemini"].includes(value.provider)) {
      setUsage(null);
      return;
    }
    let alive = true;
    const fetchUsage = () => {
      void api<Usage>(
        `usage?provider=${value.provider}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`,
      )
        .then((result) => {
          if (alive) setUsage(result);
        })
        .catch(() => {
          if (alive) setUsage(null);
        });
    };
    fetchUsage();
    const timer = window.setInterval(fetchUsage, 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [ready, value.provider, projectId, usageRevision]);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setLoading(true);
    setCatalog(null);
    setLoginError("");
    void Promise.all([
      api("runtime/select", {
        provider: value.provider,
        model: value.model,
      }),
      api<{ providers: IntegrationProvider[] }>("integrations"),
    ])
      .then(([, integrations]) => {
        if (alive)
          setProviders(integrations.providers.filter((item) => item.enabled));
        return api<Catalog>(
          "runtime?provider=" +
            value.provider +
            (projectId ? "&projectId=" + projectId : ""),
        );
      })
      .then((c) => {
        if (alive) {
          setCatalog(c);
          if (
            ["ollama", "bonsai"].includes(value.provider) &&
            c.models?.length &&
            !c.models.some((item) => item.id === value.model) &&
            c.defaultModel
          ) {
            const selected = {
              provider: value.provider,
              model: c.defaultModel,
            };
            localStorage.setItem("forge-ai", JSON.stringify(selected));
            onChange(selected);
          }
          const label =
            c.name ||
            (value.provider === "gemini"
              ? "Gemini"
              : ["ollama", "bonsai"].includes(value.provider)
                ? "Local AI"
                : "Codex");
          onStatus(
            c.connected
              ? `${label} ${value.provider === "gemini" && !c.authenticated ? "siap · pilih proyek untuk cek login" : "tersambung"}`
              : `${label} belum tersambung`,
          );
        }
      })
      .catch((e) => {
        if (alive) setLoginError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    value.provider,
    projectId,
    ready,
    revision,
    integrationRevision,
    onStatus,
  ]);
  const fallback =
    value.provider === "gemini"
      ? [
          { id: "flash", name: "Gemini Flash" },
          { id: "pro", name: "Gemini Pro" },
        ]
      : ["ollama", "bonsai"].includes(value.provider)
        ? [{ id: "", name: "Memuat model lokal..." }]
        : [
            { id: "gpt-6-astra", name: "Astra" },
            { id: "gpt-5.6-sol", name: "Sol" },
          ];
  const models = catalog?.models.length
    ? catalog.models
    : value.provider.startsWith("api:")
      ? [{ id: value.model, name: value.model }]
      : fallback;
  const change = (s: AiSelection) => {
    localStorage.setItem("forge-ai", JSON.stringify(s));
    onChange(s);
  };
  const login = async () => {
    setLoading(true);
    setLoginError("");
    try {
      await api("gemini/login", {});
      setRevision((r) => r + 1);
    } catch (e) {
      setLoginError(
        (e as Error).message +
          " Jika browser login tidak muncul, jalankan gemini di Terminal lalu pilih Sign in with Google.",
      );
    } finally {
      setLoading(false);
    }
  };
  const clearMemory = async () => {
    if (!projectId) return;
    if (
      !window.confirm(
        "Hapus seluruh memori percakapan Local AI untuk proyek ini?",
      )
    )
      return;
    setLoading(true);
    setLoginError("");
    try {
      await api(`${value.provider}/memory/clear`, { projectId });
      setRevision((r) => r + 1);
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="ai-picker">
      <div className="ai-picker-row">
        <label>
          AI
          <select
            aria-label="Provider AI"
            disabled={disabled || loading}
            value={value.provider}
            onChange={(e) => {
              const custom = providers.find(
                (item) => `api:${item.id}` === e.target.value,
              );
              change(
                custom
                  ? { provider: `api:${custom.id}`, model: custom.defaultModel }
                  : e.target.value === "gemini"
                    ? { provider: "gemini", model: "flash" }
                    : e.target.value === "ollama"
                      ? { provider: "ollama", model: "" }
                      : e.target.value === "bonsai"
                        ? { provider: "bonsai", model: "" }
                        : { provider: "codex", model: "gpt-6-astra" },
              );
            }}
          >
            <option value="codex">OpenAI · Codex</option>
            <option value="gemini">Google · Gemini</option>
            <option value="ollama">Local · Ollama</option>
            <option value="bonsai">Local · Bonsai 27B</option>
            {providers.map((item) => (
              <option key={item.id} value={`api:${item.id}`}>
                API · {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          MODEL
          <select
            aria-label="Model AI"
            disabled={disabled || loading}
            value={value.model}
            onChange={(e) => change({ ...value, model: e.target.value })}
          >
            {!models.some((m) => m.id === value.model) && (
              <option value={value.model} disabled>
                {value.model} · tidak tersedia
              </option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="Refresh koneksi AI"
          title="Periksa koneksi dan model"
          disabled={disabled || loading || !ready}
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </div>
      {value.provider === "gemini" && (
        <div className="ai-connection">
          <span>
            {loading
              ? "Menghubungkan Gemini…"
              : catalog?.authenticated
                ? "Login Gemini aktif · memakai akun CLI Anda"
                : "Gunakan akun Google yang terhubung ke Gemini CLI."}
          </span>
          <button
            disabled={disabled || loading || !ready}
            onClick={() => void login()}
          >
            <LogIn size={12} /> Login Google
          </button>
        </div>
      )}
      {value.provider === "codex" && (
        <div className="ai-connection usage-state">
          {usage?.windows?.length ? (
            usage.windows.map((window) => (
              <span key={`${window.id}:${window.window}`}>
                {window.name} ·{" "}
                {window.window === "primary" ? "utama" : "tambahan"}:{" "}
                {Math.round(window.remainingPercent)}% kuota tersisa
                {window.windowDurationMins
                  ? ` / ${window.windowDurationMins} menit`
                  : ""}
                {window.resetsAt
                  ? ` · reset ${new Date(window.resetsAt * 1000).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
              </span>
            ))
          ) : (
            <span>Kuota Codex belum tersedia dari akun ini.</span>
          )}
        </div>
      )}
      {value.provider === "gemini" && (
        <div className="ai-connection usage-state">
          <span>
            {usage?.context && usage.context.size > 0
              ? `Konteks Gemini: ${usage.context.used.toLocaleString("id-ID")} / ${usage.context.size.toLocaleString("id-ID")} token · ${Math.max(0, usage.context.size - usage.context.used).toLocaleString("id-ID")} tersisa dalam percakapan`
              : "Penggunaan konteks Gemini belum tersedia. Cek kuota akun lewat /stats model di Gemini CLI."}
          </span>
        </div>
      )}
      {["ollama", "bonsai"].includes(value.provider) && (
        <div className="ai-connection local-ai-state">
          <Cpu size={13} />
          <span>
            {loading
              ? `Menghubungkan ${value.provider === "bonsai" ? "Bonsai" : "Ollama"} lokal…`
              : catalog?.connected
                ? `${catalog.loaded?.includes(value.model) ? "Model termuat di RAM" : "Siap · model dimuat saat dipakai"} · memori lokal ${catalog.memoryCount || 0} pesan`
                : `${value.provider === "bonsai" ? "Bonsai" : "Ollama"} belum tersambung`}
          </span>
          <button
            title="Hapus memori percakapan lokal proyek ini"
            disabled={disabled || loading || !ready || !projectId}
            onClick={() => void clearMemory()}
          >
            <Trash2 size={12} /> Hapus memori
          </button>
        </div>
      )}
      {(loginError || catalog?.error) && (
        <div className="ai-error" role="status">
          {loginError || catalog?.error}
        </div>
      )}
    </div>
  );
}
