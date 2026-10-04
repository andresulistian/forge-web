import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = panel.current,
        anchor = trigger.current;
      if (!el || !anchor) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const above = !!root.current?.closest(".composer-tools, .ai-picker");
      const available = above
        ? rect.top - margin * 2
        : innerHeight - rect.bottom - margin * 2;
      // On very short screens use the viewport, rather than clip the menu.
      const height = Math.max(
        0,
        available >= 120 ? available : innerHeight - margin * 2,
      );
      el.style.maxHeight = `${height}px`;
      const width = el.getBoundingClientRect().width;
      const left = root.current?.closest(".ai-picker")
        ? rect.left
        : rect.right - width;
      el.style.left = `${Math.max(margin, Math.min(left, innerWidth - width - margin))}px`;
      const top = above
        ? rect.top - margin - el.offsetHeight
        : rect.bottom + margin;
      el.style.top = `${Math.max(margin, Math.min(top, innerHeight - el.offsetHeight - margin))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
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
        <div
          ref={panel}
          id={id}
          className="context-panel"
          aria-label={`${label} panel`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
