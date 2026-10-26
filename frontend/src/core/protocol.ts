/**
 * Protocolo de eventos del orquestador (backend/app/services/orchestrator.py).
 * Unión discriminada por `type`: cada evento del WebSocket/SSE tiene su forma exacta.
 * Mantener sincronizado con el backend; `parseServerEvent` descarta lo desconocido.
 */

import type { AgentResponseData, Source } from "@/lib/chat";

export interface UsageDTO {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface PublicAgent {
  id: string;
  name: string;
  emoji: string;
  category: string;
  specialty: string;
}

export interface PipelineSummary {
  agents_count: number;
  processing_time_ms: number;
  usage: UsageDTO;
  failed: string[];
  has_synthesis: boolean;
  has_review?: boolean;
  sources: Source[];
  followups?: string[];
}

type WithAgent = { agent_id: string; agent: string };

export type ServerEvent =
  | { type: "connected" }
  | { type: "pipeline_started"; agents: string[]; model: string }
  | { type: "pipeline_start"; agents: PublicAgent[]; total_agents: number; mode: string; synthesis: boolean;
      review?: boolean; web_search?: boolean; documents?: number; tool_mode?: "prefetch" | "native" }
  | { type: "research_start" }
  | { type: "research_queries"; queries: string[] }
  | { type: "context_ready"; sources: Source[] }
  /** Cálculo determinístico de costos (agentes de Mercado Libre), en markdown */
  | { type: "calculation"; title: string; content: string }
  | ({ type: "tool_call"; tool: string; query: string } & WithAgent)
  | ({ type: "agent_start"; step: number; total: number } & WithAgent)
  | { type: "agent_token"; agent_id: string; delta: string }
  /** Razonamiento interno del modelo ("thinking"), si el proveedor lo envía */
  | { type: "thinking"; agent_id: string; delta: string }
  | { type: "agent_response"; data: AgentResponseData }
  | ({ type: "agent_error"; error: string } & WithAgent)
  | ({ type: "review_start" } & WithAgent)
  | { type: "review_token"; agent_id: string; delta: string }
  | ({ type: "review_complete"; content: string; usage: UsageDTO } & WithAgent)
  | ({ type: "synthesis_start" } & WithAgent)
  | { type: "synthesis_token"; agent_id: string; delta: string }
  | ({ type: "synthesis_complete"; content: string; usage: UsageDTO } & WithAgent)
  | { type: "followups"; questions: string[] }
  | { type: "pipeline_complete"; data: PipelineSummary }
  | { type: "pipeline_cancelled" }
  | { type: "warning"; message: string }
  | { type: "error"; message: string }
  | { type: "stream_complete" };

export type ServerEventType = ServerEvent["type"];

const KNOWN = new Set<ServerEventType>([
  "connected", "pipeline_started", "pipeline_start", "research_start", "research_queries", "context_ready",
  "calculation", "tool_call", "agent_start", "agent_token", "thinking", "agent_response", "agent_error", "review_start", "review_token",
  "review_complete", "synthesis_start", "synthesis_token", "synthesis_complete", "followups",
  "pipeline_complete", "pipeline_cancelled", "warning", "error", "stream_complete",
]);

/** Valida la forma mínima de un evento; devuelve null si no es reconocible. */
export function parseServerEvent(raw: unknown): ServerEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as { type?: unknown };
  if (typeof event.type !== "string" || !KNOWN.has(event.type as ServerEventType)) return null;
  const e = raw as Record<string, unknown>;
  switch (event.type) {
    case "agent_token":
    case "thinking":
    case "review_token":
    case "synthesis_token":
      return typeof e.delta === "string" && typeof e.agent_id === "string" ? (raw as ServerEvent) : null;
    case "agent_response":
      return e.data && typeof (e.data as any).agent_id === "string" ? (raw as ServerEvent) : null;
    case "calculation":
      return typeof e.content === "string" ? (raw as ServerEvent) : null;
    case "pipeline_complete":
      return e.data && typeof e.data === "object" ? (raw as ServerEvent) : null;
    default:
      return raw as ServerEvent;
  }
}
