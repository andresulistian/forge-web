import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, Globe2, Loader2, MessageSquare, Plus, Settings2, Square, Trash2, X } from "lucide-react";
import AttachmentPicker, { type Attachment } from "./Attachments";
import { api, subscribe, type Message } from "./api";

type Thread = { id: string; title: string; updatedAt: number };
type Provider = { id: string; label: string; defaultModel: string; models?: string[]; enabled: boolean; hasCredential: boolean };
type WebMode = "auto" | "web" | "off";

export default function ChatWorkspace({ onBuild, onSettings, connected, theme, onTheme }: {
  onBuild: () => void;
  onSettings: () => void;
  connected: boolean;
  theme: "dark" | "light";
  onTheme: () => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [webMode, setWebMode] = useState<WebMode>("auto");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draft, setDraft] = useState("");
  const [stream, setStream] = useState("");
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = threadId;

  const refreshThreads = async () => setThreads(await api<Thread[]>("chat-space/threads"));
  const open = async (id: string) => {
    if (working) return;
    setThreadId(id);
    setStream("");
    setSources([]);
    setError("");
    setAttachments([]);
    setMessages(await api<Message[]>(`chat-space/messages?threadId=${encodeURIComponent(id)}`));
  };
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    void Promise.all([api<Thread[]>("chat-space/threads"), api<{ providers: Provider[] }>("integrations")])
      .then(([history, integrations]) => {
        if (!alive) return;
        setThreads(history);
        const available = integrations.providers.filter((item) => item.enabled && item.hasCredential);
        setProviders(available);
        if (available.length) {
          setProviderId((current) => available.some((item) => item.id === current) ? current : available[0].id);
        }
      }).catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [connected]);
  useEffect(() => {
    const selected = providers.find((item) => item.id === providerId);
    setModel(selected?.defaultModel || "");
  }, [providers, providerId]);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void subscribe(controller.signal, (event) => {
      if (event.type !== "chat-space" || event.payload.threadId !== selectedRef.current) return;
      if (event.payload.kind === "delta") setStream((value) => value + event.payload.delta);
      if (event.payload.kind === "sources") setSources(event.payload.sources || []);
      if (event.payload.kind === "started") setWorking(true);
      if (event.payload.kind === "error") setError(event.payload.message);
      if (["completed", "error"].includes(event.payload.kind)) {
        setWorking(false);
        if (selectedRef.current) void api<Message[]>(`chat-space/messages?threadId=${encodeURIComponent(selectedRef.current)}`)
          .then(setMessages).then(() => { setStream(""); setSources([]); }).catch(() => {});
        void refreshThreads().catch(() => {});
      }
    }, () => {});
    return () => controller.abort();
  }, [connected]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, stream, working]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !providerId || working || uploading) return;
    setError("");
    let id = threadId;
    try {
      if (!id) {
        const created = await api<Thread>("chat-space/create", {});
        id = created.id;
        setThreadId(id);
        await refreshThreads();
      }
      const sentAttachments = attachments;
      setMessages((value) => [...value, { role: "user", text, attachments: sentAttachments, provider: `api:${providerId}`, model }]);
      setDraft("");
      setAttachments([]);
      setWorking(true);
      await api("chat-space/send", { threadId: id, text, provider: `api:${providerId}`, model, webMode, attachments: sentAttachments.map((item) => item.id) });
      setMessages(await api<Message[]>(`chat-space/messages?threadId=${encodeURIComponent(id)}`));
      setStream("");
      setSources([]);
      await refreshThreads();
    } catch (e) {
      setError((e as Error).message);
      if (id) void api<Message[]>(`chat-space/messages?threadId=${encodeURIComponent(id)}`).then(setMessages).catch(() => {});
    } finally { setWorking(false); }
  };
  const selected = providers.find((item) => item.id === providerId);
  return (
    <div className="chat-space">
      <aside className="chat-space-sidebar">
        <div className="chat-space-brand"><MessageSquare size={20} /> Forge Chat</div>
        <button onClick={onBuild}><ChevronLeft size={15} /> Kembali ke Build</button>
        <button className="chat-space-new" disabled={working} onClick={() => { setThreadId(null); setMessages([]); setStream(""); setSources([]); setAttachments([]); setError(""); }}><Plus size={15} /> Chat baru</button>
        <div className="section-label">RIWAYAT</div>
        <nav className="chat-space-history">
          {threads.map((thread) => <div key={thread.id} className={thread.id === threadId ? "selected" : ""}>
            <button disabled={working} onClick={() => void open(thread.id)} title={thread.title}>{thread.title}</button>
            <button aria-label={`Hapus ${thread.title}`} title="Hapus percakapan" disabled={working && thread.id === threadId} onClick={() => {
              if (!window.confirm(`Hapus percakapan “${thread.title}”?`)) return;
              void api("chat-space/delete", { threadId: thread.id }).then(() => {
                if (threadId === thread.id) { setThreadId(null); setMessages([]); }
                return refreshThreads();
              }).catch((e) => setError((e as Error).message));
            }}><Trash2 size={13} /></button>
          </div>)}
        </nav>
      </aside>
      <main className="chat-space-main">
        <header className="chat-space-header">
          <strong>{threadId ? threads.find((item) => item.id === threadId)?.title || "Chat" : "Chat baru"}</strong>
          <span>Terpisah dari proyek · tidak mengubah file</span>
          <button onClick={onTheme}>{theme === "dark" ? "☀ Terang" : "☾ Gelap"}</button>
        </header>
        <div className="chat-space-conversation">
          {!messages.length && !working && <div className="chat-space-welcome"><MessageSquare size={34} /><h1>Apa yang ingin Anda diskusikan?</h1><p>Pilih API provider, lalu mulai Chat. Proyek Forge tetap aman dan tidak berubah.</p></div>}
          {messages.map((message, index) => <article key={index} className={`message ${message.role}`}>
            <div className="message-label">{message.role === "user" ? "ANDA" : "✳ FORGE"} {message.model && <span>{message.model}</span>}</div>
            <div className="message-text">{message.text}</div>
            {!!message.attachments?.length && <div className="message-attachments">{message.attachments.map((item) => <span key={item.id}>▧ {item.name}</span>)}</div>}
            {!!message.sources?.length && <div className="web-sources">{message.sources.map((source) => <a key={source.url} href={source.url} rel="noopener noreferrer" target="_blank">{source.title} <Globe2 size={11} /></a>)}</div>}
          </article>)}
          {working && <article className="message assistant"><div className="message-label">✳ FORGE <Loader2 size={12} className="spin" /></div><div className="message-text">{stream || "Sedang menyiapkan jawaban…"}</div>{!!sources.length && <div className="web-sources">{sources.map((source) => <a href={source.url} key={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}</div>}</article>}
          <div ref={bottom} />
        </div>
        <div className="chat-space-compose">
          {error && <div className="error" role="alert">{error}<button aria-label="Tutup error" onClick={() => setError("")}><X size={14} /></button></div>}
          {!providers.length && <p>Belum ada API provider tersimpan. <button onClick={onSettings}><Settings2 size={13} /> Tambahkan di Settings</button></p>}
          <div className="chat-space-options">
            <select aria-label="Provider Chat" value={providerId} disabled={working} onChange={(e) => setProviderId(e.target.value)}>{providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <select aria-label="Model Chat" value={model} disabled={working} onChange={(e) => setModel(e.target.value)}>{(selected?.models || [selected?.defaultModel]).filter(Boolean).map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select aria-label="Akses web Chat" value={webMode} disabled={working} onChange={(e) => setWebMode(e.target.value as WebMode)}><option value="auto">Web · Otomatis</option><option value="web">Web · Cari</option><option value="off">Web · Offline</option></select>
          </div>
          <AttachmentPicker scope="chat" imagesOnly items={attachments} onChange={setAttachments} disabled={working} onBusy={setUploading} onError={setError} />
          <div className="chat-space-input"><textarea aria-label="Pesan Chat" placeholder="Tulis pesan…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            {working ? <button title="Hentikan" aria-label="Hentikan jawaban" onClick={() => { if (threadId) void api("chat-space/stop", { threadId }); }}><Square size={16} /></button> : <button className="primary" aria-label="Kirim pesan Chat" disabled={!draft.trim() || !selected || uploading || !connected} onClick={() => void send()}><ArrowUp size={17} /></button>}
          </div>
          <small>Chat menggunakan API key provider terpilih. Lampiran disimpan lokal; hanya isi yang diperlukan dikirim ke provider saat Anda mengirim pesan.</small>
        </div>
      </main>
    </div>
  );
}
