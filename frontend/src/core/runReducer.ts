/**
 * Estado de una ejecución en vivo como reducer puro.
 *
 *   reduceRun(state, event) -> { state, effects }
 *
 * `state` es lo efímero (texto que se está escribiendo, quién está en cola, búsqueda en curso).
 * `effects` es lo que debe quedar en el turno (respuestas terminadas, fuentes, seguimientos,
 * estadísticas) más avisos para la UI. La sesión aplica los efectos; así la lógica del
 * protocolo se prueba sin React ni WebSocket.
 */

import type { ChatMessage, LiveAgent, Source } from "@/lib/chat";
import type { PipelineSummary, ServerEvent } from "@/core/protocol";

export interface RunState {
  running: boolean;
  agents: Record<string, LiveAgent>;
  order: string[];
  research: { queries: string[] } | null;
  review: string | null;
  synthesis: string | null;
  /** Últimos caracteres del razonamiento por agente (incluye "reviewer" y "coordinator") */
  thinking: Record<string, string>;
  toolMode: "prefetch" | "native";
  /** Para la barra de progreso: cuándo empezó y qué fases habrá */
  startedAt: number | null;
  plan: { review: boolean; synthesis: boolean };
  reviewDone: boolean;
}

export type RunEffect =
  | { kind: "answer"; message: ChatMessage }
  | { kind: "sources"; sources: Source[] }
  | { kind: "followups"; questions: string[] }
  | { kind: "complete"; summary: PipelineSummary }
  | { kind: "notice"; text: string }
  | { kind: "error"; text: string }
  | { kind: "cancelled" };

const THINKING_TAIL = 800;

export const idleRun = (): RunState => ({
  running: false, agents: {}, order: [], research: null, review: null, synthesis: null, thinking: {}, toolMode: "prefetch",
  startedAt: null, plan: { review: false, synthesis: false }, reviewDone: false,
});

const without = (agents: Record<string, LiveAgent>, id: string) => {
  const next = { ...agents };
  delete next[id];
  return next;
};

const patchAgent = (state: RunState, id: string, patch: (a: LiveAgent) => LiveAgent): RunState =>
  state.agents[id] ? { ...state, agents: { ...state.agents, [id]: patch(state.agents[id]) } } : state;

