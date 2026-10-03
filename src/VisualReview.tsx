import { useEffect, useRef, useState } from "react";
import { api, apiImage, type Project } from "./api";
import {
  composeTarget,
  type Capture,
  type EditTarget,
  type VisualState,
} from "./workflow";
import "./visual-workflow.css";

function Screenshot({
  capture,
  onPoint,
}: {
  capture: Capture;
  onPoint?: (x: number, y: number) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let objectUrl = "";
    setUrl("");
    setError("");
    void apiImage(
      `visual/image?projectId=${capture.projectId}&id=${capture.id}`,
    )
      .then((value) => {
        objectUrl = value;
        if (alive) setUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [capture.id, capture.projectId]);
  return (
    <figure className="capture-figure">
      <figcaption>
        {capture.kind === "baseline"
          ? "Sebelum"
          : capture.kind === "after"
            ? "Sesudah"
            : "Snapshot"}{" "}
        · {capture.viewport.width} × {capture.viewport.height} · {capture.path}
        <small>
          {new Date(capture.capturedAt).toLocaleString()} · checkpoint{" "}
          {capture.checkpointId?.slice(0, 8) || "tidak ada"} · run{" "}
          {capture.runId?.slice(0, 8) || "tidak ada"}
        </small>
      </figcaption>
      {error ? (
        <p role="alert">{error}</p>
      ) : url ? (
        <img
          alt={`Screenshot ${capture.kind} ${capture.path}`}
          src={url}
          onClick={
            onPoint
              ? (event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  onPoint(
                    ((event.clientX - box.left) * capture.viewport.width) /
                      box.width,
                    ((event.clientY - box.top) * capture.viewport.height) /
                      box.height,
                  );
                }
              : undefined
          }
          style={onPoint ? { cursor: "crosshair" } : undefined}
        />
      ) : (
        <p role="status">Memuat PNG…</p>
      )}
    </figure>
  );
}
export default function VisualReview({
  project,
  state,
  active,
  ai,
  target,
  onTarget,
  onCompose,
  onChanged,
  onProjectChanged,
}: {
  project: Project;
  state: VisualState;
  active: boolean;
  ai: { provider: string; model: string };
  target: EditTarget | null;
  onTarget: (target: EditTarget | null) => void;
  onCompose: (text: string) => void;
  onChanged: () => Promise<void>;
  onProjectChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState(target?.captureId || "");
  const [path, setPath] = useState(state.path);
  const [viewport, setViewport] = useState(state.viewport);
  const [instruction, setInstruction] = useState("");
  const targetRequest = useRef(0);
  useEffect(
    () => () => {
      targetRequest.current++;
    },
    [],
  );
  const selected =
    state.captures.find((c) => c.id === selectedId) || state.captures[0];
  const before = state.captures.find(
    (c) =>
      c.kind === "baseline" &&
      c.runId === state.run?.id &&
      c.checkpointId === state.run?.checkpointId,
  );
  const after = state.captures.find(
    (c) =>
      c.kind === "after" &&
      c.runId === state.run?.id &&
      c.checkpointId === state.run?.checkpointId &&
      (!before ||
        (c.path === before.path && c.viewport.name === before.viewport.name)),
  );
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const capture = (kind: string) =>
    void act(async () => {
      const value = await api<Capture>("visual/capture", {
        projectId: project.id,
        kind,
        path: kind === "after" && before ? before.path : path,
        viewport: kind === "after" && before ? before.viewport.name : viewport,
        runId: state.run?.id,
        checkpointId: state.run?.checkpointId,
      });
      setSelectedId(value.id);
      targetRequest.current++;
      onTarget(null);
      setNotice(
        kind === "baseline"
          ? "Baseline terhubung ke checkpoint baru. Pilih Gunakan untuk Build sebelum mengedit."
          : "Screenshot PNG tersimpan lokal; belum ditinjau manusia/AI.",
      );
      await onProjectChanged();
    });
  const selectTarget = (index: number) => {
    const request = ++targetRequest.current;
    onTarget(null);
    return void act(async () => {
      if (!selected) return;
      const value = await api<EditTarget>("visual/target", {
        projectId: project.id,
        captureId: selected.id,
        index,
      });
      if (request !== targetRequest.current) return;
      onTarget(value);
      setNotice(
        "Target snapshot dipilih. Tulis perubahan; belum ada instruksi dikirim ke agent.",
      );
    });
  };
  const point = (x: number, y: number) => {
    if (!selected) return;
    const candidates = selected.elements
      .map((e, index) => ({ e, index }))
      .filter(
        ({ e }) =>
          x >= e.box.x &&
          x <= e.box.x + e.box.width &&
          y >= e.box.y &&
          y <= e.box.y + e.box.height,
      )
      .sort(
        (a, b) =>
          a.e.box.width * a.e.box.height - b.e.box.width * b.e.box.height,
      );
    if (candidates[0]) selectTarget(candidates[0].index);
    else
      setError(
        "Tidak ada konteks DOM aman di titik ini. Kontrol input, iframe, dan shadow DOM tidak diinspeksi.",
      );
  };
  const review = () =>
    void act(async () => {
      if (!selected) return;
      if (
        !window.confirm(
          `Kirim PNG yang terlihat (${selected.path}, ${selected.capturedAt}) ke ${ai.provider} / ${ai.model}? Screenshot dapat memuat informasi sensitif. Hanya lanjutkan jika aman. Opini AI bukan uji kepatuhan. Tidak ada file diubah.`,
        )
      )
        return;
      await api("visual/review", {
        projectId: project.id,
        captureId: selected.id,
        ...ai,
        confirmed: true,
      });
      setNotice(
        "PNG dikirim melalui pipeline gambar. Hasil review muncul di chat; status diperbarui saat provider selesai.",
      );
    });
  const decision = (action: string) =>
    void act(async () => {
      const run = state.run;
      if (!run) return;
      if (
        action === "undo" &&
        !window.confirm(
          "Undo run ini? Forge membuat checkpoint cadangan sebelum mengembalikan file. Preview akan berhenti.",
        )
      )
        return;
      await api(`review/${action}`, {
        projectId: project.id,
        runId: run.id,
        checkpointId: run.checkpointId,
        confirmed: action === "undo",
      });
      await onProjectChanged();
    });
  return (
    <section className="visual-review" aria-label="Review screenshot dan DOM">
      <div className="visual-heading">
        <h3>Review visual</h3>
        <span>PNG nyata · pemeriksaan lokal ≠ opini AI</span>
      </div>
      <div className="visual-controls">
        <label>
          Viewport
          <select
            value={viewport}
            disabled={busy}
            onChange={(e) => setViewport(e.target.value)}
          >
            <option value="desktop">Desktop 1440 × 900</option>
            <option value="mobile">Mobile 390 × 844</option>
          </select>
        </label>
        <label>
          Path preview
          <input
            aria-label="Path screenshot"
            value={path}
            maxLength={150}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <button disabled={busy || active} onClick={() => capture("snapshot")}>
          Ambil screenshot
        </button>
        <button disabled={busy || active} onClick={() => capture("baseline")}>
          Baseline sebelum Build
        </button>
        <button
          disabled={busy || active || !state.run?.checkpointId}
          onClick={() => capture("after")}
        >
          Ambil sesudah
        </button>
      </div>
      <label className="visual-opt-in">
        <input
          type="checkbox"
          checked={state.auto}
          disabled={busy}
          onChange={(e) =>
            void act(async () => {
              await api("visual/options", {
                projectId: project.id,
                auto: e.target.checked,
                path,
                viewport,
              });
            })
          }
        />
        Capture otomatis sebelum/sesudah Build (preview harus berjalan)
      </label>
      <p className="visual-help">
        {state.pendingBaselineId && (
          <button
            disabled={busy || active}
            onClick={() =>
              void act(async () => {
                if (
                  !window.confirm(
                    "Lepas baseline terpilih? Build berikutnya membuat checkpoint baru tanpa memakai baseline lama.",
                  )
                )
                  return;
                await api("visual/baseline", {
                  projectId: project.id,
                  captureId: null,
                });
                setNotice(
                  "Baseline dilepas. Build berikutnya memakai checkpoint baru; kirim Build sendiri.",
                );
              })
            }
          >
            Lepas baseline untuk Build dengan checkpoint baru
          </button>
        )}
        Browser terisolasi, tanpa login dan jaringan luar. Font/aset eksternal
        diblokir; hasil dapat berbeda dari iframe live. Input disamarkan.
        Maksimal 24 capture / 120 MB per proyek. Data dinamis bisa berubah;
        target berlaku 10 menit selama kode, preview, dan run sama.
      </p>
      {(error || state.lastError) && (
        <p role="alert" className="visual-error">
          {error || state.lastError} Capture gagal tidak berarti pekerjaan kode
          gagal.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Memproses…</p>}
      <details className="visual-comparison">
        <summary>
          Perbandingan checkpoint ·{" "}
          {state.run?.id.slice(0, 8) || "belum ada run"}
        </summary>
        <div className="capture-pair">
          {before ? (
            <Screenshot capture={before} />
          ) : (
            <p>
              Baseline sebelum edit tidak tersedia. Tidak akan dibuat dengan
              restore proyek.
            </p>
          )}
          {after ? (
            <Screenshot capture={after} />
          ) : (
            <p>
              Screenshot sesudah pada run/path/viewport yang sama belum
              tersedia.
            </p>
          )}
        </div>
        <p>
          Perubahan piksel bukan ukuran kualitas. Build:{" "}
          {state.run?.buildStatus || "not-run"} · Review kode:{" "}
          {state.run?.reviewStatus || "belum ada"}
        </p>
        <div className="visual-controls">
          <button
            disabled={busy || active || state.run?.reviewStatus !== "ready"}
            onClick={() => decision("accept")}
          >
            Accept run ini
          </button>
          <button
            disabled={
              busy ||
              active ||
              !["ready", "accepted"].includes(state.run?.reviewStatus || "")
            }
            onClick={() => decision("undo")}
          >
            Undo run ini…
          </button>
        </div>
      </details>
      {selected ? (
        <>
          <label>
            Capture tersimpan
            <select
              aria-label="Capture tersimpan"
              value={selected.id}
              onChange={(e) => {
                targetRequest.current++;
                setSelectedId(e.target.value);
                onTarget(null);
              }}
            >
              {state.captures.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind} · {c.viewport.name} · {c.path} ·{" "}
                  {new Date(c.capturedAt).toLocaleString()} ·{" "}
                  {c.runId?.slice(0, 8) || "manual"}
                </option>
              ))}
            </select>
          </label>
          <div className="visual-controls">
            {selected.kind === "baseline" && !selected.runId && (
              <button
                disabled={busy || active}
                onClick={() =>
                  void act(async () => {
                    await api("visual/baseline", {
                      projectId: project.id,
                      captureId: selected.id,
                    });
                    setNotice(
                      "Baseline ini akan dipakai untuk Build berikutnya, hanya jika checkpoint dan kode belum berubah.",
                    );
                  })
                }
              >
                Gunakan untuk Build berikutnya
              </button>
            )}
            <button disabled={busy || active} onClick={review}>
              Review screenshot dengan AI…
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api("visual/human-review", {
                    projectId: project.id,
                    captureId: selected.id,
                    confirmed: true,
                  });
                  setNotice("Review manusia dicatat untuk capture ini saja.");
                })
              }
            >
              Saya sudah meninjau capture ini
            </button>
          </div>
          <p>
            Manusia: {selected.humanReview} · AI: {selected.aiReview}. Provider
            dipilih: {ai.provider} / {ai.model}. Review AI saat ini mendukung
            Codex dengan kapabilitas image terverifikasi.
          </p>
          <div className="measured-findings">
            <strong>
              Temuan DOM terukur — bukan audit aksesibilitas lengkap
            </strong>
            <ul>
              <li>
                Overflow horizontal: {selected.measurements.horizontalOverflow}
                px
              </li>
              <li>
                Kontrol tanpa nama dari pemeriksaan dasar:{" "}
                {selected.measurements.unnamedControls}
              </li>
              {selected.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
          <details className="snapshot-inspector" open>
            <summary>
              Click-to-edit · inspector snapshot (bukan iframe live)
            </summary>
            <p>
              Klik elemen pada PNG atau pilih konteks DOM di bawah. Kandidat
              berdasarkan kotak DOM terkecil; verifikasi tag/teks untuk elemen
              bertumpuk. Source mapping tidak tersedia.
            </p>
            <Screenshot capture={selected} onPoint={point} />
            <label>
              Target DOM (akses keyboard)
              <select
                aria-label="Target DOM snapshot"
                value={target?.captureId === selected.id ? target.index : ""}
                disabled={busy || active}
                onChange={(e) => selectTarget(Number(e.target.value))}
              >
                <option value="" disabled>
                  Pilih elemen
                </option>
                {selected.elements.map((e, i) => (
                  <option value={i} key={i}>
                    {e.tag} ·{" "}
                    {e.text.slice(0, 75) || e.accessible.label || "tanpa teks"}
                  </option>
                ))}
              </select>
            </label>
            {target?.captureId === selected.id && (
              <div className="target-context">
                <strong>
                  {target.element.tag} · {target.element.text}
                </strong>
                <code>{target.element.selector}</code>
                <small>
                  Bounding box: {JSON.stringify(target.element.box)} · scroll{" "}
                  {selected.scroll.x},{selected.scroll.y} · source mapping tidak
                  tersedia
                </small>
                <label>
                  Instruksi perubahan
                  <textarea
                    aria-label="Instruksi perubahan elemen"
                    maxLength={2000}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !instruction.trim()}
                  onClick={() =>
                    void act(async () => {
                      const request = ++targetRequest.current;
                      const fresh = await api<EditTarget>("visual/target", {
                        projectId: project.id,
                        captureId: target.captureId,
                        index: target.index,
                      });
                      if (request !== targetRequest.current) return;
                      onCompose(composeTarget(fresh, instruction));
                      setNotice(
                        "Konteks dan instruksi masuk composer. Periksa lalu kirim sendiri; belum ada edit otomatis.",
                      );
                    })
                  }
                >
                  Masukkan konteks ke composer
                </button>
                <button
                  onClick={() => {
                    targetRequest.current++;
                    onTarget(null);
                  }}
                >
                  Lepas target
                </button>
              </div>
            )}
          </details>
        </>
      ) : (
        <p>
          Belum ada screenshot. Jalankan preview yang Anda setujui lalu ambil
          capture.
        </p>
      )}
    </section>
  );
}
