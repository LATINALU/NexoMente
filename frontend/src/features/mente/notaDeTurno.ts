import type { Turn } from "@/lib/chat";

const MAX_TITULO = 120;

export interface NotaDeTurno {
  titulo: string;
  contenido: string;
  fuentes: string[];
  pregunta: string;
}

/**
 * Lo que se recuerda de un turno: la respuesta integrada del Coordinador, o (sin síntesis) las respuestas
 * de los agentes con su nombre. La revisión crítica y lo interrumpido no se guardan. Las notas citadas [N#]
 * quedan como enlaces, así en el cerebro la nota nueva aparece conectada a sus fuentes.
 */
export function notaDeTurno(turn: Turn): NotaDeTurno | null {
  const completas = turn.answers.filter((a) => a.content.trim() && !a.isReview && !a.interrupted);
  const sintesis = completas.find((a) => a.isSynthesis);
  const contenido = sintesis
    ? sintesis.content.trim()
    : completas.map((a) => `## ${a.agentName || "Agente"}\n\n${a.content.trim()}`).join("\n\n");
  if (!contenido) return null;
  const pregunta = turn.user.content.trim();
  const primera = pregunta.split("\n").find((l) => l.trim()) || "Nota de NexoMente";
  const titulo = primera.length > MAX_TITULO ? `${primera.slice(0, MAX_TITULO - 1).trimEnd()}…` : primera.trim();
  const fuentes = (turn.sources || []).filter((s) => s.kind === "note" && s.path).map((s) => s.path as string);
  return { titulo, contenido, fuentes: Array.from(new Set(fuentes)), pregunta };
}
