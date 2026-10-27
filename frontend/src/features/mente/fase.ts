import type { RunState } from "@/core/runReducer";

/** En qué anda el cerebro durante una consulta: lo que dice el cartel de arriba en el Modo Cerebro. */
export type Fase = "quieto" | "busca" | "piensa" | "escriben" | "revisa" | "responde";

export const TEXTO_FASE: Record<Fase, string> = {
  quieto: "",
  busca: "Buscando en tus notas y en la web",
  piensa: "El cerebro está pensando",
  escriben: "Los expertos escriben",
  revisa: "Revisando lo que escribieron",
  responde: "Generando la respuesta",
};

export function faseDe(run: RunState | null): Fase {
  if (!run?.running) return "quieto";
  if (run.synthesis !== null) return "responde";
  if (run.review !== null) return "revisa";
  if (run.research) return "busca";
  const activos = run.order.map((id) => run.agents[id]).filter(Boolean);
  if (activos.some((a) => a.text)) return "escriben";
  return "piensa";
}

/** El recuadro de la respuesta salta cuando hay algo para leer: la síntesis en curso o la consulta terminada. */
export function hayRespuesta(fase: Fase, terminada: boolean, sinSintesis: boolean): boolean {
  return fase === "responde" || terminada || (sinSintesis && fase === "escriben");
}
