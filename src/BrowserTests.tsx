import { useEffect, useRef, useState } from "react";
import { api, type ForgeEvent, type Project } from "./api";

type Step = {
  action: "visit" | "click" | "fill" | "expect";
  selector?: string;
  value?: string;
  path?: string;
};
type Report = {
  ok: boolean;
  testedAt: string;
  checks: { label: string; ok: boolean; error?: string }[];
  findings: string[];
};

export default function BrowserTests({
  project,
  preview,
  events,
}: {
  project: Project;
  preview: { url: string; projectId: string } | null;
  events: ForgeEvent[];
}) {
  const key = `forge-browser-steps-${project.id}`;
  const autoKey = `forge-browser-auto-${project.id}`;
  const [steps, setSteps] = useState<Step[]>(() => readSteps(key));
  const [auto, setAuto] = useState(
    () => localStorage.getItem(autoKey) === "true",
  );
  const [action, setAction] = useState<Step["action"]>("click");
  const [selector, setSelector] = useState("");
  const [value, setValue] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const latestEvent = useRef(events.at(-1)?.id || 0);
  const active = useRef(false);
  const scheduled = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (scheduled.current) clearTimeout(scheduled.current);
    },
    [project.id],
  );

  useEffect(() => {
    setSteps(readSteps(key));
    setAuto(localStorage.getItem(autoKey) === "true");
    setReport(null);
    setError("");
    void api<Report | null>(`browser/report?projectId=${project.id}`)
      .then(setReport)
      .catch(() => {});
  }, [key, autoKey, project.id]);

  const save = (next: Step[]) => {
    localStorage.setItem(key, JSON.stringify(next));
    setSteps(next);
    setReport(null);
  };
  const run = async () => {
    if (active.current) return;
    active.current = true;
    setRunning(true);
    setError("");
    try {
      const result = await api<Report>("browser/run", {
        projectId: project.id,
        steps,
      });
      setReport(result);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      active.current = false;
      setRunning(false);
    }
  };
  useEffect(() => {
    const newer = events.filter((event) => event.id > latestEvent.current);
    if (!newer.length) return;
    latestEvent.current = newer.at(-1)!.id;
    if (
      newer.some(
        (event) =>
          event.type === "build-finished" &&
          event.payload.projectId === project.id &&
          event.payload.ok,
      ) &&
      auto &&
      preview?.projectId === project.id
    ) {
      if (scheduled.current) clearTimeout(scheduled.current);
      scheduled.current = setTimeout(() => {
        void run();
      }, 600);
    }
  }, [events, auto, preview, project.id]);

  return (
    <section className="browser-tests">
      <div className="browser-tests-heading">
        <strong>Uji browser</strong>
        <button
          disabled={!preview || preview.projectId !== project.id || running}
          onClick={() => void run()}
        >
          {running ? "Menguji…" : "Jalankan uji"}
        </button>
      </div>
      <label className="browser-auto">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            localStorage.setItem(autoKey, String(e.target.checked));
          }}
        />{" "}
        Uji otomatis setelah Build selesai saat Preview berjalan
      </label>
      <p>
        Forge membuka Preview dalam Chrome terpisah, memeriksa halaman dan error
        JavaScript, lalu menjalankan langkah berikut secara berurutan.
      </p>
      <div className="browser-steps">
        {steps.map((step, index) => (
          <div key={index}>
            <span>
              {index + 1}.{" "}
              {step.action === "visit"
                ? `Buka ${step.path}`
                : `${step.action} ${step.selector}${step.value !== undefined ? ` · ${step.value}` : ""}`}
            </span>
            <button
              aria-label={`Hapus langkah ${index + 1}`}
              onClick={() => save(steps.filter((_, i) => i !== index))}
            >
              Hapus
            </button>
          </div>
        ))}
      </div>
      <div className="browser-add-step">
        <select
          aria-label="Jenis langkah"
          value={action}
          onChange={(e) => setAction(e.target.value as Step["action"])}
        >
          <option value="visit">Buka path</option>
          <option value="click">Klik</option>
          <option value="fill">Isi input</option>
          <option value="expect">Periksa teks</option>
        </select>
        <input
          aria-label={action === "visit" ? "Path lokal" : "CSS selector"}
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
          placeholder={
            action === "visit" ? "/halaman" : "#submit atau [name=email]"
          }
        />
        {(action === "fill" || action === "expect") && (
          <input
            aria-label="Teks"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Teks"
          />
        )}
        <button
          disabled={steps.length >= 12 || !selector.trim()}
          onClick={() => {
            if (
              action === "visit" &&
              (!selector.startsWith("/") || selector.startsWith("//"))
            ) {
              setError(
                "Path harus dimulai dengan / dan tetap di Preview lokal.",
              );
              return;
            }
            save([
              ...steps,
              action === "visit"
                ? { action, path: selector }
                : action === "click"
                  ? { action, selector }
                  : { action, selector, value },
            ]);
            setSelector("");
            setValue("");
            setError("");
          }}
        >
          Tambah
        </button>
      </div>
      {error && (
        <p className="browser-error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div className="browser-report" aria-live="polite">
          <strong>
            {report.ok ? "Lulus" : "Perlu diperbaiki"} ·{" "}
            {new Date(report.testedAt).toLocaleString("id-ID")}
          </strong>
          {report.checks.map((check, index) => (
            <p key={index}>
              {check.ok ? "✓" : "✕"} {check.label}
              {check.error ? ` — ${check.error}` : ""}
            </p>
          ))}
          {report.findings.map((finding, index) => (
            <p key={index}>✕ {finding}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function readSteps(key: string): Step[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
