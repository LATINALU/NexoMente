import { describe, expect, it } from "vitest";
import { idleRun, RunState } from "@/core/runReducer";
import { faseDe, hayRespuesta } from "./fase";

const corriendo = (patch: Partial<RunState> = {}): RunState => ({
  ...idleRun(), running: true, order: ["a"], agents: { a: { id: "a", name: "A", emoji: "🅰", text: "", status: "streaming" } }, ...patch,
});

describe("faseDe", () => {
  it("sin corrida está quieto", () => {
    expect(faseDe(null)).toBe("quieto");
    expect(faseDe(idleRun())).toBe("quieto");
  });

  it("sigue las fases de la consulta", () => {
    expect(faseDe(corriendo({ research: { queries: [] } }))).toBe("busca");
    expect(faseDe(corriendo())).toBe("piensa");
    expect(faseDe(corriendo({ agents: { a: { id: "a", name: "A", emoji: "🅰", text: "hola", status: "streaming" } } }))).toBe("escriben");
    expect(faseDe(corriendo({ agents: {}, review: "" }))).toBe("revisa");
    expect(faseDe(corriendo({ agents: {}, synthesis: "" }))).toBe("responde");
  });
});

describe("hayRespuesta", () => {
  it("salta con la síntesis, al terminar, o con los expertos si no hay síntesis", () => {
    expect(hayRespuesta("piensa", false, false)).toBe(false);
    expect(hayRespuesta("escriben", false, false)).toBe(false);
    expect(hayRespuesta("escriben", false, true)).toBe(true);
    expect(hayRespuesta("responde", false, false)).toBe(true);
    expect(hayRespuesta("quieto", true, false)).toBe(true);
  });
});
