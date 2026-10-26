import { describe, expect, it } from "vitest";
import { idleRun, reduceRun, RunState } from "@/core/runReducer";
import type { ServerEvent } from "@/core/protocol";
import { progressPercent, runSteps } from "./RunProgress";

function play(events: ServerEvent[]): RunState {
  return events.reduce((state, e) => reduceRun(state, e).state, idleRun());
}

const start = (review: boolean): ServerEvent => ({
  type: "pipeline_start", total_agents: 2, mode: "parallel", synthesis: true, review,
  agents: [{ id: "a", name: "A", emoji: "🅰", category: "x", specialty: "" }, { id: "b", name: "B", emoji: "🅱", category: "x", specialty: "" }],
});
const done = (id: string): ServerEvent => ({ type: "agent_response", data: { agent_id: id, agent_name: id, raw_content: "ok", timestamp: "" } });

describe("progreso de la ejecución", () => {
  it("arranca con los agentes activos y las fases siguientes pendientes", () => {
    const run = play([start(true)]);
    expect(run.startedAt).not.toBeNull();
    expect(runSteps(run).map((s) => [s.label, s.state])).toEqual([
      ["Agentes 0/2", "active"], ["Revisión", "pending"], ["Respuesta integrada", "pending"],
    ]);
  });

  it("avanza con cada agente, la revisión y la síntesis", () => {
    const half = play([start(true), done("a")]);
    expect(runSteps(half)[0].label).toBe("Agentes 1/2");
    const reviewing = play([start(true), done("a"), done("b"), { type: "review_start", agent_id: "reviewer", agent: "R" }]);
    expect(runSteps(reviewing).map((s) => s.state)).toEqual(["done", "active", "pending"]);
    const synth = play([start(true), done("a"), done("b"), { type: "review_start", agent_id: "reviewer", agent: "R" },
      { type: "review_complete", agent_id: "reviewer", agent: "R", content: "x", usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
      { type: "synthesis_start", agent_id: "coordinator", agent: "C" }]);
    expect(runSteps(synth).map((s) => s.state)).toEqual(["done", "done", "active"]);
    expect(progressPercent(synth)).toBeGreaterThan(progressPercent(reviewing));
    expect(progressPercent(synth)).toBeLessThan(100);
  });

  it("sin revisión no muestra esa fase", () => {
    expect(runSteps(play([start(false)])).map((s) => s.label)).toEqual(["Agentes 0/2", "Respuesta integrada"]);
  });
});
