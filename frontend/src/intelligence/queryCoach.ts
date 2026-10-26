/**
 * Coach de consultas: analiza lo que la persona está escribiendo (sin llamar a ningún modelo)
 * y sugiere cómo obtener una mejor respuesta. Reglas simples, explicables y testeables.
 */

export type CoachAction = "enable-web" | "configure-web" | "attach" | "suggest-team" | "add-context" | "enable-review" | "reasoning-off";

export interface CoachTip {
  id: string;
  level: "info" | "warn";
  text: string;
  action?: CoachAction;
  actionLabel?: string;
}

export interface CoachContext {
  text: string;
  attachments: number;
  webReady: boolean;
  webOn: boolean;
  reviewOn: boolean;
  selectedAgents: number;
  hasHistory: boolean;
  /** Modelo local (Ollama/LM Studio): el razonamiento lo vuelve varias veces más lento */
  localModel?: boolean;
  reasoning?: string;
}

const norm = (t: string) => t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

const RECENCY = /\b(hoy|actual(es|mente)?|ultim[oa]s?|reciente(s|mente)?|esta semana|este mes|este ano|noticias?|precio(s)? (de|del)|cotizacion|tendencias? (de|del|en) 20\d\d|20(2[5-9]|3\d)|today|latest|current(ly)?|this (week|month|year)|news|price of)\b/;
const MENTIONS_FILE = /\b(adjunt[oa]|archivo|documento|pdf|planilla|excel|contrato|informe|reporte|este (texto|doc|cv|curriculum)|mi cv|attached|this (file|document|pdf))\b/;
const HIGH_STAKES = /\b(legal(es)?|contrato|demanda|impuestos?|fiscal|medic[oa]|diagnostico|dosis|inversion(es)?|financier[oa]|seguridad|compliance|lawsuit|tax|medical|dosage|investment)\b/;
const SECRET = /(sk-[a-z0-9_-]{16,}|gsk_[a-z0-9]{16,}|tvly-[a-z0-9]{12,}|ghp_[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(password|contrasena|clave|api[_ ]?key|token)\s*[:=]\s*\S{6,})/i;

export const LONG_TEXT_CHARS = 6000;

export function analyzeQuery(ctx: CoachContext): CoachTip[] {
  const raw = ctx.text.trim();
  if (!raw) return [];
  const t = norm(raw);
  const words = t.split(/\s+/).filter(Boolean).length;
  const tips: CoachTip[] = [];

  if (SECRET.test(raw)) {
    tips.push({ id: "secret", level: "warn", text: "Parece que pegaste una credencial o contraseña. Quitala antes de enviar: se manda al proveedor de IA." });
  }
  if (ctx.selectedAgents === 0) {
    tips.push({ id: "no-agents", level: "warn", text: "No hay agentes seleccionados.", action: "suggest-team", actionLabel: "Sugerir equipo" });
  }
  if (ctx.localModel && ctx.reasoning !== "none" && ctx.selectedAgents > 0) {
    tips.push({ id: "local-reasoning", level: "info", text: "Modelo local: con el razonamiento apagado responde varias veces más rápido.",
                action: "reasoning-off", actionLabel: "Apagar razonamiento" });
  }
  if (RECENCY.test(t) && !ctx.webOn) {
    tips.push(ctx.webReady
      ? { id: "recency", level: "info", text: "Pedís información actual: los modelos tienen fecha de corte.", action: "enable-web", actionLabel: "Buscar en la web" }
      : { id: "recency", level: "info", text: "Pedís información actual: configura un buscador para datos recientes.", action: "configure-web", actionLabel: "Configurar" });
  }
  if (MENTIONS_FILE.test(t) && ctx.attachments === 0) {
    tips.push({ id: "file", level: "info", text: "Mencionás un archivo pero no hay ninguno adjunto.", action: "attach", actionLabel: "Adjuntar" });
  }
  if (raw.length > LONG_TEXT_CHARS) {
    tips.push({ id: "long", level: "info", text: "Texto muy largo: adjuntarlo como documento permite citarlo por fragmentos y gasta menos.", action: "attach", actionLabel: "Adjuntar" });
  }
  if (!ctx.hasHistory && words > 0 && words < 6 && raw.length < 40) {
    tips.push({ id: "context", level: "info", text: "Consulta breve: sumá objetivo, contexto (empresa, país, público) y formato esperado.", action: "add-context", actionLabel: "Usar plantilla" });
  }
  if (HIGH_STAKES.test(t) && !ctx.reviewOn && ctx.selectedAgents > 0) {
    tips.push({ id: "stakes", level: "info", text: "Tema sensible: la revisión crítica ayuda a detectar errores.", action: "enable-review", actionLabel: "Activar revisión" });
  }
  return tips.slice(0, 3);
}

/** Plantilla para enriquecer una consulta breve. */
export function contextTemplate(text: string): string {
  return `${text.trim()}\n\nObjetivo: \nContexto (empresa, país, público): \nRestricciones (presupuesto, plazos, herramientas): \nFormato esperado (plan, tabla, código, checklist): `;
}
