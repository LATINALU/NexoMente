import { describe, expect, it } from "vitest";
import { ServerEvent, parseServerEvent } from "./protocol";
import { RunEffect, RunState, idleRun, interruptedAnswers, reduceRun } from "./runReducer";

function play(events: ServerEvent[], start: RunState = idleRun()) {
  let state = start;
  const effects: RunEffect[] = [];
  for (const e of events) {
    const out = reduceRun(state, e);
    state = out.state;
    effects.push(...out.effects);
  }
  return { state, effects };
}

const start: ServerEvent = {
  type: "pipeline_start", total_agents: 2, mode: "parallel", synthesis: true, tool_mode: "native",
  agents: [{ id: "a", name: "Dev", emoji: "💻", category: "x", specialty: "" }, { id: "b", name: "SEO", emoji: "🔍", category: "y", specialty: "" }],
};

describe("reduceRun", () => {
  it("el cálculo de costos queda como respuesta marcada", () => {
    const raw = { type: "calculation", title: "Cálculo de costos", content: "| Precio | $249 |" };
    const event = parseServerEvent(raw)!;
    expect(event).not.toBeNull();
    expect(parseServerEvent({ type: "calculation" })).toBeNull();
    const { effects } = play([start, event]);
    expect(effects[0]).toMatchObject({ kind: "answer", message: { isCalculation: true, agentEmoji: "🧮", content: "| Precio | $249 |" } });
  });

  it("acumula tokens por agente y emite la respuesta al terminar", () => {
    const { state, effects } = play([
      start,
      { type: "agent_start", agent_id: "a", agent: "Dev", step: 1, total: 2 },
      { type: "agent_token", agent_id: "a", delta: "Hola " },
      { type: "agent_token", agent_id: "a", delta: "mundo" },
    ]);
    expect(state.running && state.toolMode).toBe("native");
    expect(state.agents.a).toMatchObject({ status: "streaming", text: "Hola mundo" });
    expect(effects).toEqual([]);

    const done = reduceRun(state, { type: "agent_response", data: { agent_id: "a", agent_name: "Dev", raw_content: "Hola mundo", timestamp: "" } });
    expect(done.state.agents.a).toBeUndefined();
    expect(done.effects[0]).toMatchObject({ kind: "answer", message: { role: "agent", content: "Hola mundo", agentName: "Dev" } });
  });

  it("registra herramientas, investigación y fuentes", () => {
    const { state, effects } = play([
      start,
      { type: "research_start" },
      { type: "research_queries", queries: ["q1"] },
      { type: "tool_call", agent_id: "b", agent: "SEO", tool: "buscar_web", query: "cobre" },
    ]);
    expect(state.research).toEqual({ queries: ["q1"] });
    expect(state.agents.b.tools).toEqual([{ tool: "buscar_web", query: "cobre" }]);
    const ready = reduceRun(state, { type: "context_ready", sources: [{ label: "W1", kind: "web", title: "t" }] });
    expect(ready.state.research).toBeNull();
    expect(ready.effects).toEqual([{ kind: "sources", sources: [{ label: "W1", kind: "web", title: "t" }] }]);
    expect(effects).toEqual([]);
  });

  it("convierte errores de agente en respuestas y los del Coordinador en avisos", () => {
    const { effects } = play([
      start,
      { type: "agent_error", agent_id: "a", agent: "Dev", error: "API key inválida" },
      { type: "synthesis_start", agent_id: "coordinator", agent: "Coordinador" },
      { type: "agent_error", agent_id: "coordinator", agent: "Coordinador", error: "timeout" },
    ]);
    expect(effects[0]).toMatchObject({ kind: "answer", message: { content: "⚠️ API key inválida", agentName: "Dev" } });
    expect(effects[1]).toMatchObject({ kind: "notice" });
  });

  it("revisión y síntesis quedan marcadas en sus mensajes", () => {
    const { effects } = play([
      start,
      { type: "review_start", agent_id: "reviewer", agent: "Revisor" },
      { type: "review_token", agent_id: "reviewer", delta: "- falta X" },
      { type: "review_complete", agent_id: "reviewer", agent: "Revisor", content: "- falta X", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      { type: "synthesis_complete", agent_id: "coordinator", agent: "C", content: "Final", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      { type: "followups", questions: ["¿Y?"] },
    ]);
    expect(effects.map((e) => e.kind)).toEqual(["answer", "answer", "followups"]);
    expect((effects[0] as any).message.isReview).toBe(true);
    expect((effects[1] as any).message.isSynthesis).toBe(true);
  });

  it("al cancelar conserva lo generado como interrumpido", () => {
    const { state } = play([start, { type: "agent_token", agent_id: "a", delta: "parcial" }, { type: "synthesis_start", agent_id: "coordinator", agent: "C" }, { type: "synthesis_token", agent_id: "coordinator", delta: "sín" }]);
    expect(interruptedAnswers(state).map((m) => [m.content, m.interrupted, !!m.isSynthesis])).toEqual([["parcial", true, false], ["sín", true, true]]);
    const out = reduceRun(state, { type: "pipeline_cancelled" });
    expect(out.state.running).toBe(false);
    expect(out.effects.map((e) => e.kind)).toEqual(["answer", "answer", "cancelled"]);
  });

  it("pipeline_complete y error vuelven a idle", () => {
    expect(reduceRun(play([start]).state, { type: "error", message: "x" })).toMatchObject({ state: { running: false }, effects: [{ kind: "error", text: "x" }] });
    const summary = { agents_count: 1, processing_time_ms: 1, usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }, failed: [], has_synthesis: false, sources: [] };
    expect(reduceRun(play([start]).state, { type: "pipeline_complete", data: summary }).effects).toEqual([{ kind: "complete", summary }]);
  });
});

describe("parseServerEvent", () => {
  it("descarta formas inválidas o tipos desconocidos", () => {
    expect(parseServerEvent(null)).toBeNull();
    expect(parseServerEvent({ type: "hack" })).toBeNull();
    expect(parseServerEvent({ type: "agent_token", agent_id: "a" })).toBeNull();
    expect(parseServerEvent({ type: "agent_token", agent_id: "a", delta: "x" })).not.toBeNull();
    expect(parseServerEvent({ type: "agent_response", data: {} })).toBeNull();
  });
});

describe("razonamiento", () => {
  it("acumula solo la cola del thinking por agente, sin tocar la respuesta", () => {
    const long = "x".repeat(1000);
    const { state, effects } = play([start, { type: "thinking", agent_id: "a", delta: long }, { type: "thinking", agent_id: "a", delta: "FIN" }]);
    expect(state.thinking.a.length).toBe(800);
    expect(state.thinking.a.endsWith("FIN")).toBe(true);
    expect(state.agents.a.text).toBe("");
    expect(effects).toEqual([]);
  });
});
