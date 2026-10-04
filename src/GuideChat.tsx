import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Copy,
  Loader2,
  MessageCircleQuestion,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { api, subscribe, type ForgeEvent, type Project } from "./api";
import type { AiSelection } from "./AiPicker";

type GuideMessage = {
  role: "user" | "assistant" | "web";
  text: string;
  sources?: { title: string; url: string }[];
  time?: number;
  provider?: string;
  model?: string;
};
type GuideProvider = {
  id: string;
  type: string;
  label: string;
  defaultModel: string;
  models?: string[];
  enabled: boolean;
};

export default function GuideChat({
  open,
  onOpenChange,
  project,
  ai,
  mode,
  webMode,
  ready,
  integrationRevision = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  ai: AiSelection;
  mode: string;
  webMode: "auto" | "web" | "off";
  ready: boolean;
  integrationRevision?: number;
}) {
  const [messages, setMessages] = useState<GuideMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState("");
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [providers, setProviders] = useState<GuideProvider[]>([]);
  const [guideProvider, setGuideProvider] = useState(() => {
    const saved = localStorage.getItem("forge-guide-provider");
    return saved && !saved.startsWith("bonsai") ? saved : "ollama";
  });
  const [guideModel, setGuideModel] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const scope = project?.id || "general";
  const selectedProvider = providers.find(
    (item) => `api:${item.id}` === guideProvider,
  );
  const selectedModels =
    guideProvider === "ollama"
      ? ["", "llama3.1", "llama3.2", "gemma2", "mistral", "qwen2.5"]
      : selectedProvider?.models?.length
        ? selectedProvider.models
        : selectedProvider
          ? [selectedProvider.defaultModel]
          : [];

  useEffect(() => {
    if (!open || !ready) return;
    void api<{ providers: GuideProvider[] }>("integrations")
      .then((result) =>
        setProviders(
          result.providers.filter(
            (item) => item.enabled && item.type === "openrouter",
          ),
        ),
      )
      .catch((cause) => setError((cause as Error).message));
  }, [open, ready, integrationRevision]);

  useEffect(() => {
    if (selectedProvider && !selectedModels.includes(guideModel))
      setGuideModel(selectedProvider.defaultModel);
  }, [
    selectedProvider?.id,
    selectedProvider?.defaultModel,
    selectedModels.join("|"),
    guideModel,
  ]);

  useEffect(() => {
    if (!open || !ready) return;
    const abort = new AbortController();
    let alive = true;
    setLoading(true);
    setError("");
    setMessages([]);
    setLive("");
    setActive(false);
    void (async () => {
      try {
        await api("guide/open", { provider: guideProvider });
        const [history, state] = await Promise.all([
          api<GuideMessage[]>(
            "guide/messages" + (project ? "?projectId=" + project.id : ""),
          ),
          api<{ eventId: number }>("state"),
        ]);
        if (!alive) return;
        setMessages(history);
        setLoading(false);
        void subscribe(
          abort.signal,
          (event) => handleEvent(event, scope, alive),
          () => {},
          state.eventId,
        );
      } catch (cause) {
        if (alive) {
          setError((cause as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };

    function handleEvent(
      event: ForgeEvent,
      expectedScope: string,
      mounted: boolean,
    ) {
      if (
        !mounted ||
        event.type !== "guide" ||
        event.payload.scope !== expectedScope
      )
        return;
      const payload = event.payload;
      if (payload.kind === "started") {
        setActive(true);
        setLive("");
      } else if (payload.kind === "delta") {
        setLive((value) => value + payload.delta);
      } else if (payload.kind === "sources") {
        setMessages((value) => [
          ...value,
          { role: "web", text: payload.text, sources: payload.sources },
        ]);
      } else if (payload.kind === "completed") {
        setMessages((value) => [
          ...value,
          {
            role: "assistant",
            text: payload.message,
            time: Date.now(),
            provider: payload.provider,
            model: payload.model,
          },
        ]);
        setLive("");
        setActive(false);
      } else if (payload.kind === "error") {
        setError(payload.message);
        setLive("");
        setActive(false);
      }
    }
  }, [open, ready, scope, project]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, live, open]);

  useEffect(() => {
    if (open)
      document
        .querySelector<HTMLButtonElement>('[aria-label="Tutup Guide"]')
        ?.focus();
  }, [open]);

  const close = () => {
    onOpenChange(false);
    document.querySelector<HTMLButtonElement>('[aria-label="Tools"]')?.focus();
    setActive(false);
    setLive("");
    void api("guide/close", {}).catch(() => {});
  };

  const chooseProvider = async (provider: string) => {
    if (provider === guideProvider) return;
    setLoading(true);
    setError("");
    try {
      await api("guide/open", { provider });
      setGuideProvider(provider);
      localStorage.setItem("forge-guide-provider", provider);
      const item = providers.find((entry) => `api:${entry.id}` === provider);
      setGuideModel(item?.defaultModel || "");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setActive(false);
    setLive("");
  }, [project?.id]);

  const send = async (suggestion?: string) => {
    const text = (suggestion || draft).trim();
    if (!text || active || loading || !ready) return;
    setDraft("");
    setError("");
    setActive(true);
    setMessages((value) => [
      ...value,
      { role: "user", text, time: Date.now() },
    ]);
    try {
      await api("guide/chat", {
        ...(project ? { projectId: project.id } : {}),
        text,
        provider: ai.provider,
        model: ai.model,
        mode,
        webMode,
        guideProvider,
        guideModel:
          guideProvider === "ollama"
            ? ""
            : guideModel || selectedProvider?.defaultModel,
      });
    } catch (cause) {
      setError((cause as Error).message);
      setActive(false);
      setDraft(text);
      setMessages(
        await api<GuideMessage[]>(
          "guide/messages" + (project ? "?projectId=" + project.id : ""),
        ).catch(() => []),
      );
    }
  };

  const clear = async () => {
    if (!window.confirm("Hapus seluruh riwayat Forge Guide untuk proyek ini?"))
      return;
    try {
      await api("guide/clear", project ? { projectId: project.id } : {});
      setMessages([]);
      setLive("");
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const copy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Teks belum bisa disalin. Pilih teks secara manual.");
    }
  };

  return (
    <div className="guide-shell">
      {open && (
        <section
          className="guide-panel"
          aria-label="Forge Guide"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <header className="guide-header">
            <span className="guide-mark">
              <MessageCircleQuestion size={18} />
            </span>
            <div>
              <strong>Forge Guide</strong>
              <small>
                Diskusi prompt & bantuan teknis ·{" "}
                {guideProvider === "ollama"
                  ? "Ollama lokal"
                  : selectedProvider?.label || "OpenRouter"}
              </small>
            </div>
            <button
              title="Hapus riwayat Guide"
              aria-label="Hapus riwayat Guide"
              disabled={active || loading}
              onClick={() => void clear()}
            >
              <Trash2 size={14} />
            </button>
            <button
              title="Tutup Guide"
              aria-label="Tutup Guide"
              onClick={close}
            >
              <X size={16} />
            </button>
          </header>
          <div className="guide-provider-row">
            <label>
              Guide AI
              <select
                aria-label="Guide AI"
                value={guideProvider}
                disabled={active || loading}
                onChange={(event) => void chooseProvider(event.target.value)}
              >
                <option value="ollama">Local AI · Ollama</option>
                {providers.map((item) => (
                  <option key={item.id} value={`api:${item.id}`}>
                    OpenRouter · {item.label}
                  </option>
                ))}
                {!["ollama"].includes(guideProvider) && !selectedProvider && (
                  <option value={guideProvider} disabled>
                    OpenRouter connection unavailable
                  </option>
                )}
              </select>
            </label>
            {selectedProvider && (
              <label>
                Model
                <select
                  aria-label="Guide model"
                  value={
                    selectedModels.includes(guideModel)
                      ? guideModel
                      : selectedProvider.defaultModel
                  }
                  disabled={active || loading}
                  onChange={(event) => setGuideModel(event.target.value)}
                >
                  {selectedModels.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="guide-context">
            <span>{project?.name || "Diskusi umum"}</span>
            <span>Terpisah dari agent utama</span>
            <span>
              Web:{" "}
              {webMode === "web"
                ? "cari"
                : webMode === "off"
                  ? "offline"
                  : "otomatis"}
            </span>
            <span>
              {guideProvider === "ollama"
                ? "Riwayat tersimpan lokal"
                : "Riwayat dikirim ke OpenRouter"}
            </span>
          </div>
          <div className="guide-messages">
            {loading ? (
              <div className="guide-loading">
                <Loader2 size={16} className="spin" /> Menyiapkan Forge Guide…
              </div>
            ) : messages.length === 0 && !live ? (
              <div className="guide-welcome">
                <Sparkles size={22} />
                <h2>Mari rapikan ide Anda.</h2>
                <p>
                  Ceritakan ide atau error yang membingungkan. Guide membantu
                  membuat prompt siap salin tanpa mencampur chat agent utama.
                </p>
                <button
                  onClick={() =>
                    void send(
                      "Bantu saya mengubah ide kasar menjadi prompt Build yang jelas dan mudah dipahami agent.",
                    )
                  }
                >
                  <Sparkles size={13} /> Susun prompt Build
                </button>
                <button
                  onClick={() =>
                    void send(
                      "Saya mengalami kesulitan teknis. Bantu saya mendiagnosisnya langkah demi langkah untuk pemula.",
                    )
                  }
                >
                  <Wrench size={13} /> Bahas kendala teknis
                </button>
              </div>
            ) : (
              messages.map((message, index) => (
                <article
                  className={"guide-message " + message.role}
                  key={index}
                >
                  <div>
                    {message.role === "web"
                      ? "↗ SUMBER WEB"
                      : message.role === "user"
                        ? "ANDA"
                        : `FORGE GUIDE · ${message.provider?.startsWith("api:") ? "OPENROUTER" : "LOCAL AI"}`}
                    {message.role === "assistant" && (
                      <button
                        title="Salin jawaban"
                        onClick={() => void copy(message.text, index)}
                      >
                        <Copy size={11} />{" "}
                        {copied === index ? "Tersalin" : "Salin"}
                      </button>
                    )}
                  </div>
                  <p>{message.text}</p>
                  {!!message.sources?.length && (
                    <div className="web-sources">
                      {message.sources.map((source, i) => (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          key={source.url}
                        >
                          [{i + 1}] {source.title}
                        </a>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
            {live && (
              <article className="guide-message assistant">
                <div>FORGE GUIDE</div>
                <p>
                  {live}
                  <span className="cursor" />
                </p>
              </article>
            )}
            {active && !live && !loading && (
              <div className="guide-loading">
                <Loader2 size={14} className="spin" /> Menyusun jawaban…
              </div>
            )}
            <div ref={bottom} />
          </div>
          {error && <div className="guide-error">{error}</div>}
          <div className="guide-composer">
            <textarea
              aria-label="Pesan untuk Forge Guide"
              value={draft}
              placeholder="Diskusikan prompt atau kendala teknis…"
              disabled={loading}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              aria-label="Kirim ke Forge Guide"
              disabled={!draft.trim() || active || loading || !ready}
              onClick={() => void send()}
            >
              <ArrowUp size={17} />
            </button>
          </div>
          <footer>
            Enter kirim · Shift+Enter baris baru · tidak dapat mengubah file
          </footer>
        </section>
      )}
    </div>
  );
}