export function reduceRun(state: RunState, event: ServerEvent): { state: RunState; effects: RunEffect[] } {
  const same = { state, effects: [] as RunEffect[] };
  switch (event.type) {
    case "pipeline_start": {
      const agents: Record<string, LiveAgent> = {};
      for (const a of event.agents) agents[a.id] = { id: a.id, name: a.name, emoji: a.emoji || "🤖", text: "", status: "waiting" };
      return {
        state: {
          ...idleRun(), running: true, agents, order: event.agents.map((a) => a.id), toolMode: event.tool_mode || "prefetch",
          startedAt: Date.now(), plan: { review: !!event.review, synthesis: !!event.synthesis },
        },
        effects: [],
      };
    }
    case "research_start":
      return { state: { ...state, research: { queries: [] } }, effects: [] };
    case "research_queries":
      return { state: { ...state, research: { queries: event.queries } }, effects: [] };
    case "context_ready":
      return { state: { ...state, research: null }, effects: [{ kind: "sources", sources: event.sources }] };
    case "calculation":
      return {
        state,
        effects: [{ kind: "answer", message: { role: "assistant", content: event.content, timestamp: new Date(), isCalculation: true,
                                               agentName: event.title || "Cálculo de costos", agentEmoji: "🧮" } }],
      };
    case "tool_call":
      return {
        state: patchAgent(state, event.agent_id, (a) => ({ ...a, tools: [...(a.tools || []), { tool: event.tool, query: event.query }] })),
        effects: [],
      };
    case "agent_start":
      return { state: patchAgent(state, event.agent_id, (a) => ({ ...a, status: "streaming" })), effects: [] };
    case "thinking":
      return {
        state: { ...state, thinking: { ...state.thinking, [event.agent_id]: ((state.thinking[event.agent_id] || "") + event.delta).slice(-THINKING_TAIL) } },
        effects: [],
      };
    case "agent_token":
      return { state: patchAgent(state, event.agent_id, (a) => ({ ...a, status: "streaming", text: a.text + event.delta })), effects: [] };
    case "agent_response": {
      const r = event.data;
      return {
        state: { ...state, agents: without(state.agents, r.agent_id) },
        effects: [{
          kind: "answer",
          message: { role: "agent", content: r.raw_content || r.summary || "", timestamp: new Date(), agentResponse: r,
                     agentName: r.agent_name, agentEmoji: r.agent_emoji },
        }],
      };
    }
    case "agent_error":
      if (event.agent_id === "coordinator" || event.agent_id === "reviewer") {
        return {
          state: { ...state, [event.agent_id === "coordinator" ? "synthesis" : "review"]: null,
                 reviewDone: state.reviewDone || event.agent_id === "reviewer" },
          effects: [{ kind: "notice", text: `${event.agent} no pudo completar: ${event.error}` }],
        };
      }
      return {
        state: { ...state, agents: without(state.agents, event.agent_id) },
        effects: [{
          kind: "answer",
          message: { role: "agent", content: `⚠️ ${event.error}`, timestamp: new Date(),
                     agentName: state.agents[event.agent_id]?.name || event.agent, agentEmoji: "⚠️" },
        }],
      };
    case "review_start":
      return { state: { ...state, review: "" }, effects: [] };
    case "review_token":
      return { state: { ...state, review: (state.review ?? "") + event.delta }, effects: [] };
    case "review_complete":
      return {
        state: { ...state, review: null, reviewDone: true },
        effects: [{ kind: "answer", message: { role: "assistant", content: event.content, timestamp: new Date(), isReview: true,
                                               agentName: "Revisor crítico", agentEmoji: "🔍" } }],
      };
    case "synthesis_start":
      return { state: { ...state, synthesis: "" }, effects: [] };
    case "synthesis_token":
      return { state: { ...state, synthesis: (state.synthesis ?? "") + event.delta }, effects: [] };
    case "synthesis_complete":
      return {
        state: { ...state, synthesis: null },
        effects: [{ kind: "answer", message: { role: "assistant", content: event.content, timestamp: new Date(), isSynthesis: true } }],
      };
    case "followups":
      return { state, effects: [{ kind: "followups", questions: event.questions }] };
    case "pipeline_complete":
      return { state: idleRun(), effects: [{ kind: "complete", summary: event.data }] };
    case "pipeline_cancelled":
      return { state: idleRun(), effects: [...interruptedAnswers(state).map((message) => ({ kind: "answer" as const, message })), { kind: "cancelled" }] };
    case "warning":
      return { state, effects: [{ kind: "notice", text: event.message }] };
    case "error":
      return { state: idleRun(), effects: [{ kind: "error", text: event.message || "Error inesperado" }] };
    default:
      return same;
  }
}

/** Lo que se alcanzó a generar, como respuestas marcadas "interrumpidas". */
export function interruptedAnswers(state: RunState): ChatMessage[] {
  const out: ChatMessage[] = state.order
    .map((id) => state.agents[id])
    .filter((a): a is LiveAgent => !!a && !!a.text.trim())
    .map((a) => ({ role: "agent", content: a.text, timestamp: new Date(), agentName: a.name, agentEmoji: a.emoji, interrupted: true }));
  if (state.review?.trim()) out.push({ role: "assistant", content: state.review, timestamp: new Date(), isReview: true, interrupted: true, agentName: "Revisor crítico", agentEmoji: "🔍" });
  if (state.synthesis?.trim()) out.push({ role: "assistant", content: state.synthesis, timestamp: new Date(), isSynthesis: true, interrupted: true });
  return out;
}
