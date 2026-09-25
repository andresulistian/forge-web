import { Codex } from "./codex.mjs";
import { Gemini, GEMINI_MODELS } from "./gemini.mjs";
import { Ollama, DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL } from "./ollama.mjs";
import { Bonsai } from "./bonsai.mjs";
import { ApiProviders } from "./api-providers.mjs";
export class Agents {
  constructor(emit, runtimeDir, dataDir = runtimeDir, store = null) {
    this.codex = new Codex((type, p) =>
      emit(type, { ...p, provider: "codex" }),
    );
    this.gemini = new Gemini(emit, runtimeDir);
    this.ollama = new Ollama(emit, dataDir, globalThis.fetch, store);
    this.bonsai = new Bonsai(emit, dataDir, globalThis.fetch, store);
    this.apiProviders = new ApiProviders(store, emit);
  }
  get active() {
    return (
      this.codex.active ||
      this.gemini.active ||
      this.ollama.active ||
      this.bonsai.active ||
      this.apiProviders.active
    );
  }
  get approvals() {
    return new Map([
      ...this.codex.approvals,
      ...this.gemini.approvals,
      ...this.ollama.approvals,
      ...this.bonsai.approvals,
      ...this.apiProviders.approvals,
    ]);
  }
  async catalog(provider, project) {
    if (provider.startsWith("api:"))
      return this.apiProviders.catalog(provider.slice(4));
    if (provider === "ollama") {
      try {
        return await this.ollama.catalog(project);
      } catch (e) {
        return {
          provider,
          connected: false,
          local: true,
          models: [{ id: OLLAMA_DEFAULT_MODEL, name: OLLAMA_DEFAULT_MODEL }],
          error: e.message,
        };
      }
    }
    if (provider === "bonsai") {
      try {
        return await this.bonsai.catalog(project);
      } catch (e) {
        return { provider, connected: false, local: true, models: [], error: e.message };
      }
    }
    if (provider === "gemini") {
      try {
        const info = await this.gemini.connect();
        const session = project ? await this.gemini.session(project) : null;
        return {
          provider,
          connected: true,
          authenticated: !!session,
          models: GEMINI_MODELS,
          info: info.agentInfo,
        };
      } catch (e) {
        return {
          provider,
          connected: false,
          models: GEMINI_MODELS,
          error: e.message,
        };
      }
    }
    if (provider !== "codex") throw Error("Provider tidak valid.");
    try {
      const models = await this.codex.models();
      return {
        provider,
        connected: true,
        models: models.map((m) => ({
          id: m.model,
          name: /astra/i.test(m.model)
            ? "Astra"
            : /sol/i.test(m.model)
              ? "Sol"
              : m.displayName,
          isDefault: m.isDefault,
        })),
        defaultModel: models.find((m) => m.isDefault)?.model,
      };
    } catch (e) {
      return {
        provider,
        connected: false,
        models: [
          { id: "gpt-6-astra", name: "Astra" },
          { id: "gpt-5.6-sol", name: "Sol" },
        ],
        error: e.message,
      };
    }
  }
  async turn(
    project,
    mode,
    text,
    provider = "codex",
    model,
    media = [],
    rawText = text,
    webContext = "",
  ) {
    if (this.active) throw Error("Tunggu agent selesai sebelum mengganti AI.");
    if (provider.startsWith("api:"))
      return this.apiProviders.turn(
        project,
        mode,
        rawText,
        provider.slice(4),
        model,
        this.apiProviders.store.messages(project.id, 30),
        webContext,
        media,
      );
    if (provider === "gemini")
      return this.gemini.turn(project, mode, text + webContext, model || "flash", media);
    if (provider === "ollama")
      return this.ollama.turn(
        project,
        mode,
        text + webContext,
        model || OLLAMA_DEFAULT_MODEL,
        media,
        rawText,
      );
    if (provider === "bonsai")
      return this.bonsai.turn(project, mode, text + webContext, model || await this.bonsai.defaultGuideModel(), media, rawText);
    if (provider !== "codex") throw Error("Provider tidak valid.");
    if (model) {
      const models = await this.codex.models();
      if (
        media.some((i) => i.audio) &&
        !models
          .find((m) => m.model === model)
          ?.inputModalities?.includes("audio")
      )
        throw Error(
          "Model Codex ini tidak mengiklankan dukungan audio. Pilih Gemini Flash/Pro untuk menganalisis audio; audio tidak akan dibuang.",
        );
      if (
        media.some((i) => i.images?.length) &&
        models.find((m) => m.model === model)?.inputModalities &&
        !models.find((m) => m.model === model).inputModalities.includes("image")
      )
        throw Error(
          "Model ini tidak mendukung gambar. Pilih model vision lain.",
        );
      if (!models.some((m) => m.model === model))
        throw Error(
          "Model ini tidak tersedia pada runtime Codex Anda. Refresh daftar AI.",
        );
    }
    return this.codex.turn(project, mode, text + webContext, model, media);
  }
  decide(id, accept) {
    if (String(id).startsWith("api:")) return this.apiProviders.decide(id, accept);
    if (String(id).startsWith("ollama:")) return this.ollama.decide(id, accept);
    if (String(id).startsWith("bonsai:")) return this.bonsai.decide(id, accept);
    return String(id).startsWith("gemini:")
      ? this.gemini.decide(id, accept)
      : this.codex.decide(id, accept);
  }
  stop() {
    return this.apiProviders.active
      ? this.apiProviders.stop()
      : this.ollama.active
      ? this.ollama.stop()
      : this.bonsai.active
      ? this.bonsai.stop()
      : this.gemini.active
        ? this.gemini.stop()
        : this.codex.stop();
  }
  async close() {
    this.apiProviders.stop();
    this.codex.close();
    this.gemini.close();
    await this.ollama.close();
    await this.bonsai.close();
  }
}
