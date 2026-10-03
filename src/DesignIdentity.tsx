import { useEffect, useMemo, useState } from "react";
import { Palette, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "./api";
import {
  DesignIdentityEditor,
  tokenGroups,
  type Draft,
  type Group,
  type TokenRow,
  type DesignSnapshot,
} from "./design-identity-editor";

const labels: Record<Group, string> = {
  colors: "Warna",
  typography: "Tipografi",
  spacing: "Spacing",
  radius: "Radius",
  shadows: "Shadow",
};
const hints: Record<Group, string> = {
  colors: "Hex, contoh #235A48",
  typography: "Font yang sudah disetujui, contoh Georgia",
  spacing: "Jarak dengan unit px, rem, atau em",
  radius: "Sudut dengan unit px, rem, atau em",
  shadows: "Teks CSS, contoh 0 2px 8px #0002 atau none",
};
const fields = [
  [
    "direction",
    "Arah visual",
    "Contoh: editorial hangat; pertahankan gaya proyek",
  ],
  ["audience", "Audiens", "Siapa penggunanya dan dalam konteks apa?"],
  ["product", "Produk", "Tujuan produk dan tugas utama pengguna"],
  [
    "decisions",
    "Keputusan desain",
    "Pilihan yang telah disetujui beserta alasannya",
  ],
  ["constraints", "Batasan", "Yang harus dipertahankan atau dihindari"],
] as const;

export function DesignIdentityFields({
  draft,
  onChange,
  disabled,
}: {
  draft: Draft;
  onChange: (change: (draft: Draft) => Draft) => void;
  disabled: boolean;
}) {
  const changeRow = (group: Group, index: number, patch: Partial<TokenRow>) =>
    onChange((current) => ({
      ...current,
      tokenRows: {
        ...current.tokenRows,
        [group]: current.tokenRows[group].map((row, i) =>
          i === index ? { ...row, ...patch } : row,
        ),
      },
    }));
  return (
    <fieldset className="design-fields" disabled={disabled}>
      <legend className="sr-only">Identitas desain proyek</legend>
      <div className="design-field-grid">
        {fields.map(([key, label, placeholder]) => (
          <label key={key}>
            {label}
            <textarea
              maxLength={2000}
              rows={2}
              value={draft[key]}
              placeholder={placeholder}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      <label>
        Referensi yang disetujui
        <textarea
          rows={3}
          maxLength={20020}
          value={draft.referencesText}
          placeholder="Satu URL http/https atau attachment:id per baris"
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              referencesText: event.target.value,
            }))
          }
        />
      </label>
      <p className="muted">
        Maksimal 20 referensi. Lampiran harus sudah ada di proyek ini. Tidak ada
        fetch, upload, atau analisis gambar otomatis.
      </p>
      <details className="design-tokens">
        <summary>
          Token desain{" "}
          <span className="muted">
            warna · tipografi · jarak · radius · shadow
          </span>
        </summary>
        <p className="muted">
          Isi nilai yang disetujui, bukan JSON. Kosongkan kelompok yang belum
          ditentukan. Nama token unik per kelompok, maksimal 40 token.
        </p>
        {tokenGroups.map((group) => (
          <section
            className="design-token-group"
            key={group}
            aria-label={labels[group]}
          >
            <h4>{labels[group]}</h4>
            <p className="muted">{hints[group]}</p>
            {draft.tokenRows[group].map((row, index) => (
              <div className="design-token-row" key={index}>
                <input
                  aria-label={`Nama token ${labels[group]} ${index + 1}`}
                  placeholder="Nama, mis. accent"
                  value={row.name}
                  maxLength={40}
                  onChange={(event) =>
                    changeRow(group, index, { name: event.target.value })
                  }
                />
                <input
                  aria-label={`Nilai token ${labels[group]} ${index + 1}`}
                  placeholder="Nilai"
                  value={row.value}
                  maxLength={200}
                  onChange={(event) =>
                    changeRow(group, index, { value: event.target.value })
                  }
                />
                {(group === "spacing" || group === "radius") && (
                  <select
                    aria-label={`Unit token ${labels[group]} ${index + 1}`}
                    value={row.unit}
                    onChange={(event) =>
                      changeRow(group, index, { unit: event.target.value })
                    }
                  >
                    {["px", "rem", "em"].map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  aria-label={`Hapus token ${labels[group]} ${index + 1}`}
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      tokenRows: {
                        ...current.tokenRows,
                        [group]: current.tokenRows[group].filter(
                          (_, i) => i !== index,
                        ),
                      },
                    }))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={draft.tokenRows[group].length >= 40}
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  tokenRows: {
                    ...current.tokenRows,
                    [group]: [
                      ...current.tokenRows[group],
                      { name: "", value: "", unit: "px" },
                    ],
                  },
                }))
              }
            >
              <Plus size={13} /> Tambah token {labels[group]}
            </button>
          </section>
        ))}
      </details>
      {!!draft.importedNotes && (
        <details>
          <summary>Dokumen desain yang diimpor (dipertahankan)</summary>
          <pre className="design-imported">{draft.importedNotes}</pre>
        </details>
      )}
    </fieldset>
  );
}

