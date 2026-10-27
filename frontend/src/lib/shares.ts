/**
 * Links compartidos: instantánea de solo lectura del camino activo de una conversación.
 * La clave para revocar se guarda solo en este navegador.
 */

import { ChatMessage, ConversationTree, Turn, addTurn, emptyTree, newTurnId } from "@/lib/chat";

export interface SharedAnswer {
  name: string;
  emoji: string;
  content: string;
  is_synthesis: boolean;
  is_review: boolean;
}

export interface SharedTurn {
  question: string;
  answers: SharedAnswer[];
  sources: Array<{ label: string; kind: string; title: string; url?: string | null }>;
}

export interface SharedConversation {
  title: string;
  turns: SharedTurn[];
  created_at: number;
  views: number;
}

export interface MyShare {
  id: string;
  ownerKey: string;
  title: string;
  createdAt: string;
}

const KEY = "nexo_shares";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("nexo_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const listMyShares = (): MyShare[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};

const writeShares = (shares: MyShare[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(shares));
  } catch { /* storage bloqueado */ }
};

export const shareUrl = (id: string) => `${window.location.origin}/share/${id}`;

export function toSharedTurns(path: Turn[]): SharedTurn[] {
  return path.map((t) => ({
    question: t.user.content,
    answers: t.answers
      .filter((a) => a.content.trim())
      .map((a) => ({
        name: a.isSynthesis ? "Respuesta integrada" : a.isReview ? "Revisor crítico" : a.agentName || "Agente",
        emoji: a.isSynthesis ? "🧭" : a.isReview ? "🔍" : a.agentEmoji || "🤖",
        content: a.content.slice(0, 40_000),
        is_synthesis: !!a.isSynthesis,
        is_review: !!a.isReview,
      }))
      .slice(0, 15),
    // Sin s.path: la ruta de una nota en tu disco no viaja en un link compartido
    sources: (t.sources || []).slice(0, 40).map((s) => ({ label: s.label, kind: s.kind, title: s.title, url: s.url ?? null })),
  }));
}

export async function createShare(title: string, path: Turn[]): Promise<MyShare> {
  const response = await fetch("/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title: title.slice(0, 200) || "Conversación de Nexo", turns: toSharedTurns(path).slice(0, 100) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "No se pudo crear el link");
  const share: MyShare = { id: data.id, ownerKey: data.owner_key, title, createdAt: new Date().toISOString() };
  writeShares([share, ...listMyShares()]);
  return share;
}

export async function revokeShare(share: MyShare): Promise<void> {
  const response = await fetch(`/api/shares/${encodeURIComponent(share.id)}`, {
    method: "DELETE",
    headers: { "X-Share-Key": share.ownerKey, ...authHeaders() },
  });
  if (!response.ok && response.status !== 404) throw new Error("No se pudo revocar el link");
  writeShares(listMyShares().filter((s) => s.id !== share.id));
}

export async function fetchShare(id: string): Promise<SharedConversation> {
  const response = await fetch(`/api/shares/${encodeURIComponent(id)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || "Link no encontrado o revocado");
  return data as SharedConversation;
}

/** Convierte una conversación compartida en un árbol lineal para importarla al historial propio. */
export function sharedToTree(shared: SharedConversation): ConversationTree {
  let tree = emptyTree();
  let parentId: string | null = null;
  let clock = Date.now();
  for (const turn of shared.turns) {
    const answers: ChatMessage[] = turn.answers.map((a) => ({
      role: a.is_synthesis ? "assistant" : "agent",
      content: a.content,
      timestamp: new Date(clock),
      agentName: a.name,
      agentEmoji: a.emoji,
      isSynthesis: a.is_synthesis,
      isReview: a.is_review,
    }));
    const t: Turn = {
      id: newTurnId(),
      parentId,
      user: { role: "user", content: turn.question, timestamp: new Date(clock) },
      answers,
      sources: turn.sources.map((s) => ({ label: s.label, kind: s.kind === "document" || s.kind === "note" ? s.kind : "web", title: s.title, url: s.url || undefined })),
      createdAt: new Date(clock++).toISOString(),
    };
    tree = addTurn(tree, t);
    parentId = t.id;
  }
  return tree;
}
