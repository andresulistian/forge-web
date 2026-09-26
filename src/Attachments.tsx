import { extractAudio } from "./audio";
import { useRef, useState } from "react";
import {
  Archive,
  FileCode2,
  FileText,
  Film,
  Image,
  Link,
  Loader2,
  Music,
  Paperclip,
  X,
} from "lucide-react";
import { api } from "./api";

export type Attachment = {
  id: string;
  kind: "image" | "video" | "audio" | "link" | "document" | "code" | "archive";
  name: string;
  url?: string;
  duration?: number;
  size?: number;
  summary?: string;
};

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "kts",
  "swift",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "sql",
  "graphql",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "env",
  "properties",
  "dockerfile",
  "gitignore",
  "log",
]);
const CODE_EXTENSIONS = new Set([
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "kts",
  "swift",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "sql",
  "graphql",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "env",
  "properties",
  "dockerfile",
  "gitignore",
]);

function extension(name: string) {
  const normalized = name.toLowerCase().replace(/^\./, "");
  return normalized.includes(".")
    ? normalized.split(".").pop() || ""
    : normalized;
}
function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error(`Gagal membaca ${file.name}.`));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}
function once(target: EventTarget, event: string, action: () => void) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener("error", fail);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(
        Error(
          "Media tidak bisa dibaca. Gunakan format yang didukung perangkat.",
        ),
      );
    };
    const timer = setTimeout(fail, 15000);
    target.addEventListener(event, ok, { once: true });
    target.addEventListener("error", fail, { once: true });
    action();
  });
}
function capture(source: CanvasImageSource, width: number, height: number) {
  if (!width || !height) throw Error("Dimensi media tidak valid.");
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Canvas tidak tersedia.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return {
    data: canvas.toDataURL("image/jpeg", 0.82).split(",")[1],
    mimeType: "image/jpeg",
  };
}

