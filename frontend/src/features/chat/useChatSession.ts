"use client";

/**
 * Lógica de una sesión de chat, separada de la UI:
 *  - árbol de turnos (ramas), persistencia local y en la cuenta
 *  - ejecución vía WebSocket (o SSE) con el reducer puro `reduceRun`
 *  - adjuntos, sugerencia de equipo, exportar, detener, regenerar, editar
 * Lee la configuración de los stores; los componentes solo renderizan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentLanguage } from "@/lib/i18n";
import { hasSession, saveServerConversation, suggestAgents } from "@/lib/api";
import {
  ChatMessage, ConversationTree, Turn, activePath, addTurn, buildHistory, conversationToMarkdown, downloadText,
  emptyTree, latestLeaf, messagesToTree, newTurnId, reviveTree, siblingsOf, slugify, streamViaSSE, treeToMessages, updateTurn,
} from "@/lib/chat";
import { DocumentRef, MAX_DOCUMENTS_PER_CHAT, deleteDocument, uploadDocument } from "@/lib/documents";
import { resolveChoice } from "@/lib/docSettings";
import { ConversationStorage, Conversation } from "@/lib/conversationStorage";
import { budgetBlock, costOf, recordSpend } from "@/lib/pricing";
import { parseServerEvent } from "@/core/protocol";
import { RunEffect, idleRun, interruptedAnswers, reduceRun } from "@/core/runReducer";
import { useAgentSocket } from "@/hooks/useAgentSocket";
import { useSettings } from "@/stores/settings";
import { selectApiReady, selectWebReady, useWorkspace } from "@/stores/workspace";

export const MAX_INPUT = 10000;
const MAX_STORED_CONVERSATIONS = 100;

const newConversationId = () => `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

function toStoredPath(path: Turn[]) {
  return treeToMessages({ turns: Object.fromEntries(path.map((t) => [t.id, t])), leafId: path[path.length - 1]?.id ?? null });
}

export function useChatSession() {
  const workspace = useWorkspace();
  const { selectedAgents, model, apiConfig, providers, webSearch, setAgents } = workspace;
  const apiReady = useWorkspace(selectApiReady);
  const webReady = useWorkspace(selectWebReady);
  const options = useSettings((s) => s.runOptions);
  const allInstructions = useSettings((s) => s.agentInstructions);
  const docSettings = useSettings((s) => s.docSettings);

  const [tree, setTree] = useState<ConversationTree>(emptyTree);
  const [conversationId, setConversationId] = useState("");
  const [attachments, setAttachments] = useState<DocumentRef[]>([]);
  const [uploading, setUploading] = useState(0);
  const [run, setRun] = useState(idleRun);
  const [processing, setProcessing] = useState(false);
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const runRef = useRef(run);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const pendingTurnRef = useRef<string | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;
  const sseAbortRef = useRef<AbortController | null>(null);

  const path = useMemo(() => activePath(tree), [tree]);
  const ocrConfig = useMemo(() => resolveChoice(docSettings.ocr, providers), [docSettings.ocr, providers]);
  const embeddingsConfig = useMemo(() => resolveChoice(docSettings.embeddings, providers), [docSettings.embeddings, providers]);
  const instructions = useMemo(
    () => Object.fromEntries(Object.entries(allInstructions).filter(([id]) => selectedAgents.includes(id))),
    [allInstructions, selectedAgents],
  );

  // --------------------------------------------------------------- persistencia
  const openConversation = useCallback(async (conversation: Conversation) => {
    let loaded = conversation.tree ? reviveTree(conversation.tree) : messagesToTree(conversation.messages || []);
    if (!Object.keys(loaded.turns).length && hasSession()) {
      loaded = messagesToTree(await ConversationStorage.getServerConversationMessages(conversation.id));
    }
    setConversationId(conversation.id);
    setTree(loaded);
    // El equipo de la conversación vuelve con ella, para poder seguir preguntando
    if (conversation.agents?.length) useWorkspace.getState().setAgents(conversation.agents);
    setAttachments(conversation.documents || []);
    localStorage.setItem("nexo_current_conversation", conversation.id);
  }, []);

  useEffect(() => {
    const savedId = localStorage.getItem("nexo_current_conversation");
    const saved = savedId ? ConversationStorage.getConversation(savedId) : null;
    if (saved) openConversation(saved);
    else setConversationId(newConversationId());
  }, [openConversation]);

  const save = useCallback(() => {
    const current = treeRef.current;
    const currentPath = activePath(current);
    if (!conversationId || !currentPath.length) return;
    const existing = ConversationStorage.getConversation(conversationId);
    const title = existing?.title && !existing.title.startsWith("Nueva conversación")
      ? existing.title
      : currentPath[0].user.content.slice(0, 60);
    try {
      ConversationStorage.saveConversation({
        id: conversationId, title, messages: toStoredPath(currentPath), tree: current, documents: attachments,
        createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
        model, agents: selectedAgents,
      });
      ConversationStorage.cleanOldConversations?.(MAX_STORED_CONVERSATIONS);
      localStorage.setItem("nexo_current_conversation", conversationId);
    } catch (e) {
      console.warn("No se pudo guardar la conversación localmente:", e);
    }
    if (hasSession()) {
      saveServerConversation({ conversation_id: conversationId, title, messages: treeToMessages(current), model, agents: selectedAgents })
        .catch(() => { /* sin conexión: queda el guardado local */ });
    }
  }, [conversationId, attachments, model, selectedAgents]);

  // Guarda al terminar cada ejecución y al cambiar de rama (nunca durante el streaming)
  useEffect(() => {
    if (processing || !Object.keys(tree.turns).length) return;
    const timer = setTimeout(save, 500);
    return () => clearTimeout(timer);
  }, [processing, tree, attachments, save]);

  // -------------------------------------------------------------------- eventos
  const finish = useCallback(() => {
    runRef.current = idleRun();
    setRun(runRef.current);
    setProcessing(false);
    pendingTurnRef.current = null;
    setPendingTurnId(null);
  }, []);

  const applyEffects = useCallback((effects: RunEffect[]) => {
    const turnId = pendingTurnRef.current;
    const onTurn = (fn: (t: Turn) => Turn) => turnId && setTree((tr) => updateTurn(tr, turnId, fn));
    for (const effect of effects) {
      switch (effect.kind) {
        case "answer":
          onTurn((t) => ({ ...t, answers: [...t.answers, effect.message] }));
          break;
        case "sources":
          onTurn((t) => ({ ...t, sources: effect.sources }));
          break;
        case "followups":
          onTurn((t) => ({ ...t, followups: effect.questions }));
          break;
        case "complete": {
          const s = effect.summary;
          const usage = { prompt_tokens: s.usage?.prompt_tokens || 0, completion_tokens: s.usage?.completion_tokens || 0 };
          const cost = costOf(modelRef.current, usage);
          if (cost) recordSpend(cost);
          onTurn((t) => ({
            ...t,
            sources: s.sources?.length ? s.sources : t.sources,
            stats: {
              elapsedMs: s.processing_time_ms || 0, totalTokens: s.usage?.total_tokens || 0,
              promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, cost, model: modelRef.current,
              agents: s.agents_count || 0, failed: (s.failed || []).length,
            },
          }));
          finish();
          break;
        }
        case "notice":
          setNotice(effect.text);
          break;
        case "error":
          setError(effect.text);
          finish();
          break;
        case "cancelled":
          setNotice("Generación detenida");
          finish();
          break;
      }
    }
  }, [finish]);

  const handleEvent = useCallback((raw: unknown) => {
    const event = parseServerEvent(raw);
    if (!event) return;
    const { state, effects } = reduceRun(runRef.current, event);
    runRef.current = state;
    setRun(state);
    applyEffects(effects);
  }, [applyEffects]);

  const interrupt = useCallback((message: string | null, isError: boolean) => {
    const partial = interruptedAnswers(runRef.current);
    const turnId = pendingTurnRef.current;
    if (turnId && partial.length) setTree((t) => updateTurn(t, turnId, (turn) => ({ ...turn, answers: [...turn.answers, ...partial] })));
    if (message) (isError ? setError : setNotice)(message);
    finish();
  }, [finish]);

  const { status, send, reconnect } = useAgentSocket(handleEvent);

  // Si el socket se cae a mitad de una ejecución por WS, no dejar la UI bloqueada
  const processingRef = useRef(false);
  processingRef.current = processing;
  useEffect(() => {
    if (status === "closed" && processingRef.current && !sseAbortRef.current) {
      interrupt("Se perdió la conexión con el servidor. Reintenta la consulta.", true);
    }
  }, [status, interrupt]);

  // ------------------------------------------------------------------- acciones
  const runQuery = useCallback(async (text: string, parentId: string | null) => {
    setError(null);
    setNotice(null);
    if (!apiReady) return setError("Configura tu API key en Ajustes para usar los agentes");
    if (!selectedAgents.length) return setError("Selecciona al menos un agente (o usa ✨ Sugerir)");
    const blocked = budgetBlock();
    if (blocked) return setError(blocked);

    const turn: Turn = {
      id: newTurnId(), parentId, user: { role: "user", content: text.slice(0, MAX_INPUT), timestamp: new Date() },
      answers: [], createdAt: new Date().toISOString(),
    };
    const history = buildHistory(activePath(treeRef.current, parentId));
    setTree((t) => addTurn(t, turn));
    pendingTurnRef.current = turn.id;
    setPendingTurnId(turn.id);
    setProcessing(true);

    const payload = {
      message: turn.user.content,
      agents: selectedAgents,
      model,
      apiConfig: { type: apiConfig.type, apiKey: apiConfig.apiKey, baseUrl: apiConfig.baseUrl },
      conversation_id: conversationId,
      language: getCurrentLanguage(),
      mode: options.mode,
      synthesize: options.synthesize,
      review: options.review,
      followups: options.followups,
      toolMode: options.toolMode,
      reasoning: options.reasoning,
      notes: options.notes,
      history,
      agentInstructions: instructions,
      documents: attachments.map((d) => d.id),
      webSearch: options.webSearch && webReady ? webSearch : null,
      embeddings: attachments.length ? embeddingsConfig : null,
    };
    if (send({ action: "start_pipeline", ...payload })) return;

    const controller = new AbortController();
    sseAbortRef.current = controller;
    try {
      await streamViaSSE(payload, handleEvent, controller.signal);
    } catch (e: any) {
      if (e?.name === "AbortError") interrupt("Generación detenida", false);
      else interrupt(`Error en streaming: ${e?.message || e}`, true);
    } finally {
      sseAbortRef.current = null;
      setProcessing(false);
    }
  }, [apiReady, selectedAgents, model, apiConfig, conversationId, options, instructions, attachments, webReady, webSearch,
      embeddingsConfig, send, handleEvent, interrupt]);

  const stop = useCallback(() => {
    if (sseAbortRef.current) sseAbortRef.current.abort();
    else send({ action: "cancel" });
  }, [send]);

  const regenerate = useCallback(() => {
    const last = path[path.length - 1];
    if (last && !processing) runQuery(last.user.content, last.parentId);
  }, [path, processing, runQuery]);

  const editTurn = useCallback((turnId: string, text: string) => {
    const turn = treeRef.current.turns[turnId];
    if (turn && text.trim() && !processing) runQuery(text.trim(), turn.parentId);
  }, [processing, runQuery]);

  const switchBranch = useCallback((turn: Turn, direction: -1 | 1) => {
    if (processing) return;
    const siblings = siblingsOf(treeRef.current, turn);
    const target = siblings[siblings.findIndex((s) => s.id === turn.id) + direction];
    if (target) setTree((t) => ({ ...t, leafId: latestLeaf(t, target.id) }));
  }, [processing]);

  const newConversation = useCallback(() => {
    if (processing) stop();
    setConversationId(newConversationId());
    setTree(emptyTree());
    setAttachments([]);
    setError(null);
    setNotice(null);
    finish();
  }, [processing, stop, finish]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, Math.max(0, MAX_DOCUMENTS_PER_CHAT - attachments.length));
    if (!list.length) return setNotice(`Máximo ${MAX_DOCUMENTS_PER_CHAT} documentos por conversación`);
    setError(null);
    setUploading((n) => n + list.length);
    await Promise.all(list.map(async (file) => {
      try {
        const doc = await uploadDocument(file, ocrConfig, getCurrentLanguage());
        setAttachments((prev) => [...prev, doc]);
      } catch (e: any) {
        setError(e?.message || `No se pudo subir ${file.name}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }));
  }, [attachments.length, ocrConfig]);

  const removeAttachment = useCallback((doc: DocumentRef) => {
    setAttachments((prev) => prev.filter((d) => d.id !== doc.id));
    deleteDocument(doc.id);
  }, []);

  const suggestTeam = useCallback(async (text: string) => {
    if (text.trim().length < 3) return setNotice("Escribe primero tu consulta y luego pide sugerencias");
    setSuggesting(true);
    setError(null);
    try {
      const result = await suggestAgents(text, apiReady ? apiConfig : null, model, getCurrentLanguage());
      if (!result.agents.length) {
        setNotice("No encontré agentes relevantes; prueba describiendo mejor la tarea");
      } else {
        setAgents(result.agents.map((a) => a.id));
        setNotice(`Equipo sugerido: ${result.agents.map((a) => `${a.emoji} ${a.name}`).join(", ")}${result.reason ? ` — ${result.reason}` : ""}`);
      }
    } catch (e: any) {
      setError(e?.message || "No se pudieron sugerir agentes");
    } finally {
      setSuggesting(false);
    }
  }, [apiReady, apiConfig, model, setAgents]);

  const exportMarkdown = useCallback(() => {
    if (!path.length) return;
    const title = path[0].user.content.slice(0, 60) || "Conversación Nexo";
    downloadText(`nexo-${slugify(title)}.md`, conversationToMarkdown(title, path));
  }, [path]);

  return {
    // estado
    tree, path, conversationId, attachments, uploading, run, processing, suggesting, error, notice,
    status, apiReady, webReady, ocrConfig, pendingTurnId,
    // acciones
    runQuery, stop, regenerate, editTurn, switchBranch, newConversation, openConversation, save, addFiles,
    removeAttachment, suggestTeam, exportMarkdown, reconnect, setError, setNotice,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
export type { ChatMessage };
