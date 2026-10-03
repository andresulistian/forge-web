export type Token = {
  $type: string;
  $value: string | { value: number; unit: string };
};
export const tokenGroups = [
  "colors",
  "typography",
  "spacing",
  "radius",
  "shadows",
] as const;
export type Group = (typeof tokenGroups)[number];
export type Identity = {
  direction: string;
  audience: string;
  product: string;
  constraints: string;
  decisions: string;
  references: string[];
  importedNotes: string;
  tokens: Record<Group, Record<string, Token>>;
};
export type DesignSnapshot = {
  identity: Identity;
  revision: string;
  exists: boolean;
  needsImport: boolean;
  existingDocument: string;
  exportConflict: boolean;
};
export type TokenRow = { name: string; value: string; unit: string };
export type Draft = Omit<Identity, "tokens" | "references"> & {
  referencesText: string;
  tokenRows: Record<Group, TokenRow[]>;
};
export function identityToDraft(identity: Identity): Draft {
  const { tokens, references, ...fields } = identity;
  const tokenRows = Object.fromEntries(
    tokenGroups.map((group) => [
      group,
      Object.entries(tokens[group]).map(([name, token]) => ({
        name,
        value:
          typeof token.$value === "string"
            ? token.$value
            : String(token.$value.value),
        unit: typeof token.$value === "string" ? "px" : token.$value.unit,
      })),
    ]),
  ) as Draft["tokenRows"];
  return { ...fields, referencesText: references.join("\n"), tokenRows };
}
export function draftToIdentity(draft: Draft): Identity {
  const { tokenRows, referencesText, ...fields } = draft;
  const tokens = Object.fromEntries(
    tokenGroups.map((group) => {
      const names = new Set<string>();
      const entries = tokenRows[group].map((row) => {
        if (
          !/^[a-zA-Z][a-zA-Z0-9-]{0,39}$/.test(row.name) ||
          names.has(row.name) ||
          ["constructor", "prototype"].includes(row.name)
        )
          throw Error(
            "Nama token harus unik, dimulai huruf, maksimal 40 huruf/angka/tanda hubung.",
          );
        names.add(row.name);
        const dimension = group === "spacing" || group === "radius";
        if (
          dimension &&
          (!row.value.trim() || !Number.isFinite(Number(row.value)))
        )
          throw Error("Nilai token dimensi harus angka.");
        return [
          row.name,
          {
            $type: dimension
              ? "dimension"
              : group === "colors"
                ? "color"
                : group === "typography"
                  ? "fontFamily"
                  : "string",
            $value: dimension
              ? { value: Number(row.value), unit: row.unit }
              : row.value,
          },
        ];
      });
      return [group, Object.fromEntries(entries)];
    }),
  ) as Identity["tokens"];
  return {
    ...fields,
    references: referencesText
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
    tokens,
  };
}
type State = {
  status: "loading" | "ready" | "saving" | "saved" | "error";
  error: string;
  dirty: boolean;
  snapshot: DesignSnapshot | null;
  draft: Draft | null;
};
type Request = (route: string, body?: unknown) => Promise<DesignSnapshot>;
// One instance per mounted project; version invalidation also handles StrictMode
// effect cleanup and out-of-order loads. No completion may update another project.
export class DesignIdentityEditor {
  state: State = {
    status: "loading",
    error: "",
    dirty: false,
    snapshot: null,
    draft: null,
  };
  private version = 0;
  private listener: (() => void) | null = null;
  private projectId: string;
  private request: Request;
  constructor(projectId: string, request: Request) {
    this.projectId = projectId;
    this.request = request;
  }
  subscribe(listener: () => void) {
    this.listener = listener;
    return () => {
      this.listener = null;
      this.version++;
    };
  }
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listener?.();
  }
  edit(change: (draft: Draft) => Draft) {
    if (!this.state.draft || this.state.status === "saving") return;
    this.update({
      draft: change(this.state.draft),
      dirty: true,
      status: "ready",
      error: "",
    });
  }
  async load() {
    const version = ++this.version;
    this.update({
      status: "loading",
      snapshot: null,
      draft: null,
      dirty: false,
      error: "",
    });
    try {
      const snapshot = await this.request(
        `design-identity?projectId=${encodeURIComponent(this.projectId)}`,
      );
      if (version !== this.version) return;
      this.update({
        snapshot,
        draft: identityToDraft(snapshot.identity),
        status: "ready",
      });
    } catch (error) {
      if (version === this.version)
        this.update({ status: "error", error: (error as Error).message });
    }
  }
  async save(importExisting: boolean) {
    if (
      !this.state.snapshot ||
      !this.state.draft ||
      this.state.status === "saving"
    )
      return false;
    const version = ++this.version;
    this.update({ status: "saving", error: "" });
    try {
      const identity = draftToIdentity(this.state.draft);
      const snapshot = await this.request("design-identity/save", {
        projectId: this.projectId,
        identity,
        expected: this.state.snapshot.revision,
        importExisting,
      });
      if (version !== this.version) return false;
      this.update({
        snapshot,
        draft: identityToDraft(snapshot.identity),
        dirty: false,
        status: "saved",
      });
      return true;
    } catch (error) {
      if (version === this.version)
        this.update({ status: "error", error: (error as Error).message });
      return false;
    }
  }
}
