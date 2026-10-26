/**
 * Conversation History Component - Nexo
 * ============================================
 * Panel lateral para gestionar historial de conversaciones
 * Sincronización con servidor + localStorage
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  MessageSquare, Plus, Trash2, Edit2,
  Check, X, FileJson, FileText, Clock, Brain, Save, RefreshCw, Server
} from "lucide-react";
import { CONVERSATIONS_CHANGED, ConversationStorage, Conversation } from "@/lib/conversationStorage";

interface ConversationHistoryProps {
  currentConversationId: string | null;
  onSelectConversation: (conversation: Conversation) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onSave?: () => void;
}

export function ConversationHistory({
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onSave
}: ConversationHistoryProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [useServer, setUseServer] = useState(true);

  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      // Siempre cargar desde localStorage (fuente principal y confiable)
      const localConvs = ConversationStorage.getAllConversations();
      localConvs.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setConversations(localConvs);

      // Si hay token, intentar sincronizar con servidor en background
      if (useServer) {
        const token = localStorage.getItem("nexo_token");
        if (token) {
          try {
            const serverConvs = await ConversationStorage.getServerConversations();
            if (serverConvs.length > 0) {
              // Merge: agregar conversaciones del servidor que no existen localmente
              const localIds = new Set(localConvs.map(c => c.id));
              const newFromServer = serverConvs.filter(c => !localIds.has(c.id));
              if (newFromServer.length > 0) {
                const merged = [...localConvs, ...newFromServer];
                merged.sort((a, b) =>
                  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                );
                setConversations(merged);
              }
            }
          } catch {
            // Server sync failed silently - localStorage is already loaded
          }
        }
      }
    } catch (error) {
      console.error("Error loading conversations:", error);
    } finally {
      setIsLoading(false);
    }
  }, [useServer]);

  // Recargar al cambiar de conversación y cada vez que el almacenamiento cambie (guardar, borrar, renombrar)
  useEffect(() => {
    loadConversations();
  }, [currentConversationId, loadConversations]);

  useEffect(() => {
    const reload = () => { loadConversations(); };
    window.addEventListener(CONVERSATIONS_CHANGED, reload);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, reload);
  }, [loadConversations]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("¿Estás seguro de que deseas eliminar esta conversación?")) {
      // Eliminar del servidor si está habilitado
      if (useServer) {
        await ConversationStorage.deleteServerConversation(id);
      }
      // También eliminar localmente
      ConversationStorage.deleteConversation(id);
      onDeleteConversation(id);
      loadConversations();
    }
  };

  const handleExport = (conversation: Conversation, format: 'json' | 'markdown', e: React.MouseEvent) => {
    e.stopPropagation();
    ConversationStorage.downloadConversation(conversation, format);
  };

  const startEditing = (conversation: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conversation.id);
    setEditTitle(conversation.title);
  };

  const saveTitle = async (id: string) => {
    if (editTitle.trim()) {
      // Actualizar en servidor si está habilitado
      if (useServer) {
        await ConversationStorage.updateServerConversationTitle(id, editTitle.trim());
      }
      // También actualizar localmente
      ConversationStorage.updateConversationTitle(id, editTitle.trim());
      loadConversations();
    }
    setEditingId(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Ahora";
    if (diffMins < 60) return `Hace ${diffMins}m`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full bg-background border-r">
      {/* Header */}
      <div className="p-4 border-b space-y-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-bold text-primary">
            <Brain className="h-4 w-4" />
            <span>MEMORIA</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              onClick={() => loadConversations()}
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={isLoading}
              title="Recargar conversaciones"
            >
              <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
            </Button>
            <Button
              onClick={() => setUseServer(!useServer)}
              size="sm"
              variant="ghost"
              className={cn("h-6 w-6 p-0", useServer && "text-green-500")}
              title={useServer ? "Servidor activo" : "Solo local"}
            >
              <Server className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          {onSave && (
            <Button
              onClick={onSave}
              className="flex-1"
              size="sm"
              variant="outline"
            >
              <Save className="w-4 h-4 mr-2" />
              Guardar
            </Button>
          )}
          <Button
            onClick={onNewConversation}
            className="flex-1"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Nuevo
          </Button>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No hay conversaciones guardadas</p>
            </div>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => onSelectConversation(conversation)}
                className={cn(
                  "group relative p-3 rounded-lg cursor-pointer transition-colors",
                  // accent es un color de marca brillante en algunos temas: el texto quedaba ilegible
                  "hover:bg-muted/60",
                  currentConversationId === conversation.id && "bg-primary/15 ring-1 ring-primary/40"
                )}
              >
                {editingId === conversation.id ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveTitle(conversation.id);
                        if (e.key === "Escape") cancelEditing();
                      }}
                      className="flex-1 px-2 py-1 text-sm bg-background border rounded"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => saveTitle(conversation.id)}
                      className="h-6 w-6 p-0"
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={cancelEditing}
                      className="h-6 w-6 p-0"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {conversation.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>{formatDate(conversation.updatedAt)}</span>
                          <span>•</span>
                          <span>{conversation.messages.length} msgs</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    {/* Acciones: con hover/teclado, y siempre en la conversación abierta (en móvil no hay hover) */}
                    <div className={cn("items-center gap-1 mt-2 animate-in fade-in",
                      currentConversationId === conversation.id ? "flex" : "hidden group-hover:flex group-focus-within:flex")}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => startEditing(conversation, e)}
                        className="h-6 px-2 text-xs"
                        title="Renombrar"
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleExport(conversation, 'json', e)}
                        className="h-6 px-2 text-xs"
                        title="Exportar como JSON"
                      >
                        <FileJson className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleExport(conversation, 'markdown', e)}
                        className="h-6 px-2 text-xs"
                        title="Exportar como Markdown"
                      >
                        <FileText className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleDelete(conversation.id, e)}
                        className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t text-xs text-muted-foreground text-center">
        {conversations.length} conversación{conversations.length !== 1 ? 'es' : ''}
      </div>
    </div>
  );
}
