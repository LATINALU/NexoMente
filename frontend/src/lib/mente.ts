/**
 * Memoria de NexoMente (Neuromapa) vista desde la app: estado, médico y mapa en vivo.
 * Todo pasa por el backend local (/api/mente/*), que es el único que lee tus notas.
 */

export interface MenteEstado {
  habilitada: boolean;
  disponible: boolean;
}

export interface MenteSalud {
  notas: number;
  hallazgos: Record<"peligro" | "aviso" | "revisar" | "info", number>;
  destacados: Array<{ tono: string; texto: string; nota: string; linea: number | null }>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = await res.json().catch(() => null);
    throw new Error(detalle?.detail || `Error ${res.status}`);
  }
  return res.json();
}

export const menteEstado = async (): Promise<MenteEstado> =>
  fetch("/api/mente/estado").then((r) => json<MenteEstado>(r)).catch(() => ({ habilitada: false, disponible: false }));

export const menteSalud = async (): Promise<MenteSalud> => fetch("/api/mente/salud").then((r) => json<MenteSalud>(r));

/** Dirección de un solo uso del mapa en vivo (levanta su servidor si hace falta). */
export const menteMapa = async (): Promise<string> =>
  fetch("/api/mente/mapa", { method: "POST" }).then((r) => json<{ url: string }>(r)).then((d) => d.url);

export interface NotaGuardada {
  ruta: string;
  titulo: string;
  /** false: esa misma respuesta ya estaba guardada. */
  nueva: boolean;
}

/** Guarda una respuesta como nota de NexoMente, enlazada a las notas que citó. */
export const menteGuardar = async (nota: {
  titulo: string;
  contenido: string;
  fuentes?: string[];
  pregunta?: string;
  conversacion?: string;
}): Promise<NotaGuardada> =>
  fetch("/api/mente/notas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nota),
  }).then((r) => json<NotaGuardada>(r));
