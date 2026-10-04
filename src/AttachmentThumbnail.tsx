import { useEffect, useRef, useState } from "react";
import { Image } from "lucide-react";
import { apiImage } from "./api";

// Pixels live only in a short-lived blob URL, not in message/draft metadata.
export function AttachmentThumbnail({
  projectId,
  id,
  name,
}: {
  projectId: string;
  id: string;
  name: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const key = `${projectId}:${id}`;
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: "100px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) {
      setImage(null);
      return;
    }
    const controller = new AbortController();
    let blob: string | undefined;
    setFailed(false);
    void apiImage(
      `attachments/image?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`,
      controller.signal,
    )
      .then((url) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        blob = url;
        setFailed(false);
        setImage({ key, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [visible, projectId, id, key]);
  return (
    <span ref={host} className="attachment-thumbnail">
      {visible && !failed && image?.key === key ? (
        <img
          src={image.url}
          alt={name}
          width={56}
          height={56}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          role="img"
          aria-label={
            failed ? `Gambar ${name} tidak tersedia` : `Memuat gambar ${name}`
          }
        >
          <Image size={18} />
        </span>
      )}
    </span>
  );
}
