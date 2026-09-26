import { useEffect, useRef, useState } from "react";

export type PreviewAnnotation = {
  id: string;
  x: number;
  y: number;
  note: string;
};

type Props = {
  enabled: boolean;
  annotations: PreviewAnnotation[];
  onChange: (annotations: PreviewAnnotation[]) => void;
};

export default function PreviewAnnotations({
  enabled,
  annotations,
  onChange,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = annotations.find((item) => item.id === selected) || null;

  useEffect(() => {
    if (active) input.current?.focus();
  }, [active?.id]);

  if (!enabled && !annotations.length) return null;

  const add = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const annotation: PreviewAnnotation = {
      id: crypto.randomUUID(),
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
      note: "",
    };
    onChange([...annotations, annotation]);
    setSelected(annotation.id);
  };

  const update = (note: string) =>
    onChange(
      annotations.map((item) =>
        item.id === active?.id ? { ...item, note } : item,
      ),
    );

  const remove = () => {
    onChange(annotations.filter((item) => item.id !== active?.id));
    setSelected(null);
  };

  return (
    <div
      className={`annotation-layer ${enabled ? "is-editing" : ""}`}
      onClick={add}
      aria-label="Annotation preview"
    >
      {annotations.map((item, index) => (
        <button
          key={item.id}
          className={`annotation-marker ${selected === item.id ? "active" : ""}`}
          style={{ left: `${item.x}%`, top: `${item.y}%` }}
          title={item.note || `Annotation ${index + 1}`}
          onClick={(event) => {
            event.stopPropagation();
            setSelected(item.id);
          }}
        >
          {index + 1}
        </button>
      ))}
      {active && (
        <div className="annotation-editor" onClick={(e) => e.stopPropagation()}>
          <div>
            <strong>Edit annotation</strong>
            <button
              aria-label="Tutup annotation"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
          </div>
          <textarea
            ref={input}
            rows={3}
            value={active.note}
            placeholder="Contoh: tombol ini terlalu kecil…"
            onChange={(event) => update(event.target.value)}
          />
          <button className="annotation-delete" onClick={remove}>
            Hapus marker
          </button>
        </div>
      )}
    </div>
  );
}
