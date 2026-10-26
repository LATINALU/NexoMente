/**
 * Modelo de datos del chat multi-agente y utilidades puras:
 * árbol de turnos (ramas), historial para contexto, exportación, streaming SSE.
 */

export interface AgentResponseData {
  agent_id: string;
  agent_name: string;
  agent_emoji?: string;
  level?: number;
  specialty?: string;
  category?: string;
  format_type?: string;
  raw_content?: string;
  summary?: string;
  sections?: Array<{ type: string; title?: string; content?: string; items?: string[] }>;
  elapsed_ms?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  timestamp: string;
}

export type ChatRole = "user" | "agent" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: Date;
  agentResponse?: AgentResponseData;
  agentName?: string;
  agentEmoji?: string;
  /** true para la respuesta integrada del Coordinador */
  isSynthesis?: boolean;
  /** true para las observaciones del Revisor crítico */
  isReview?: boolean;
  /** true para el cálculo de costos hecho por Nexo con código (agentes de Mercado Libre) */
  isCalculation?: boolean;
  /** true si el usuario detuvo la generación a mitad */
  interrupted?: boolean;
}

export interface Source {
  label: string; // D1, W2…
  kind: "document" | "web";
  title: string;
  url?: string;
  document_id?: string;
  chunk?: number;
}

export interface LiveAgent {
  id: string;
  name: string;
  emoji: string;
  text: string;
  status: "waiting" | "streaming" | "error";
  error?: string;
  /** búsquedas que hizo con herramientas nativas */
  tools?: Array<{ tool: string; query: string }>;
}

export interface RunStats {
  elapsedMs: number;
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  /** USD, si el modelo tiene precio configurado */
  cost?: number | null;
  model?: string;
  agents: number;
  failed: number;
}

export type RunMode = "parallel" | "sequential";

/** prefetch: búsqueda previa para todos · native: cada agente usa herramientas (function calling) */
export type ToolMode = "prefetch" | "native";

/** Esfuerzo de razonamiento de los modelos que "piensan" · auto: lo decide el proveedor */
export type ReasoningLevel = "auto" | "none" | "low" | "medium" | "high";

export interface RunOptions {
  mode: RunMode;
  synthesize: boolean;
  webSearch: boolean;
  toolMode: ToolMode;
  /** Revisor crítico antes de la síntesis */
  review: boolean;
  /** Sugerir preguntas de seguimiento */
  followups: boolean;
  reasoning: ReasoningLevel;
}

export const SYNTHESIS_ID = "coordinator";

// ============================================================================
// Árbol de turnos: cada consulta del usuario es un turno con un padre.
// Editar o regenerar crea un turno hermano (rama); se muestra el camino a `leafId`.
// ============================================================================

export interface Turn {
  id: string;
  parentId: string | null;
  user: ChatMessage;
  answers: ChatMessage[];
  sources?: Source[];
  stats?: RunStats;
  followups?: string[];
  createdAt: string;
}

export interface ConversationTree {
  turns: Record<string, Turn>;
  leafId: string | null;
}

export const emptyTree = (): ConversationTree => ({ turns: {}, leafId: null });

