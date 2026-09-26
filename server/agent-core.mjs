const requiredAdapterMethods = ["catalog", "run", "stop"];

/**
 * One provider-neutral contract for every Forge agent runtime.
 * Provider adapters keep protocol details private while the rest of Forge
 * always sends the same request shape and receives the same lifecycle events.
 */
export class UniversalAgentCore {
  constructor(emit) {
    this.emit = emit;
    this.adapters = [];
  }

  register(adapter) {
    if (
      !adapter ||
      typeof adapter.id !== "string" ||
      typeof adapter.matches !== "function" ||
      requiredAdapterMethods.some((method) => typeof adapter[method] !== "function")
    )
      throw Error("Adapter agent Forge tidak valid.");
    this.adapters.push(adapter);
    return this;
  }

  adapter(provider) {
    const adapter = this.adapters.find((item) => item.matches(provider));
    if (!adapter) throw Error("Provider tidak valid.");
    return adapter;
  }

  catalog(provider, project) {
    return this.adapter(provider).catalog({ provider, project });
  }

  async execute(request) {
    const adapter = this.adapter(request.provider);
    this.emit("agent-activity", {
      projectId: request.project.id,
      phase: "routing",
      label: `Menyiapkan ${adapter.label || adapter.id}`,
      provider: request.provider,
      model: request.model || null,
    });
    return adapter.run(request);
  }

  stop(provider) {
    return this.adapter(provider).stop();
  }
}

export function agentAdapter({ id, label, matches, catalog, run, stop }) {
  return { id, label, matches, catalog, run, stop };
}
