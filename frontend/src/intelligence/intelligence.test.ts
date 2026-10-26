import { describe, expect, it } from "vitest";
import { analyzeQuery, contextTemplate, CoachContext } from "./queryCoach";
import { estimateRun } from "./estimator";
import { analyzeTeam } from "./teamInsights";
import type { RunOptions, Turn } from "@/lib/chat";

const ctx = (over: Partial<CoachContext>): CoachContext => ({
  text: "", attachments: 0, webReady: true, webOn: false, reviewOn: false, selectedAgents: 2, hasHistory: false, ...over,
});

describe("queryCoach", () => {
  it("sugiere búsqueda web para datos actuales (o configurarla)", () => {
    expect(analyzeQuery(ctx({ text: "¿Cuál es el precio del cobre hoy en Chile?" }))[0]).toMatchObject({ action: "enable-web" });
    expect(analyzeQuery(ctx({ text: "Últimas noticias de IA", webReady: false }))[0]).toMatchObject({ action: "configure-web" });
    expect(analyzeQuery(ctx({ text: "Últimas noticias de IA", webOn: true })).find((t) => t.id === "recency")).toBeUndefined();
  });

  it("detecta archivos mencionados y textos muy largos", () => {
    expect(analyzeQuery(ctx({ text: "Revisá el contrato que te paso y decime riesgos" })).map((t) => t.id)).toContain("file");
    expect(analyzeQuery(ctx({ text: "Revisá el contrato", attachments: 1 })).map((t) => t.id)).not.toContain("file");
    expect(analyzeQuery(ctx({ text: "x ".repeat(4000) })).map((t) => t.id)).toContain("long");
  });

  it("advierte credenciales pegadas por error", () => {
    const tips = analyzeQuery(ctx({ text: "usa mi key sk-abcdefghijklmnopqrstuvwx para conectar" }));
    expect(tips[0]).toMatchObject({ id: "secret", level: "warn" });
    expect(analyzeQuery(ctx({ text: "password: hunter2xyz en el login" }))[0].id).toBe("secret");
  });

  it("pide contexto en consultas breves y revisión en temas sensibles", () => {
    expect(analyzeQuery(ctx({ text: "plan de marketing" })).map((t) => t.id)).toContain("context");
    expect(analyzeQuery(ctx({ text: "plan de marketing", hasHistory: true })).map((t) => t.id)).not.toContain("context");
    expect(analyzeQuery(ctx({ text: "Necesito armar un contrato de alquiler comercial con cláusulas de salida" })).map((t) => t.id)).toContain("stakes");
    expect(contextTemplate("Plan")).toMatch(/^Plan\n\nObjetivo:/);
  });

  it("limita a 3 sugerencias y no molesta con texto vacío", () => {
    expect(analyzeQuery(ctx({ text: "   " }))).toEqual([]);
    expect(analyzeQuery(ctx({ text: "contrato hoy sk-abcdefghijklmnopqrstuvwx", selectedAgents: 0 })).length).toBeLessThanOrEqual(3);
  });
});

const options = (over: Partial<RunOptions> = {}): RunOptions => ({
  mode: "parallel", synthesize: true, webSearch: false, toolMode: "prefetch", review: false, followups: true, reasoning: "auto", ...over,
});

describe("estimateRun", () => {
  const base = { agents: 3, inputChars: 400, historyChars: 0, documents: 0, webReady: true, previousTurns: [] as Turn[] };

  it("cuenta las llamadas según las opciones", () => {
    expect(estimateRun({ ...base, options: options() })!.calls).toBe(5); // 3 + síntesis + seguimientos
    expect(estimateRun({ ...base, options: options({ review: true, webSearch: true }) })!.calls).toBe(7);
    expect(estimateRun({ ...base, agents: 1, options: options({ followups: false }) })!.calls).toBe(1); // sin síntesis con 1
    expect(estimateRun({ ...base, agents: 0, options: options() })).toBeNull();
  });

  it("más contexto y opciones => más tokens; con precio estima costo", () => {
    const plain = estimateRun({ ...base, options: options() })!;
    const heavy = estimateRun({ ...base, documents: 2, options: options({ review: true, webSearch: true }), price: { input: 1, output: 4 } })!;
    expect(heavy.tokensLow).toBeGreaterThan(plain.tokensLow);
    expect(plain.costLow).toBeNull();
    expect(heavy.costHigh!).toBeGreaterThan(heavy.costLow!);
  });

  it("se calibra con turnos anteriores", () => {
    const turn = { stats: { totalTokens: 30_000, agents: 3, elapsedMs: 1, failed: 0 } } as unknown as Turn;
    const est = estimateRun({ ...base, options: options(), previousTurns: [turn] })!;
    expect(est.calibrated).toBe(true);
    expect(est.tokensHigh).toBeGreaterThan(est.tokensLow);
  });
});

describe("analyzeTeam", () => {
  const agent = (id: string, category: string) => ({ id, category, name: id, description: "", emoji: "", capabilities: [], specialization: "", complexity: "" });

  it("detecta equipos grandes, monotemáticos y sin síntesis", () => {
    const seven = Array.from({ length: 7 }, (_, i) => agent(`a${i}`, i % 2 ? "legal" : "finance"));
    expect(analyzeTeam(seven, { synthesize: true, review: false }).insights[0].id).toBe("big");
    const mono = Array.from({ length: 4 }, (_, i) => agent(`m${i}`, "marketing"));
    expect(analyzeTeam(mono, { synthesize: true, review: false }).insights.map((i) => i.id)).toEqual(["mono"]);
    const three = [agent("a", "x"), agent("b", "y"), agent("c", "z")];
    expect(analyzeTeam(three, { synthesize: false, review: false }).insights.map((i) => i.id)).toEqual(["nosynth"]);
    expect(analyzeTeam(three, { synthesize: true, review: false }).categories).toHaveLength(3);
  });
});

describe("coach: modelo local", () => {
  it("sugiere apagar el razonamiento solo con modelo local y razonamiento activo", () => {
    const base = { text: "Plan de marketing para mi tienda online de ropa", attachments: 0, webReady: false, webOn: false,
                   reviewOn: false, selectedAgents: 2, hasHistory: false };
    expect(analyzeQuery({ ...base, localModel: true, reasoning: "auto" }).some((t) => t.action === "reasoning-off")).toBe(true);
    expect(analyzeQuery({ ...base, localModel: true, reasoning: "none" }).some((t) => t.action === "reasoning-off")).toBe(false);
    expect(analyzeQuery({ ...base, localModel: false, reasoning: "auto" }).some((t) => t.action === "reasoning-off")).toBe(false);
  });
});
