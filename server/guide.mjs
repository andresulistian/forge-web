const SYSTEM =
  "Anda adalah Forge Guide, pendamping pengguna pemula. Bantu mengubah ide menjadi prompt Build yang jelas dan siap disalin, mendiagnosis kendala teknis dengan langkah kecil, dan menjelaskan istilah secara sederhana. Saat menyusun prompt, sertakan tujuan, konteks, batasan, hasil yang diharapkan, dan verifikasi. Anda tidak memiliki akses file atau tool dan tidak boleh mengaku sudah mengubah proyek. Jawab dalam Bahasa Indonesia.";

export class Guide {
  constructor(ollama, providers, emit, bonsai = null) {
    this.ollama = ollama;
    this.bonsai = bonsai;
    this.providers = providers;
    this.emit = emit;
    this.enabled = false;
    this.active = null;
  }

  async open(provider = "ollama") {
    if (this.active || this.ollama.guideActive || this.bonsai?.guideActive)
      throw Error("Tunggu Forge Guide selesai sebelum mengganti provider.");
    if (
      provider !== "ollama" &&
      provider !== "bonsai" &&
      !provider.startsWith("api:")
    )
      throw Error("Provider Guide tidak didukung.");
    if (provider === "bonsai" && !this.bonsai)
      throw Error("Server Bonsai belum dikonfigurasi di Forge.");
    if (
      provider.startsWith("api:") &&
      this.providers.find(provider.slice(4)).type !== "openrouter"
    )
      throw Error("Forge Guide mendukung OpenRouter atau Local AI.");
    await this.ollama.setGuideEnabled(provider === "ollama");
    if (this.bonsai) await this.bonsai.setGuideEnabled(provider === "bonsai");
    this.enabled = true;
    return { enabled: true, provider };
  }

  async close() {
    this.enabled = false;
    this.active?.controller.abort();
    await this.ollama.setGuideEnabled(false);
    if (this.bonsai) await this.bonsai.setGuideEnabled(false);
    return { enabled: false };
  }

  async chat(project, text, provider, model, context) {
    if (!this.enabled) throw Error("Buka Forge Guide terlebih dahulu.");
    if (this.active || this.ollama.guideActive || this.bonsai?.guideActive)
      throw Error("Forge Guide masih menjawab.");
    if (typeof text !== "string" || !text.trim() || text.length > 12000)
      throw Error("Pesan Guide kosong atau terlalu panjang.");
    if (context.webSources?.length || context.webContext) {
      const scope = this.ollama.guideScope(project);
      const webMessage = {
        role: "web",
        text: context.webSources?.length
          ? `Pencarian web · ${context.webSources.length} sumber`
          : context.webContext,
        sources: context.webSources || [],
      };
      this.emit("guide", { scope, kind: "sources", ...webMessage });
    }
    if (provider === "ollama") {
      if (!this.ollama.guideEnabled) await this.open("ollama");
      await this.ollama.guideTurn(
        project,
        text,
        context,
        model || (await this.ollama.defaultGuideModel()),
      );
      return { ok: true };
    }
    if (provider === "bonsai") {
      if (!this.bonsai) throw Error("Bonsai belum tersedia.");
      if (!this.bonsai.guideEnabled) await this.open("bonsai");
      await this.bonsai.guideTurn(
        project,
        text,
        context,
        model || (await this.bonsai.defaultGuideModel()),
      );
      return { ok: true };
    }
    if (!provider?.startsWith("api:"))
      throw Error("Provider Guide tidak didukung.");
    const config = this.providers.find(provider.slice(4));
    if (config.type !== "openrouter")
      throw Error("Forge Guide hanya mendukung OpenRouter.");
    const selected = config.models?.length
      ? config.models
      : [config.defaultModel];
    const chosen = model || config.defaultModel;
    if (!selected.includes(chosen))
      throw Error("Model belum dipilih di Settings OpenRouter.");
    if (this.ollama.guideEnabled) await this.ollama.setGuideEnabled(false);
    if (this.bonsai?.guideEnabled) await this.bonsai.setGuideEnabled(false);
    const controller = new AbortController();
    const scope = this.ollama.guideScope(project);
    this.active = { scope, controller };
    this.emit("guide", { scope, kind: "started", provider, model: chosen });
    this.completion = this.runOpenRouter(
      project,
      text.trim(),
      config,
      chosen,
      context,
      controller,
    );
    return { ok: true };
  }

  async runOpenRouter(project, text, config, model, context, controller) {
    const scope = this.ollama.guideScope(project);
    const provider = `api:${config.id}`;
    try {
      const history = (await this.ollama.guideMessages(project))
        .slice(-16)
        .map(({ role, text: content }) => ({ role, content }))
        .filter((item) => ["user", "assistant"].includes(item.role));
      const response = await this.providers.request(
        config,
        "/chat/completions",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            model,
            stream: true,
            messages: [
              { role: "system", content: SYSTEM },
              {
                role: "system",
                content: `Konteks UI saat ini: proyek ${project?.name || "belum dipilih"}; agent ${context.provider || "belum dipilih"}; model ${context.model || "belum dipilih"}; mode ${context.mode || "belum dipilih"}.`,
              },
              ...history,
              { role: "user", content: text + (context.webContext || "") },
            ],
          }),
        },
      );
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          let event;
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            answer += delta;
            this.emit("guide", { scope, kind: "delta", delta });
          }
        }
      }
      if (!answer.trim())
        throw Error("OpenRouter tidak mengirim jawaban teks.");
      if (controller.signal.aborted)
        throw new DOMException("Stopped", "AbortError");
      await this.ollama.guideRemember(project, { role: "user", text });
      if (context.webSources?.length || context.webContext)
        await this.ollama.guideRemember(project, {
          role: "web",
          text: context.webSources?.length
            ? `Pencarian web · ${context.webSources.length} sumber`
            : context.webContext,
          sources: context.webSources || [],
        });
      await this.ollama.guideRemember(project, {
        role: "assistant",
        text: answer,
        provider,
        model,
      });
      this.emit("guide", {
        scope,
        kind: "completed",
        message: answer,
        provider,
        model,
      });
    } catch (error) {
      this.emit("guide", {
        scope,
        kind: "error",
        message:
          error.name === "AbortError"
            ? "Jawaban Forge Guide dihentikan."
            : error.message,
      });
    } finally {
      this.active = null;
    }
  }

  async clear(project) {
    if (this.active || this.ollama.guideActive || this.bonsai?.guideActive)
      throw Error("Tunggu Forge Guide selesai sebelum menghapus riwayat.");
    return this.ollama.clearGuide(project);
  }
}