export async function prepareMedia(file: File) {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      if (file.size > 12_000_000) throw Error("Gambar maksimal 12 MB.");
      const img = document.createElement("img");
      await once(img, "load", () => {
        img.src = url;
      });
      return {
        kind: "image",
        name: file.name,
        size: file.size,
        source: {
          data: await fileBase64(file),
          mimeType: file.type || "image/png",
        },
        images: [capture(img, img.naturalWidth, img.naturalHeight)],
      };
    }
    if (file.type.startsWith("audio/")) {
      if (file.size > 50_000_000) throw Error("File audio maksimal 50 MB.");
      const probe = document.createElement("audio");
      await once(probe, "loadedmetadata", () => {
        probe.src = url;
        probe.load();
      });
      const length = probe.duration;
      probe.removeAttribute("src");
      probe.load();
      if (!Number.isFinite(length) || length > 300 || length <= 0)
        throw Error(
          "Audio maksimal 5 menit dan harus memiliki durasi yang valid.",
        );
      const audio = await extractAudio(file);
      return {
        kind: "audio",
        name: file.name,
        size: file.size,
        duration: audio.duration,
        audio,
      };
    }
    if (!file.type.startsWith("video/"))
      throw Error("Format media tidak didukung.");
    if (file.size > 200_000_000) throw Error("Video maksimal 200 MB.");
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    await once(video, "loadeddata", () => {
      video.src = url;
      video.load();
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0)
      throw Error("Durasi video tidak bisa dibaca.");
    if (duration > 300)
      throw Error(
        "Video maksimal 5 menit. Potong file menjadi beberapa bagian.",
      );
    const audio = await extractAudio(file);
    const images = [];
    for (let i = 0; i < 6; i++) {
      const timestamp = (duration * (i + 0.5)) / 6;
      await once(video, "seeked", () => {
        video.currentTime = timestamp;
      });
      images.push({
        ...capture(video, video.videoWidth, video.videoHeight),
        timestamp,
      });
    }
    video.removeAttribute("src");
    video.load();
    return {
      kind: "video",
      name: file.name,
      size: file.size,
      duration,
      images,
      audio,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareFile(file: File) {
  if (
    file.type.startsWith("image/") ||
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/")
  )
    return prepareMedia(file);
  const ext = extension(file.name);
  const isPdf = ext === "pdf" || file.type === "application/pdf";
  const isZip =
    ext === "zip" ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed";
  if (!isPdf && !isZip && !TEXT_EXTENSIONS.has(ext))
    throw Error(
      `Format .${ext || "unknown"} belum didukung. Gunakan file teks/code, PDF, CSV, atau ZIP.`,
    );
  const maximum = isZip || isPdf ? 12_000_000 : 5_000_000;
  if (file.size > maximum)
    throw Error(`${file.name} maksimal ${maximum / 1_000_000} MB.`);
  return {
    kind: isZip ? "archive" : CODE_EXTENSIONS.has(ext) ? "code" : "document",
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    data: await fileBase64(file),
  };
}

function AttachmentIcon({ kind }: { kind: Attachment["kind"] }) {
  return kind === "video" ? (
    <Film size={12} />
  ) : kind === "image" ? (
    <Image size={12} />
  ) : kind === "audio" ? (
    <Music size={12} />
  ) : kind === "link" ? (
    <Link size={12} />
  ) : kind === "archive" ? (
    <Archive size={12} />
  ) : kind === "code" ? (
    <FileCode2 size={12} />
  ) : (
    <FileText size={12} />
  );
}

export default function AttachmentPicker({
  projectId,
  items,
  onChange,
  disabled,
  onBusy,
  onError,
}: {
  projectId?: string;
  items: Attachment[];
  onChange: (a: Attachment[]) => void;
  disabled: boolean;
  onBusy: (b: boolean) => void;
  onError: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [loading, setLoading] = useState(false),
    [dragging, setDragging] = useState(false),
    [progress, setProgress] = useState(""),
    [showLink, setShowLink] = useState(false),
    [url, setUrl] = useState("");
  const uploadFiles = async (files: File[]) => {
    if (!projectId) return onError("Pilih proyek terlebih dahulu.");
    if (itemsRef.current.length + files.length > 10)
      return onError("Maksimal 10 lampiran per pesan.");
    setLoading(true);
    onBusy(true);
    onError("");
    try {
      let next = [...itemsRef.current];
      for (let index = 0; index < files.length; index++) {
        setProgress(
          `Membaca ${index + 1}/${files.length}: ${files[index].name}`,
        );
        const item = await api<Attachment>("attachments", {
          projectId,
          item: await prepareFile(files[index]),
        });
        next = [...next, item];
        itemsRef.current = next;
        onChange(next);
      }
      setProgress(`${files.length} file siap dianalisis`);
      window.setTimeout(() => setProgress(""), 1800);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setLoading(false);
      onBusy(false);
    }
  };
  const uploadLink = async () => {
    if (!projectId || itemsRef.current.length >= 10)
      return onError("Pilih proyek dan gunakan maksimal 10 lampiran.");
    setLoading(true);
    onBusy(true);
    onError("");
    setProgress("Membaca link…");
    try {
      const item = await api<Attachment>("attachments", {
        projectId,
        item: { kind: "link", url: url.trim() },
      });
      onChange([...itemsRef.current, item]);
      setUrl("");
      setShowLink(false);
      setProgress("Link siap dianalisis");
      window.setTimeout(() => setProgress(""), 1800);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setLoading(false);
      onBusy(false);
    }
  };
  return (
    <div
      className={`attachment-picker${dragging ? " dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) void uploadFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="attachment-drop">Lepaskan file untuk dilampirkan</div>
      )}
      <div className="attachment-chips">
        {items.map((attachment) => (
          <span
            key={attachment.id}
            title={attachment.summary || attachment.url || attachment.name}
          >
            <AttachmentIcon kind={attachment.kind} />
            <span>{attachment.name}</span>
            <button
              disabled={disabled || loading}
              aria-label={`Hapus lampiran ${attachment.name}`}
              onClick={() =>
                onChange(items.filter((item) => item.id !== attachment.id))
              }
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="attachment-actions">
        <input
          ref={input}
          hidden
          type="file"
          multiple
          accept="image/*,video/mp4,video/webm,video/quicktime,audio/*,.pdf,.txt,.md,.csv,.tsv,.json,.jsonl,.xml,.html,.css,.scss,.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rb,.php,.java,.kt,.swift,.go,.rs,.c,.h,.cpp,.hpp,.cs,.sh,.bash,.zsh,.fish,.ps1,.sql,.graphql,.yaml,.yml,.toml,.ini,.conf,.env,.properties,.zip"
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            if (files.length) void uploadFiles(files);
            event.target.value = "";
          }}
        />
        <button
          disabled={disabled || loading || !projectId}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={13} /> Lampirkan file
        </button>
        <button
          disabled={disabled || loading || !projectId}
          onClick={() => setShowLink((value) => !value)}
        >
          <Link size={13} /> Link
        </button>
        {loading && <Loader2 size={13} className="spin" />}
        {progress && <small className="attachment-progress">{progress}</small>}
      </div>
      {showLink && (
        <div className="link-input">
          <input
            aria-label="Link referensi"
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button
            disabled={loading || !url.trim()}
            onClick={() => void uploadLink()}
          >
            Baca link
          </button>
        </div>
      )}
      <small>
        Drag & drop atau pilih hingga 10 file · code, PDF, CSV, ZIP, gambar,
        video, dan audio.
      </small>
    </div>
  );
}
