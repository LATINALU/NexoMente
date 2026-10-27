import { describe, expect, it } from "vitest";
import type { ChatMessage, Turn } from "@/lib/chat";
import { idleRun, RunState } from "@/core/runReducer";
import { escenaDe, escenaVacia } from "./escena";

const turno = (extra: Partial<Turn> = {}): Turn => ({
  id: "t1", parentId: null, createdAt: "", user: { role: "user", content: "¿termo?", timestamp: new Date() }, answers: [],
  sources: [
    { label: "N1", kind: "note", title: "Precios", path: "C:/notas/precios.md" },
    { label: "N2", kind: "note", title: "Precios", path: "C:/notas/precios.md" },
    { label: "W1", kind: "web", title: "Web", url: "https://x.example" },
  ],
  ...extra,
});

const corrida = (patch: Partial<RunState>): RunState => ({ ...idleRun(), running: true, order: ["seo", "dev", "ml"], ...patch });

describe("escenaDe", () => {
  it("sin turno no hay escena", () => {
    expect(escenaDe(undefined, null, false)).toEqual(escenaVacia);
  });

  it("cada experto lleva su estado y las notas citadas van sin repetir", () => {
    const hecha: ChatMessage = { role: "agent", content: "ok", timestamp: new Date(), agentName: "ML", agentEmoji: "📦",
      agentResponse: { agent_id: "ml" } as ChatMessage["agentResponse"] };
    const run = corrida({ agents: {
      seo: { id: "seo", name: "SEO", emoji: "📈", text: "", status: "waiting" },
      dev: { id: "dev", name: "Dev", emoji: "💻", text: "hola", status: "streaming" },
    } });
    const escena = escenaDe(turno({ answers: [hecha] }), run, true);
    expect(escena.notas).toEqual(["C:/notas/precios.md"]);
    expect(escena.expertos.map((e) => [e.id, e.estado])).toEqual([["seo", "espera"], ["dev", "escribe"], ["ml", "listo"]]);
    expect(escena.activa).toBe(true);
    expect(escena.coordinador).toBe("no");
  });

  it("un experto que ya no está y no respondió falló; el coordinador escribe y después termina", () => {
    const run = corrida({ order: ["dev"], synthesis: "Cuesta" });
    const escribiendo = escenaDe(turno(), run, true);
    expect(escribiendo.expertos[0].estado).toBe("error");
    expect(escribiendo.coordinador).toBe("escribe");
    const sintesis: ChatMessage = { role: "assistant", content: "Cuesta 95", timestamp: new Date(), isSynthesis: true };
    expect(escenaDe(turno({ answers: [sintesis] }), corrida({ order: [] }), true).coordinador).toBe("listo");
  });

  it("una consulta terminada apaga la escena", () => {
    const escena = escenaDe(turno(), idleRun(), false);
    expect(escena).toEqual({ id: "t1", activa: false, notas: ["C:/notas/precios.md"], expertos: [], coordinador: "no" });
  });
});
