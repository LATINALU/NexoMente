import { describe, expect, it } from "vitest";
import type { ChatMessage, Turn } from "@/lib/chat";
import { notaDeTurno } from "./notaDeTurno";

const msg = (content: string, extra: Partial<ChatMessage> = {}) =>
  ({ role: "assistant", content, timestamp: "", ...extra }) as ChatMessage;

const turno = (answers: ChatMessage[], extra: Partial<Turn> = {}): Turn => ({
  id: "t1", parentId: null, createdAt: "", user: msg("¿Cuánto cuesta el termo?", { role: "user" }), answers, ...extra,
});

describe("notaDeTurno", () => {
  it("guarda la síntesis, con la pregunta como título y las notas citadas como fuentes", () => {
    const nota = notaDeTurno(turno(
      [msg("Detalle del agente", { agentName: "SEO" }), msg("Cuesta 95 MXN [N1].", { isSynthesis: true }), msg("Ojo", { isReview: true })],
      { sources: [
        { label: "N1", kind: "note", title: "Precios", path: "C:/notas/precios.md", line: 3 },
        { label: "N2", kind: "note", title: "Precios", path: "C:/notas/precios.md", line: 9 },
        { label: "W1", kind: "web", title: "Web", url: "https://x.example" },
      ] },
    ));
    expect(nota).toEqual({
      titulo: "¿Cuánto cuesta el termo?", contenido: "Cuesta 95 MXN [N1].", fuentes: ["C:/notas/precios.md"],
      pregunta: "¿Cuánto cuesta el termo?",
    });
  });

  it("sin síntesis junta las respuestas de los agentes y omite lo interrumpido", () => {
    const nota = notaDeTurno(turno([msg("A dice", { agentName: "A" }), msg("B a medias", { agentName: "B", interrupted: true })]));
    expect(nota?.contenido).toBe("## A\n\nA dice");
  });

  it("acorta títulos largos y no guarda turnos vacíos", () => {
    const largo = turno([msg("ok", { isSynthesis: true })], { user: msg("x".repeat(300), { role: "user" }) });
    expect(notaDeTurno(largo)?.titulo).toHaveLength(120);
    expect(notaDeTurno(turno([msg("   ")]))).toBeNull();
  });
});
