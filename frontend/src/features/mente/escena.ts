import type { Turn } from "@/lib/chat";
import type { RunState } from "@/core/runReducer";

/**
 * Lo que el cerebro (Neuromapa, en su marco) necesita para animar una consulta: quiénes son los expertos,
 * en qué anda cada uno y qué notas leen. Sin texto de la pregunta ni de las respuestas: eso lo muestra la app.
 */
export type EstadoExperto = "espera" | "piensa" | "escribe" | "listo" | "error";

export interface ExpertoEscena {
  id: string;
  nombre: string;
  emoji: string;
  estado: EstadoExperto;
}

export interface Escena {
  id: string;
  /** false: la consulta terminó (o es una vieja): las luces vuelven al centro y se apagan */
  activa: boolean;
  notas: string[];
  expertos: ExpertoEscena[];
  coordinador: "no" | "escribe" | "listo";
}

export const escenaVacia: Escena = { id: "", activa: false, notas: [], expertos: [], coordinador: "no" };

export function escenaDe(turn: Turn | undefined, run: RunState | null, pendiente: boolean): Escena {
  if (!turn) return escenaVacia;
  const notas = Array.from(new Set((turn.sources || []).filter((s) => s.kind === "note" && s.path).map((s) => s.path as string)));
  if (!pendiente || !run?.running) return { id: turn.id, activa: false, notas, expertos: [], coordinador: "no" };
  const expertos = run.order.map((id): ExpertoEscena => {
    const vivo = run.agents[id];
    if (vivo) {
      const estado = vivo.status === "waiting" ? "espera" : vivo.status === "error" ? "error" : vivo.text ? "escribe" : "piensa";
      return { id, nombre: vivo.name, emoji: vivo.emoji, estado };
    }
    const hecha = turn.answers.find((a) => a.agentResponse?.agent_id === id);
    if (hecha) return { id, nombre: hecha.agentName || id, emoji: hecha.agentEmoji || "🤖", estado: "listo" };
    return { id, nombre: id, emoji: "⚠️", estado: "error" };
  });
  const coordinador = run.synthesis !== null ? "escribe" : turn.answers.some((a) => a.isSynthesis) ? "listo" : "no";
  return { id: turn.id, activa: true, notas, expertos, coordinador };
}
