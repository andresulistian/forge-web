import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Non-modal disclosure: native tab order, scoped Escape, outside dismissal. */
export default function ContextPanel({
  label,
  children,
}: {
  label: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="context-disclosure"
      ref={root}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div id={id} className="context-panel" aria-label={`${label} panel`}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