export default function DesignIdentity({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled: boolean;
}) {
  const editor = useMemo(
    () =>
      new DesignIdentityEditor(projectId, (route, body) =>
        api<DesignSnapshot>(route, body),
      ),
    [projectId],
  );
  const [state, setState] = useState(editor.state);
  const [importExisting, setImportExisting] = useState(false);
  useEffect(() => {
    const unsubscribe = editor.subscribe(() => setState(editor.state));
    void editor.load();
    return unsubscribe;
  }, [editor]);
  useEffect(() => {
    if (!state.dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty]);
  const pending = state.status === "loading" || state.status === "saving";
  return (
    <section className="agent-card design-card">
      <header>
        <span>
          <Palette size={15} /> Identitas desain
        </span>
        <span className="muted">Per proyek</span>
      </header>
      <p className="muted">
        Arah visual dan keputusan ini ikut konteks agent berikutnya, di semua
        provider. Skill desain dipilih terpisah melalui daftar skills.
      </p>
      <details>
        <summary>Atur identitas &amp; token desain</summary>
        <p className="muted">
          Disimpan sebagai DESIGN.md dan design.tokens.json setelah checkpoint.
          Simpan sebelum berpindah proyek; draft yang belum disimpan tidak ikut
          pindah.
        </p>
        <div role="status" aria-live="polite" className="design-status">
          {state.status === "loading"
            ? "Memuat identitas…"
            : state.status === "saving"
              ? "Menyimpan…"
              : state.status === "saved"
                ? "Identitas tersimpan dan dibaca ulang dari file."
                : state.dirty
                  ? "Perubahan belum disimpan."
                  : state.snapshot?.exists
                    ? "Identitas proyek dimuat."
                    : state.snapshot
                      ? "Belum ada identitas tersimpan."
                      : "Identitas belum dimuat."}
        </div>
        {state.error && (
          <p className="design-error" role="alert">
            {state.error}
          </p>
        )}
        {state.snapshot?.exportConflict && (
          <p className="design-error" role="alert">
            design.tokens.json sudah ada atau berbeda dari DESIGN.md. Tidak akan
            ditimpa. Pindahkan file tersebut atau pulihkan isinya sesuai
            DESIGN.md terlebih dahulu.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && !pending && !state.snapshot?.exportConflict)
              void editor.save(importExisting);
          }}
        >
          {state.draft && (
            <DesignIdentityFields
              draft={state.draft}
              onChange={(change) => editor.edit(change)}
              disabled={disabled || pending}
            />
          )}
          {state.snapshot?.needsImport && (
            <div className="design-import-warning">
              <details>
                <summary>Lihat DESIGN.md yang sudah ada</summary>
                <pre className="design-imported">
                  {state.snapshot.existingDocument}
                </pre>
              </details>
              <label className="design-import-choice">
                <input
                  type="checkbox"
                  checked={importExisting}
                  disabled={disabled || pending}
                  onChange={(event) => setImportExisting(event.target.checked)}
                />{" "}
                Impor dokumen lama: pertahankan isi lengkap sebagai catatan dan
                buat format Forge setelah checkpoint.
              </label>
            </div>
          )}
          <div className="agent-actions">
            <button
              type="submit"
              className="primary"
              disabled={
                disabled ||
                pending ||
                !state.snapshot ||
                state.snapshot.exportConflict ||
                (state.snapshot.needsImport && !importExisting)
              }
            >
              {state.status === "saving" ? "Menyimpan…" : "Simpan identitas"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (
                  state.dirty &&
                  !window.confirm(
                    "Buang draft dan muat ulang identitas dari file?",
                  )
                )
                  return;
                setImportExisting(false);
                void editor.load();
              }}
            >
              <RefreshCw size={13} /> Muat ulang
            </button>
          </div>
          {disabled && (
            <p className="muted">
              Tunggu operasi atau agent selesai sebelum menyimpan.
            </p>
          )}
        </form>
      </details>
    </section>
  );
}
