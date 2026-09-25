import { extractAudio } from "./audio";
import { useRef, useState } from "react";
import { Paperclip, Link, X, Loader2, Image, Film, Music } from "lucide-react";
import { api } from "./api";
export type Attachment = {
  id: string;
  kind: "image" | "video" | "audio" | "link";
  name: string;
  url?: string;
  duration?: number;
};
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
          "Media tidak bisa dibaca. Gunakan PNG/JPEG atau video MP4/WebM yang didukung perangkat.",
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
      if (file.size > 20_000_000) throw Error("Gambar maksimal 20 MB.");
      const img = document.createElement("img");
      await once(img, "load", () => {
        img.src = url;
      });
      return {
        kind: "image",
        name: file.name,
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
        duration: audio.duration,
        audio,
      };
    }
    if (!file.type.startsWith("video/"))
      throw Error("Pilih gambar, video, atau audio.");
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
    return { kind: "video", name: file.name, duration, images, audio };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export default function AttachmentPicker({
  projectId,
  scope,
  imagesOnly = false,
  items,
  onChange,
  disabled,
  onBusy,
  onError,
}: {
  projectId?: string;
  scope?: "chat";
  imagesOnly?: boolean;
  items: Attachment[];
  onChange: (a: Attachment[]) => void;
  disabled: boolean;
  onBusy: (b: boolean) => void;
  onError: (s: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false),
    [showLink, setShowLink] = useState(false),
    [url, setUrl] = useState("");
  const upload = async (get: () => Promise<unknown>) => {
    if ((!projectId && scope !== "chat") || items.length >= 6) {
      onError("Pilih proyek dan gunakan maksimal 6 lampiran.");
      return;
    }
    setLoading(true);
    onBusy(true);
    onError("");
    try {
      const item = await api<Attachment>("attachments", {
        ...(projectId ? { projectId } : { scope: "chat" }),
        item: await get(),
      });
      onChange([...items, item]);
      setUrl("");
      setShowLink(false);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
      onBusy(false);
    }
  };
  return (
    <div className="attachment-picker">
      <div className="attachment-chips">
        {items.map((a) => (
          <span key={a.id} title={a.url || a.name}>
            {a.kind === "video" ? (
              <Film size={12} />
            ) : a.kind === "image" ? (
              <Image size={12} />
            ) : a.kind === "audio" ? (
              <Music size={12} />
            ) : (
              <Link size={12} />
            )}
            <span>{a.name}</span>
            <button
              disabled={disabled || loading}
              aria-label={"Hapus lampiran " + a.name}
              onClick={() => onChange(items.filter((i) => i.id !== a.id))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="attachment-actions">
        <input
          ref={file}
          hidden
          type="file"
          accept={imagesOnly ? "image/png,image/jpeg,image/webp,image/gif" : "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/webm"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(() => {
              if (imagesOnly && !f.type.startsWith("image/")) throw Error("Chat saat ini mendukung gambar dan tautan saja.");
              return prepareMedia(f);
            });
            e.target.value = "";
          }}
        />
        <button
          disabled={disabled || loading || (!projectId && scope !== "chat")}
          onClick={() => file.current?.click()}
        >
          <Paperclip size={13} /> {imagesOnly ? "Gambar" : "Gambar / video / audio"}
        </button>
        <button
          disabled={disabled || loading || (!projectId && scope !== "chat")}
          onClick={() => setShowLink((v) => !v)}
        >
          <Link size={13} /> Link
        </button>
        {loading && <Loader2 size={13} className="spin" />}
      </div>
      {showLink && (
        <div className="link-input">
          <input
            aria-label="Link referensi"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            disabled={loading || !url.trim()}
            onClick={() =>
              void upload(async () => ({ kind: "link", url: url.trim() }))
            }
          >
            Baca link
          </button>
        </div>
      )}
      {items.some((i) => i.kind === "video") && (
        <small>Video: 6 frame visual + seluruh audio (maks. 5 menit).</small>
      )}
    </div>
  );
}
