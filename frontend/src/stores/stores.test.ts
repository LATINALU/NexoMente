import { beforeEach, describe, expect, it } from "vitest";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  (globalThis as any).sessionStorage = new MemoryStorage();
  (globalThis as any).window = { dispatchEvent: () => true };
  (globalThis as any).Event = class { constructor(public type: string) {} };
});

describe("workspace store", () => {
  it("respeta el máximo de agentes y alterna categorías", async () => {
    const { useWorkspace, MAX_SELECTED_AGENTS } = await import("./workspace");
    const s = useWorkspace.getState();
    s.setAgents(Array.from({ length: 15 }, (_, i) => `a${i}`));
    expect(useWorkspace.getState().selectedAgents).toHaveLength(MAX_SELECTED_AGENTS);
    s.setAgents(["x"]);
    s.toggleCategory(["x", "y"]);
    expect(useWorkspace.getState().selectedAgents).toEqual(["x", "y"]);
    s.toggleCategory(["x", "y"]);
    expect(useWorkspace.getState().selectedAgents).toEqual([]);
  });

  it("elige el primer proveedor usable y conserva el modelo si sigue habilitado", async () => {
    const { useWorkspace } = await import("./workspace");
    const p = (id: string, active: boolean, models: string[]) =>
      ({ id, name: id, type: "openai", apiKey: active ? "k" : "", models, enabledModels: models, isActive: active }) as any;
    useWorkspace.getState().setProviders([p("off", false, ["m0"]), p("on", true, ["m1", "m2"])]);
    expect(useWorkspace.getState().apiConfig.id).toBe("on");
    expect(useWorkspace.getState().model).toBe("m1");
    useWorkspace.getState().selectModel(useWorkspace.getState().apiConfig, "m2");
    useWorkspace.getState().setProviders([p("on", true, ["m1", "m2"])]);
    expect(useWorkspace.getState().model).toBe("m2");
  });
});

describe("modelo recordado", () => {
  it("restaura el último modelo elegido al recargar, si sigue habilitado", async () => {
    const { useWorkspace } = await import("./workspace");
    const local = { id: "local", name: "Ollama", type: "local", apiKey: "", models: ["gemma", "qwen"],
                    enabledModels: ["gemma", "qwen"], isActive: true } as any;
    useWorkspace.getState().selectModel(local, "qwen");
    useWorkspace.setState({ model: "otro", apiConfig: { ...local, id: "x" } }); // simula una recarga
    useWorkspace.getState().setProviders([local]);
    expect(useWorkspace.getState().model).toBe("qwen");
    useWorkspace.getState().setProviders([{ ...local, enabledModels: ["gemma"] }]);
    expect(useWorkspace.getState().model).toBe("gemma"); // ya no está habilitado
  });
});

describe("settings store", () => {
  it("migra claves viejas en la primera hidratación y luego persiste", async () => {
    localStorage.setItem("nexo_run_options", JSON.stringify({ mode: "sequential", review: true }));
    localStorage.setItem("nexo_favorite_agents", JSON.stringify(["seo_specialist"]));
    const { useSettings } = await import("./settings");
    await useSettings.persist.rehydrate();
    const state = useSettings.getState();
    expect(state.runOptions).toMatchObject({ mode: "sequential", review: true, synthesize: true });
    expect(state.favorites).toEqual(["seo_specialist"]);

    state.toggleFavorite("seo_specialist");
    state.setInstruction("dev", "  usa Python  ");
    const saved = JSON.parse(localStorage.getItem("nexo_settings")!).state;
    expect(saved.favorites).toEqual([]);
    expect(saved.agentInstructions).toEqual({ dev: "usa Python" });
  });
});