export const newTurnId = () => `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Turnos desde la raíz hasta `leafId`. */
export function activePath(tree: ConversationTree, leafId: string | null = tree.leafId): Turn[] {
  const path: Turn[] = [];
  const seen = new Set<string>();
  let current = leafId ? tree.turns[leafId] : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? tree.turns[current.parentId] : undefined;
  }
  return path;
}

const byCreation = (a: Turn, b: Turn) => a.createdAt.localeCompare(b.createdAt);

/** Turnos que comparten padre con `turn` (incluido), en orden de creación. */
export function siblingsOf(tree: ConversationTree, turn: Turn): Turn[] {
  return Object.values(tree.turns).filter((t) => t.parentId === turn.parentId).sort(byCreation);
}

/** Desciende desde `turnId` eligiendo siempre el hijo más reciente. */
export function latestLeaf(tree: ConversationTree, turnId: string): string {
  let current = turnId;
  for (let guard = 0; guard < 10_000; guard++) {
    const children = Object.values(tree.turns).filter((t) => t.parentId === current).sort(byCreation);
    if (!children.length) return current;
    current = children[children.length - 1].id;
  }
  return current;
}

export function addTurn(tree: ConversationTree, turn: Turn): ConversationTree {
  return { turns: { ...tree.turns, [turn.id]: turn }, leafId: turn.id };
}

export function updateTurn(tree: ConversationTree, turnId: string, fn: (t: Turn) => Turn): ConversationTree {
  const turn = tree.turns[turnId];
  return turn ? { ...tree, turns: { ...tree.turns, [turnId]: fn(turn) } } : tree;
}

/** Mensajes del camino activo (para mostrar, exportar y el historial clásico). */
export function flattenPath(path: Turn[]): ChatMessage[] {
  return path.flatMap((t) => [t.user, ...t.answers]);
}

// ---- serialización (localStorage / servidor) --------------------------------

export interface StoredMessage {
  role: ChatRole;
  content: string;
  timestamp: string;
  agentResponses?: AgentResponseData[];
  agent_id?: string;
  metadata?: Record<string, any>;
}

function storeMessage(m: ChatMessage, meta: Record<string, any>): StoredMessage {
  return {
    role: m.role,
    content: m.content,
    timestamp: new Date(m.timestamp).toISOString(),
    agentResponses: m.agentResponse ? [m.agentResponse] : undefined,
    agent_id: m.isSynthesis ? SYNTHESIS_ID : m.agentResponse?.agent_id,
    metadata: { ...meta, isSynthesis: m.isSynthesis, isReview: m.isReview, isCalculation: m.isCalculation, interrupted: m.interrupted, agentName: m.agentName, agentEmoji: m.agentEmoji },
  };
}

function loadMessage(m: StoredMessage): ChatMessage {
  const meta = m.metadata || {};
  const response = m.agentResponses?.[0];
  return {
    role: m.role === "assistant" && !meta.isSynthesis && m.agent_id && m.agent_id !== SYNTHESIS_ID ? "agent" : m.role,
    content: m.content,
    timestamp: new Date(m.timestamp || Date.now()),
    agentResponse: response,
    agentName: meta.agentName ?? response?.agent_name,
    agentEmoji: meta.agentEmoji ?? response?.agent_emoji,
    isSynthesis: meta.isSynthesis || m.agent_id === SYNTHESIS_ID,
    isReview: meta.isReview,
    isCalculation: meta.isCalculation,
    interrupted: meta.interrupted,
  };
}

/** Un árbol leído de JSON trae las fechas como texto: las vuelve a convertir en Date. */
export function reviveTree(tree: ConversationTree): ConversationTree {
  const revive = (m: ChatMessage): ChatMessage => ({ ...m, timestamp: new Date(m.timestamp || Date.now()) });
  const turns: Record<string, Turn> = {};
  for (const [id, turn] of Object.entries(tree.turns || {})) {
    turns[id] = { ...turn, user: revive(turn.user), answers: (turn.answers || []).map(revive) };
  }
  return { ...tree, turns };
}

/** Todas las ramas como lista plana; el árbol viaja en metadata (turnId/parentId). */
export function treeToMessages(tree: ConversationTree): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const turn of Object.values(tree.turns).sort(byCreation)) {
    const meta = { turnId: turn.id, parentId: turn.parentId, createdAt: turn.createdAt };
    out.push(storeMessage(turn.user, { ...meta, sources: turn.sources, stats: turn.stats, followups: turn.followups, leaf: turn.id === tree.leafId }));
    turn.answers.forEach((a) => out.push(storeMessage(a, meta)));
  }
  return out;
}

/** Reconstruye el árbol; mensajes sin metadata de turno (formato viejo) se leen como una sola rama. */
export function messagesToTree(messages: StoredMessage[]): ConversationTree {
  const tree = emptyTree();
  let current = null as Turn | null;
  for (const raw of messages) {
    const meta = raw.metadata || {};
    if (raw.role === "user") {
      const id: string = meta.turnId || newTurnId();
      current = {
        id,
        parentId: meta.turnId ? meta.parentId ?? null : current?.id ?? null,
        user: loadMessage(raw),
        answers: [],
        sources: meta.sources,
        stats: meta.stats,
        followups: meta.followups,
        createdAt: meta.createdAt || raw.timestamp || new Date().toISOString(),
      };
      tree.turns[id] = current;
      if (meta.leaf || !meta.turnId) tree.leafId = id;
    } else {
      const owner = (meta.turnId && tree.turns[meta.turnId]) || current;
      owner?.answers.push(loadMessage(raw));
    }
  }
  if (!tree.leafId || !tree.turns[tree.leafId]) {
    const all = Object.values(tree.turns).sort(byCreation);
    tree.leafId = all.length ? latestLeaf(tree, all[all.length - 1].id) : null;
  }
  return tree;
}

// ============================================================================
// Historial, exportación, SSE
// ============================================================================

const HISTORY_TURNS = 4;
const HISTORY_AGENT_CHARS = 700;

/**
 * Historial compacto para que los agentes entiendan preguntas de seguimiento:
 * por cada turno, el mensaje del usuario + la síntesis (o un extracto de cada agente).
 */
export function buildHistory(path: Turn[]): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of path.slice(-HISTORY_TURNS)) {
    const synthesis = turn.answers.find((m) => m.isSynthesis);
    const answer = synthesis
      ? synthesis.content
      : turn.answers
          .filter((m) => m.content && !m.isReview)
          .map((m) => `[${m.agentName || "Agente"}] ${m.content.slice(0, HISTORY_AGENT_CHARS)}`)
          .join("\n\n");
    if (!answer) continue;
    history.push({ role: "user", content: turn.user.content }, { role: "assistant", content: answer });
  }
  return history;
}

/** Conversación (camino activo) en Markdown, lista para descargar. */
export function conversationToMarkdown(title: string, path: Turn[]): string {
  const lines = [`# ${title}`, "", `_Exportado desde Nexo el ${new Date().toLocaleString()}_`, ""];
  for (const turn of path) {
    lines.push("---", "", "## 🧑 Consulta", "", turn.user.content, "");
    for (const msg of turn.answers) {
      const who = msg.isSynthesis ? "🧭 Respuesta integrada" : msg.isReview ? "🔍 Revisor crítico" : msg.isCalculation ? "🧮 Cálculo de costos" : `${msg.agentEmoji || "🤖"} ${msg.agentName || "Agente"}`;
      lines.push(`### ${who}${msg.interrupted ? " _(interrumpido)_" : ""}`, "", msg.content, "");
    }
    if (turn.sources?.length) {
      lines.push("**Fuentes:**", "");
      turn.sources.forEach((s) => lines.push(`- [${s.label}] ${s.url ? `[${s.title}](${s.url})` : s.title}`));
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime = "text/markdown") {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugify(text: string, max = 40): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max) || "conversacion"
  );
}

/**
 * Fallback cuando no hay WebSocket: POST /api/chat-stream y emite cada evento SSE.
 * Acumula en buffer porque un evento puede llegar partido entre chunks.
 */
export async function streamViaSSE(
  body: Record<string, unknown>,
  onEvent: (event: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem("nexo_token");
  const response = await fetch("/api/chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || `Error ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          onEvent(JSON.parse(data));
        } catch {
          /* evento malformado */
        }
      }
    }
  }
}
