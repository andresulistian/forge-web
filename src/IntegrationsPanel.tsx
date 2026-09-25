import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Github,
  Globe2,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { api, type Project } from "./api";
import BackupPanel from "./BackupPanel";

type ProviderType = "anthropic" | "openrouter" | "vikey" | "openai" | "gemini-api";
type Provider = {
  id: string;
  type: ProviderType;
  label: string;
  baseUrl: string;
  defaultModel: string;
  models?: string[];
  toolModels?: string[];
  imageModels?: string[];
  enabled: boolean;
  hasCredential: boolean;
};
type McpServer = {
  id: string;
  name: string;
  command: string;
  args: string[];
  scope: "global" | "project";
  projectId?: string;
  enabled: boolean;
  trust: string;
  capabilities?: {
    tools?: unknown[];
    resources?: unknown[];
    prompts?: unknown[];
  };
};
type Integrations = {
  providers: Provider[];
  github: {
    auth: { connected: boolean; message: string };
    repository: null | {
      branch: string;
      remote: string;
      dirty: boolean;
      changedFiles: number;
    };
  };
  mcp: McpServer[];
  web: { configured: boolean; provider: string };
};

export default function IntegrationsPanel({
  project,
  onProjectImported,
  onChanged,
  editorDirty = false,
  onSynced,
  onRestored,
}: {
  project: Project | null;
  onProjectImported: (project: Project) => void;
  onChanged: () => void;
  editorDirty?: boolean;
  onSynced?: () => Promise<void>;
  onRestored: (projects: Project[]) => Promise<void>;
}) {
  const [data, setData] = useState<Integrations | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [provider, setProvider] = useState({
    id: "",
    type: "anthropic" as ProviderType,
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "",
    models: [] as string[],
    toolModels: [] as string[],
    imageModels: [] as string[],
    apiKey: "",
  });
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; tools?: boolean; vision?: boolean }[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [repository, setRepository] = useState("");
  const [webApiKey, setWebApiKey] = useState("");
  const [branch, setBranch] = useState("");
  const [commitMessage, setCommitMessage] = useState("Backup from Forge");
  const [mcp, setMcp] = useState({
    name: "",
    command: "",
    args: "",
    scope: "global" as "global" | "project",
  });

  const refresh = async () => {
    const query = project ? `?projectId=${project.id}` : "";
    setData(await api<Integrations>(`integrations${query}`));
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [project?.id]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const switchProvider = (type: ProviderType) =>
    (setAvailableModels([]), setModelSearch(""), setProvider({
      id: "",
      type,
      label: type === "anthropic" ? "Anthropic Claude" : type === "vikey" ? "ViKey AI" : type === "openai" ? "OpenAI API" : type === "gemini-api" ? "Gemini API" : "OpenRouter",
      baseUrl:
        type === "anthropic"
          ? "https://api.anthropic.com"
          : type === "vikey" ? "https://api.vikey.ai/v1" : type === "openai" ? "https://api.openai.com/v1" : type === "gemini-api" ? "https://generativelanguage.googleapis.com/v1beta/openai" : "https://openrouter.ai/api/v1",
      defaultModel: "",
      models: [],
      toolModels: [],
      imageModels: [],
      apiKey: "",
    }));

  const editProvider = (item: Provider) => {
    setProvider({
      id: item.id,
      type: item.type,
      label: item.label,
      baseUrl: item.baseUrl,
      defaultModel: item.defaultModel,
      models: item.models?.length ? item.models : [item.defaultModel],
      toolModels: item.toolModels || [],
      imageModels: item.imageModels || [],
      apiKey: "",
    });
    setAvailableModels([]);
    setModelSearch("");
    setMessage(`Editing ${item.label}. Load models to change the selection.`);
  };

  return (
    <div className="integrations-pane">
      <div className="integration-intro">
        <div>
          <span className="eyebrow">SETTINGS</span>
          <h2>Connections you control.</h2>
          <p>
            API keys are stored in macOS Keychain. GitHub and MCP actions run through
            the local companion and appear in Activity.
          </p>
        </div>
        <button disabled={!!busy} onClick={() => void refresh()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {(message || error) && (
        <div className={error ? "integration-alert error" : "integration-alert"}>
          {error || message}
        </div>
      )}

      <BackupPanel editorDirty={editorDirty} onRestored={onRestored} />

      <section className="integration-card">
        <header>
          <Globe2 size={17} />
          <div>
            <h3>Web Search untuk semua agent</h3>
            <p>Ask, Plan, Build, dan Forge Guide memakai sumber terbaru dari layanan yang sama.</p>
          </div>
          <span className={data?.web?.configured ? "connection-pill ready" : "connection-pill"}>
            {data?.web?.configured ? "Siap mencari" : "Perlu API key"}
          </span>
        </header>
        <div className="integration-grid">
          <label className="wide">
            Brave Search API key
            <input
              type="password"
              autoComplete="new-password"
              placeholder={data?.web?.configured ? "Key tersimpan · isi untuk mengganti" : "Tempel API key Anda"}
              value={webApiKey}
              onChange={(event) => setWebApiKey(event.target.value)}
            />
          </label>
        </div>
        <p className="integration-note">Key disimpan di Keychain komputer, bukan di proyek atau browser. Mode Web · Otomatis mencari saat pertanyaan membutuhkan informasi terbaru. Pertanyaan pencarian dikirim ke Brave; baca hanya halaman publik. <a href="https://api-dashboard.search.brave.com/app/documentation/web-search/get-started" target="_blank" rel="noopener noreferrer">Cara mendapatkan Brave Search API key ↗</a></p>
        <div className="integration-actions">
          <button className="primary" disabled={!!busy || !webApiKey.trim()} onClick={() => void run("web-save", async () => {
            await api("web/save", { apiKey: webApiKey });
            setWebApiKey("");
            setMessage("Pencarian web tersimpan. Coba mode Web · Cari di chat atau klik Uji pencarian.");
          })}>
            {busy === "web-save" ? <Loader2 className="spin" size={14} /> : <Save size={14} />} Simpan key
          </button>
          <button disabled={!!busy || !data?.web?.configured} onClick={() => void run("web-test", async () => {
            const result = await api<{ sources: unknown[] }>("web/test", {});
            setMessage(`Web Search tersambung · ${result.sources.length} sumber pada uji pencarian.`);
          })}>
            <CheckCircle2 size={14} /> Uji pencarian
          </button>
          <button disabled={!!busy || !data?.web?.configured} onClick={() => void run("web-remove", async () => {
            await api("web/remove", {});
            setMessage("Brave Search API key dihapus dari Keychain.");
          })}>
            <Trash2 size={14} /> Hapus key
          </button>
        </div>
      </section>

      <section className="integration-card">
        <header>
          <Bot size={17} />
          <div>
            <h3>AI API providers</h3>
            <p>Tambahkan Claude, OpenRouter, atau ViKey tanpa menyimpan credential di browser.</p>
          </div>
        </header>
        <div className="integration-grid provider-form">
          <label>
            Provider
            <select
              value={provider.type}
              onChange={(e) => switchProvider(e.target.value as ProviderType)}
            >
              <option value="anthropic">Anthropic Claude</option>
              <option value="openrouter">OpenRouter</option>
              <option value="vikey">ViKey AI</option>
              <option value="openai">OpenAI API</option>
              <option value="gemini-api">Gemini API</option>
            </select>
          </label>
          <label>
            Display name
            <input
              value={provider.label}
              onChange={(e) => setProvider({ ...provider, label: e.target.value })}
            />
          </label>
          <label className="wide">
            API endpoint
            <input
              value={provider.baseUrl}
              onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })}
            />
          </label>
          <label>
            Default model
            <select
              value={provider.defaultModel}
              onChange={(e) => setProvider({ ...provider, defaultModel: e.target.value })}
            >
              <option value="">
                {provider.type === "vikey"
                  ? "Otomatis · DeepSeek V4.1 Flash"
                  : "Choose a model"}
              </option>
              {provider.models.map((id) => (
                <option key={id} value={id}>{availableModels.find((model) => model.id === id)?.name || id}</option>
              ))}
            </select>
          </label>
          <label>
            API key
            <input
              type="password"
              autoComplete="new-password"
              placeholder={provider.id ? "Leave blank to keep saved key" : "Stored in Keychain"}
              value={provider.apiKey}
              onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })}
            />
          </label>
        </div>
        <div className="integration-actions">
          <button
            disabled={!!busy || (!provider.apiKey && !provider.id)}
            onClick={() => void run("provider-discover", async () => {
              const result = await api<{ models: { id: string; name: string; tools?: boolean; vision?: boolean }[] }>("provider/discover", provider);
              if (!result.models.length)
                throw Error("ViKey tidak mengembalikan daftar model. Periksa API key dan endpoint, lalu coba lagi.");
              setAvailableModels(result.models);
              setProvider((current) => {
                const models = current.models.filter((id) =>
                  result.models.some((model) => model.id === id));
                if (!models.length) models.push(result.models[0].id);
                return {
                  ...current,
                  models,
                  defaultModel: models.includes(current.defaultModel)
                    ? current.defaultModel
                    : models[0],
                  toolModels: current.type !== "anthropic"
                    ? models.filter((id) => current.toolModels.includes(id) || result.models.some((model) => model.id === id && model.tools))
                    : [],
                  imageModels: current.type !== "anthropic"
                    ? models.filter((id) => current.imageModels.includes(id) || result.models.some((model) => model.id === id && model.vision))
                    : models,
                };
              });
              setMessage(`${result.models.length} model ditemukan. Model pertama sudah dipilih otomatis; Anda dapat langsung menyimpan atau memilih model lain.`);
            })}
          >
            <RefreshCw size={14} /> Load models
          </button>
        </div>
        {availableModels.length > 0 && (
          <div className="provider-model-browser">
            <label>
              Search models
              <input
                aria-label="Search provider models"
                placeholder="DeepSeek, Claude, GPT…"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Available provider models"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id || provider.models.includes(id) || provider.models.length >= 20) return;
                setProvider({
                  ...provider,
                  models: [...provider.models, id],
                  toolModels: availableModels.find((model) => model.id === id)?.tools
                    ? [...new Set([...provider.toolModels, id])]
                    : provider.toolModels,
                  imageModels: availableModels.find((model) => model.id === id)?.vision
                    ? [...new Set([...provider.imageModels, id])]
                    : provider.imageModels,
                  defaultModel: provider.defaultModel || id,
                });
              }}
            >
              <option value="">Select a model to add</option>
              {availableModels
                .filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(modelSearch.toLowerCase()))
                .slice(0, 100)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {model.id}{model.tools ? " · Build" : " · Ask/Plan"}{model.vision ? " · Vision" : ""}
                  </option>
                ))}
            </select>
          </div>
        )}
        {provider.models.length > 0 && (
          <div className="provider-selected-models">
            <strong>Models in chat ({provider.models.length}/20)</strong>
            {provider.models.map((id) => (
              <div key={id}>
                <span>
                  {availableModels.find((model) => model.id === id)?.name || id}{" "}
                  <small>{id} · {provider.toolModels.includes(id) ? "Build siap" : "Ask/Plan"}{provider.imageModels.includes(id) ? " · Vision" : ""}</small>
                </span>
                {provider.type !== "anthropic" && (
                  <span className="provider-model-capabilities">
                    <button
                      type="button"
                      className={provider.toolModels.includes(id) ? "active" : ""}
                      title="Aktifkan hanya jika model mendukung tool calling"
                      onClick={() => setProvider({
                        ...provider,
                        toolModels: provider.toolModels.includes(id)
                          ? provider.toolModels.filter((model) => model !== id)
                          : [...provider.toolModels, id],
                      })}
                    >Build</button>
                    <button
                      type="button"
                      className={provider.imageModels.includes(id) ? "active" : ""}
                      title="Aktifkan hanya jika model menerima input gambar"
                      onClick={() => setProvider({
                        ...provider,
                        imageModels: provider.imageModels.includes(id)
                          ? provider.imageModels.filter((model) => model !== id)
                          : [...provider.imageModels, id],
                      })}
                    >Vision</button>
                  </span>
                )}
                <button
                  aria-label={`Remove ${id}`}
                  onClick={() => setProvider({
                    ...provider,
                    models: provider.models.filter((model) => model !== id),
                    toolModels: provider.toolModels.filter((model) => model !== id),
                    imageModels: provider.imageModels.filter((model) => model !== id),
                    defaultModel: provider.defaultModel === id ? provider.models.find((model) => model !== id) || "" : provider.defaultModel,
                  })}
                ><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
        {provider.type !== "anthropic" && provider.models.length > 0 && (
          <p className="integration-note">Build dan Vision terdeteksi otomatis bila gateway menyediakan metadata. Anda dapat mengaktifkannya manual hanya jika model ViKey/OpenRouter yang dipilih memang mendukung kemampuan tersebut.</p>
        )}
        {!provider.defaultModel && (
          <p className="integration-note provider-save-hint">
            {provider.type === "vikey"
              ? "Load models bersifat opsional. Anda dapat langsung menyimpan; Forge akan memakai DeepSeek V4.1 Flash sebagai model awal."
              : <>Klik <strong>Load models</strong> terlebih dahulu untuk memilih model.</>}
          </p>
        )}
        <button
          className="primary"
          title={provider.type === "vikey" || provider.defaultModel ? "Simpan provider" : "Muat dan pilih model terlebih dahulu"}
          disabled={!!busy || (!provider.id && !provider.apiKey) || (provider.type !== "vikey" && (!provider.defaultModel || !provider.models.length))}
          onClick={() =>
            void run("provider-save", async () => {
              if (availableModels.length && provider.models.some((id) => !availableModels.some((model) => model.id === id)))
                throw Error("One or more selected models are unavailable. Remove them before saving.");
              const saved = await api<Provider>("provider/save", provider);
              switchProvider(provider.type);
              setMessage(`${saved.label} tersimpan · model awal ${saved.defaultModel}. Klik Test untuk memeriksa key dan koneksi.`);
            })
          }
        >
          {busy === "provider-save" ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
          Save provider
        </button>
        <div className="integration-list">
          {data?.providers.map((item) => (
            <div className="integration-item" key={item.id}>
              <KeyRound size={15} />
              <div>
                <strong>{item.label}</strong>
                <small>
                  {item.models?.length || 1} models · {item.type !== "anthropic" ? `${item.toolModels?.length || 0} Build-ready · ${item.imageModels?.length || 0} Vision · ` : ""}
                  default: {item.defaultModel} · {item.hasCredential ? "credential saved" : "no credential"}
                </small>
              </div>
              <button disabled={!!busy} onClick={() => editProvider(item)}>Edit models</button>
              <button
                disabled={!!busy}
                onClick={() =>
                  void run(`provider-test-${item.id}`, async () => {
                    const result = await api<{ models: unknown[] }>("provider/test", { id: item.id });
                    setMessage(`Connection ready · ${result.models.length} models discovered.`);
                  })
                }
              >
                <CheckCircle2 size={13} /> Test
              </button>
              <button
                className="danger-button"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm(`Delete ${item.label}?`)) return;
                  void run(`provider-delete-${item.id}`, async () => {
                    await api("provider/delete", { id: item.id });
                    setMessage("Provider removed.");
                  });
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="integration-card">
        <header>
          <Github size={17} />
          <div>
            <h3>GitHub</h3>
            <p>Import an existing application or back up the selected project.</p>
          </div>
          <span className={data?.github.auth.connected ? "connection-pill ready" : "connection-pill"}>
            {data?.github.auth.connected ? "Connected" : "Login required"}
          </span>
        </header>
        <p className="integration-note">{data?.github.auth.message}</p>
        <div className="integration-grid">
          <label>
            Repository
            <input
              placeholder="owner/repository"
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
            />
          </label>
          <label>
            Branch for import
            <input
              placeholder="main (optional)"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </label>
        </div>
        <div className="integration-actions">
          <button
            disabled={!!busy || !repository || !data?.github.auth.connected}
            onClick={() => {
              if (!window.confirm(`Clone ${repository} to Forge projects?`)) return;
              void run("github-import", async () => {
                const imported = await api<Project>("github/import", {
                  repository,
                  branch,
                  confirmed: true,
                });
                onProjectImported(imported);
                setMessage("Repository imported and opened as a Forge project.");
              });
            }}
          >
            <Github size={14} /> Import repository
          </button>
        </div>
        {project && (
          <div className="github-project">
            <div>
              <strong>{project.name}</strong>
              <small>
                {data?.github.repository
                  ? `${data.github.repository.branch} · ${data.github.repository.changedFiles} changed files`
                  : "No GitHub remote yet · a new repository will be Private"}
              </small>
            </div>
            <input
              aria-label="Commit message"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <button
              className="primary"
              disabled={!!busy || !data?.github.auth.connected}
              onClick={() => {
                const create = !data?.github.repository;
                if (create && !repository) {
                  setError("Enter owner/repository before exporting a new project.");
                  return;
                }
                if (!window.confirm(`Commit and push ${project.name} to GitHub? Forge never force pushes.`)) return;
                void run("github-backup", async () => {
                  await api("github/backup", {
                    projectId: project.id,
                    repository,
                    message: commitMessage,
                    confirmed: true,
                  });
                  setMessage("GitHub backup completed.");
                });
              }}
            >
              <Github size={14} /> Backup now
            </button>
            {data?.github.repository && (
              <button
                disabled={!!busy || editorDirty || !data.github.auth.connected}
                title={editorDirty ? "Simpan perubahan di editor sebelum Sync / Pull" : "Ambil commit terbaru dari GitHub"}
                onClick={() => {
                  if (!window.confirm(`Ambil perubahan terbaru branch ${data.github.repository?.branch} dari GitHub? Perubahan lokal yang belum di-commit akan ditolak.`)) return;
                  void run("github-pull", async () => {
                    const result = await api<{ commits: number }>("github/pull", { projectId: project.id, confirmed: true });
                    await onSynced?.();
                    setMessage(result.commits ? `${result.commits} commit berhasil disinkronkan.` : "Proyek sudah terbaru.");
                  });
                }}
              >
                <RefreshCw size={14} /> {busy === "github-pull" ? "Syncing…" : "Sync / Pull"}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="integration-card">
        <header>
          <Plug size={17} />
          <div>
            <h3>MCP servers</h3>
            <p>Discover tools, resources, and prompts before trusting a server.</p>
          </div>
        </header>
        <div className="integration-grid">
          <label>
            Server name
            <input value={mcp.name} onChange={(e) => setMcp({ ...mcp, name: e.target.value })} />
          </label>
          <label>
            Scope
            <select value={mcp.scope} onChange={(e) => setMcp({ ...mcp, scope: e.target.value as "global" | "project" })}>
              <option value="global">Global</option>
              <option value="project" disabled={!project}>Selected project</option>
            </select>
          </label>
          <label>
            Command
            <input placeholder="npx or absolute executable" value={mcp.command} onChange={(e) => setMcp({ ...mcp, command: e.target.value })} />
          </label>
          <label>
            Arguments
            <input placeholder="One argument per line" value={mcp.args} onChange={(e) => setMcp({ ...mcp, args: e.target.value })} />
          </label>
        </div>
        <button
          className="primary"
          disabled={!!busy || !mcp.name || !mcp.command}
          onClick={() =>
            void run("mcp-save", async () => {
              await api("mcp/save", {
                ...mcp,
                args: mcp.args.split(/\s+/).filter(Boolean),
                projectId: mcp.scope === "project" ? project?.id : "",
              });
              setMcp({ name: "", command: "", args: "", scope: "global" });
              setMessage("MCP server saved as untrusted. Test it before use.");
            })
          }
        >
          <Save size={14} /> Save MCP server
        </button>
        <div className="integration-list">
          {data?.mcp.map((server) => {
            const count =
              (server.capabilities?.tools?.length || 0) +
              (server.capabilities?.resources?.length || 0) +
              (server.capabilities?.prompts?.length || 0);
            return (
              <div className="integration-item" key={server.id}>
                <Plug size={15} />
                <div>
                  <strong>{server.name}</strong>
                  <small>{server.scope} · {count} capabilities discovered · {server.trust}</small>
                </div>
                <button
                  disabled={!!busy || (server.scope === "project" && server.projectId !== project?.id)}
                  onClick={() => {
                    if (!window.confirm(`Run ${server.command} once to discover MCP capabilities?`)) return;
                    void run(`mcp-test-${server.id}`, async () => {
                      await api("mcp/test", { id: server.id, projectId: project?.id, confirmed: true });
                      setMessage("MCP connection tested and capabilities updated.");
                    });
                  }}
                >
                  <CheckCircle2 size={13} /> Test
                </button>
                <button
                  className="danger-button"
                  disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`Delete MCP server ${server.name}?`)) return;
                    void run(`mcp-delete-${server.id}`, async () => {
                      await api("mcp/delete", { id: server.id });
                      setMessage("MCP server removed.");
                    });
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
