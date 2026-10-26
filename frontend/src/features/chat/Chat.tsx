"use client";

/**
 * Contenedor del chat: compone la sesión (useChatSession) con los componentes de presentación.
 * La lógica vive en el hook y en core/; la inteligencia de ayuda en intelligence/.
 */

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDown, Brain, ChevronLeft, Download, Layers, LayoutList, Link2, Menu, Save, Wifi, WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { siblingsOf } from "@/lib/chat";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConversationHistory } from "@/components/ConversationHistory";
import { TaskSelector } from "@/components/TaskSelector";
import { ShareDialog } from "@/components/ShareDialog";
import { useChatSession } from "./useChatSession";
import { useRunTitle } from "./useRunTitle";
import { onChatCommand } from "./commands";
import { Composer, ComposerHandle } from "./components/Composer";
import { EmptyState, ReadinessStep } from "./components/EmptyState";
import { TeamBar } from "./components/TeamBar";
import { TurnView } from "./components/TurnView";

interface ChatProps {
  onOpenSettings: () => void;
  onConnectionChange?: (connected: boolean) => void;
  /** Contenido sobre las tareas predefinidas (Mis equipos) */
  sidePanelHeader?: ReactNode;
}

function useViewport() {
  const [viewport, setViewport] = useState({ mobile: false, tablet: false });
  useEffect(() => {
    const check = () => setViewport({ mobile: window.innerWidth < 768, tablet: window.innerWidth >= 768 && window.innerWidth < 1024 });
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return viewport;
}

export function Chat({ onOpenSettings, onConnectionChange, sidePanelHeader }: ChatProps) {
  const session = useChatSession();
  const { path, tree, run, processing, status } = session;
  const selectedAgents = useWorkspace((s) => s.selectedAgents);
  const setAgents = useWorkspace((s) => s.setAgents);
  const setRunOptions = useSettings((s) => s.setRunOptions);
  const options = useSettings((s) => s.runOptions);

  const [shareOpen, setShareOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  // Con poco ancho los paneles laterales dejan el chat demasiado angosto: arrancan cerrados
  useEffect(() => {
    if (window.innerWidth < 1536) setShowTasks(false);
    if (window.innerWidth < 1280) setShowHistory(false);
  }, []);
  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const { mobile, tablet } = useViewport();
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isConnected = status === "open";

  useEffect(() => onConnectionChange?.(isConnected), [isConnected, onConnectionChange]);

  useRunTitle(processing);

  // Seguir el texto nuevo solo si el usuario está abajo: si subió a leer, no lo arrastramos
  const stickToBottom = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickToBottom.current = near;
    setAwayFromBottom(!near);
  };
  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    setAwayFromBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    if (stickToBottom.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [run]);

  // Pregunta nueva o conversación abierta: siempre al final
  useEffect(() => scrollToBottom(), [path.length, session.conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hermanos por turno: se recalcula solo cuando cambia el árbol, no con cada token
  const siblings = useMemo(() => Object.fromEntries(path.map((t) => [t.id, siblingsOf(tree, t)])), [tree, path]);

  // Comandos de la paleta (Ctrl+K) y atajos: ref para no re-suscribir en cada render
  const commandRef = useRef<(c: string) => void>(() => {});
  commandRef.current = (command) => {
    switch (command) {
      case "new-chat": session.newConversation(); break;
      case "export": session.exportMarkdown(); break;
      case "share": if (path.length && !processing) setShareOpen(true); break;
      case "stop": if (processing) session.stop(); break;
      case "regenerate": session.regenerate(); break;
      case "focus-input": composerRef.current?.focus(); break;
      case "suggest": session.suggestTeam(composerRef.current?.getText() || ""); break;
      case "toggle-web":
        if (session.webReady) setRunOptions({ webSearch: !options.webSearch });
        else onOpenSettings();
        break;
    }
  };
  useEffect(() => onChatCommand((c) => commandRef.current(c)), []);

  const readiness: ReadinessStep[] = [
    { id: "api", label: "Conectá tu proveedor de IA (Groq, OpenAI, Ollama…)", done: session.apiReady, actionLabel: "Ajustes", onAction: onOpenSettings },
    { id: "team", label: "Elegí agentes, un equipo o una tarea predefinida", done: selectedAgents.length > 0, actionLabel: "Sugerir", onAction: () => session.suggestTeam(composerRef.current?.getText() || "") },
    { id: "web", label: "Opcional: buscador web para datos actuales", done: session.webReady, actionLabel: "Configurar", onAction: onOpenSettings },
  ];

  const connectionBadge = isConnected ? (
    <Badge variant="outline" className="text-xs text-green-400 border-green-400/50"><Wifi className="h-3 w-3 mr-1" />En vivo</Badge>
  ) : (
    <button onClick={session.reconnect} title="Reintentar conexión">
      <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/50">
        <WifiOff className="h-3 w-3 mr-1" />{status === "connecting" ? "Conectando…" : "Sin conexión (SSE)"}
      </Badge>
    </button>
  );

  const history = (
    <ConversationHistory
      currentConversationId={session.conversationId}
      onSelectConversation={(c) => !processing && session.openConversation(c)}
      onNewConversation={session.newConversation}
      onDeleteConversation={(id) => id === session.conversationId && session.newConversation()}
      onSave={session.save}
    />
  );

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden w-full">
      {mobile && (
        <div className="flex items-center justify-between p-3 border-b border-primary/10 bg-muted/30">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowMobilePanel(!showMobilePanel)} className="h-8 w-8 p-0">
              {showMobilePanel ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
            <Brain className="h-4 w-4 text-primary" /><span className="font-semibold text-sm">Nexo</span>
          </div>
          {connectionBadge}
        </div>
      )}

      {mobile && showMobilePanel && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowMobilePanel(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-80 bg-background border-r border-primary/10 overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-primary/10">
              <span className="font-semibold text-sm">Historial</span>
              <Button size="sm" variant="ghost" onClick={session.save} disabled={!path.length} className="h-8 px-2 text-xs">
                <Save className="h-3 w-3 mr-1" />Guardar
              </Button>
            </div>
            {history}
          </div>
        </>
      )}

      <div className="flex flex-1 h-full overflow-hidden relative">
        <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden relative">
          {!mobile && (
            <div className="flex items-center justify-between p-3 border-b border-primary/10 bg-muted/30">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-primary/20 border border-primary/40"><Layers className="h-5 w-5 text-primary" /></div>
                <span className="font-bold text-lg text-primary">Agentes</span>
                <Badge variant="outline" className="text-xs whitespace-nowrap">{selectedAgents.length} seleccionados</Badge>
                {connectionBadge}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={session.newConversation} className="text-xs font-semibold">Nuevo</Button>
                <Button variant="ghost" size="sm" onClick={session.exportMarkdown} disabled={!path.length} title="Exportar a Markdown" className="text-xs gap-1">
                  <Download className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">Exportar</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)} disabled={!path.length || processing} title="Compartir por link" className="text-xs gap-1">
                  <Link2 className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">Compartir</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowTasks(!showTasks)} title={showTasks ? "Ocultar equipos y tareas" : "Mostrar equipos y tareas"}
                  className={cn("p-0 h-8 w-8", showTasks && "bg-primary/10")}>
                  <LayoutList className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)} title={showHistory ? "Ocultar historial" : "Mostrar historial"}
                  className={cn("p-0 h-8 w-8", showHistory && "bg-primary/10")}>
                  <ChevronLeft className={cn("h-4 w-4 transition-transform", showHistory && "rotate-180")} />
                </Button>
              </div>
            </div>
          )}

          <TeamBar />

          <div className="flex-1 overflow-y-auto p-4" ref={scrollRef} onScroll={onScroll}>
            <div className="max-w-5xl mx-auto">
              {session.error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 mb-4 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1">{session.error}</span>
                  <button onClick={() => session.setError(null)}><X className="h-3.5 w-3.5" /></button>
                </div>
              )}

              {path.length === 0 ? (
                <EmptyState steps={readiness} onExample={(text) => {
                  composerRef.current?.setText(text);
                  if (!selectedAgents.length) session.suggestTeam(text);
                }} />
              ) : (
                path.map((turn, index) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    siblings={siblings[turn.id] || [turn]}
                    isLast={index === path.length - 1}
                    isPending={session.pendingTurnId === turn.id}
                    processing={processing}
                    run={session.pendingTurnId === turn.id ? run : null}
                    conversationId={session.conversationId}
                    onEdit={session.editTurn}
                    onSwitchBranch={session.switchBranch}
                    onRegenerate={session.regenerate}
                    onFollowUp={session.runQuery}
                  />
                ))
              )}
            </div>
          </div>

          {awayFromBottom && path.length > 0 && (
            <div className="relative">
              <button onClick={() => scrollToBottom(true)}
                className="absolute -top-14 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-card/95 px-3 py-1.5 text-xs font-semibold text-primary shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2 hover:bg-primary/10">
                <ArrowDown className="h-3.5 w-3.5" />{processing ? "Seguir la respuesta" : "Ir al final"}
              </button>
            </div>
          )}

          <Composer
            ref={composerRef}
            path={path}
            attachments={session.attachments}
            uploading={session.uploading}
            processing={processing}
            suggesting={session.suggesting}
            webReady={session.webReady}
            ocrEnabled={!!session.ocrConfig}
            notice={session.notice}
            onDismissNotice={() => session.setNotice(null)}
            onSend={(text) => session.runQuery(text, tree.leafId)}
            onStop={session.stop}
            onSuggest={session.suggestTeam}
            onAddFiles={session.addFiles}
            onRemoveAttachment={session.removeAttachment}
            onNeedWebConfig={onOpenSettings}
          />
        </div>

        <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} path={path}
          title={path[0]?.user.content.slice(0, 80) || "Conversación de Nexo"} />

        {!mobile && showTasks && <TaskSelector onSelect={setAgents} className="h-full shrink-0" header={sidePanelHeader} />}

        {!mobile && showHistory && (
          <div className={cn("border-l border-primary/10 h-full flex-shrink-0 bg-card overflow-hidden", tablet ? "w-60" : "w-72")}>
            {history}
          </div>
        )}
      </div>
    </div>
  );
}
