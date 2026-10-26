/**
 * Almacenamiento de conversaciones: localStorage (siempre) + historial del servidor (con sesión).
 */

import {
  hasSession,
  listServerConversations,
  getServerConversation,
  deleteServerConversation as apiDeleteServerConversation,
} from "./api";

import type { ConversationTree, StoredMessage } from "./chat";
import type { DocumentRef } from "./documents";

export type { StoredMessage };

export interface Conversation {
  id: string;
  title: string;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
  model: string;
  agents: string[];
  /** Árbol completo con ramas (formato v2). messages = camino activo. */
  tree?: ConversationTree;
  documents?: DocumentRef[];
}

const STORAGE_KEY = "nexo_conversations";
/** Se emite al guardar, borrar o renombrar: el historial se actualiza sin recargar. */
export const CONVERSATIONS_CHANGED = "nexo:conversations-changed";
const CURRENT_CONVERSATION_KEY = "nexo_current_conversation";
const CLIENT_ID_KEY = "nexo_client_id";

// Obtener o crear client_id persistente
export function getClientId(): string {
  if (typeof window === 'undefined') return 'server';
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

export class ConversationStorage {
  /**
   * Obtener todas las conversaciones guardadas
   */
  static getAllConversations(): Conversation[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error("Error loading conversations:", error);
      return [];
    }
  }

  /**
   * Guardar una conversación
   */
  private static persist(conversations: Conversation[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
  }

  static saveConversation(conversation: Conversation): void {
    try {
      const conversations = this.getAllConversations();
      const existingIndex = conversations.findIndex(c => c.id === conversation.id);
      
      if (existingIndex >= 0) {
        conversations[existingIndex] = {
          ...conversation,
          updatedAt: new Date().toISOString()
        };
      } else {
        conversations.push(conversation);
      }
      
      this.persist(conversations);
    } catch (error) {
      console.error("Error saving conversation:", error);
    }
  }

  /**
   * Obtener una conversación por ID
   */
  static getConversation(id: string): Conversation | null {
    const conversations = this.getAllConversations();
    return conversations.find(c => c.id === id) || null;
  }

  /**
   * Eliminar una conversación
   */
  static deleteConversation(id: string): void {
    try {
      const conversations = this.getAllConversations();
      const filtered = conversations.filter(c => c.id !== id);
      this.persist(filtered);
    } catch (error) {
      console.error("Error deleting conversation:", error);
    }
  }

  /**
   * Crear una nueva conversación
   */
  static createConversation(model: string, agents: string[]): Conversation {
    return {
      id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: `Nueva conversación - ${new Date().toLocaleString()}`,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model,
      agents
    };
  }

  /**
   * Actualizar el título de una conversación
   */
  static updateConversationTitle(id: string, title: string): void {
    try {
      const conversations = this.getAllConversations();
      const conversation = conversations.find(c => c.id === id);
      
      if (conversation) {
        conversation.title = title;
        conversation.updatedAt = new Date().toISOString();
        this.persist(conversations);
      }
    } catch (error) {
      console.error("Error updating conversation title:", error);
    }
  }

  /**
   * Obtener la conversación actual
   */
  static getCurrentConversationId(): string | null {
    return localStorage.getItem(CURRENT_CONVERSATION_KEY);
  }

  /**
   * Establecer la conversación actual
   */
  static setCurrentConversationId(id: string): void {
    localStorage.setItem(CURRENT_CONVERSATION_KEY, id);
  }

  /**
   * Exportar conversación a JSON
   */
  static exportToJSON(conversation: Conversation): string {
    return JSON.stringify(conversation, null, 2);
  }

  /**
   * Exportar conversación a Markdown
   */
  static exportToMarkdown(conversation: Conversation): string {
    let markdown = `# ${conversation.title}\n\n`;
    markdown += `**Fecha:** ${new Date(conversation.createdAt).toLocaleString()}\n`;
    markdown += `**Modelo:** ${conversation.model}\n`;
    markdown += `**Agentes:** ${conversation.agents.join(", ")}\n\n`;
    markdown += `---\n\n`;

    conversation.messages.forEach((message, index) => {
      if (message.role === "user") {
        markdown += `## 👤 Usuario\n\n${message.content}\n\n`;
      } else {
        markdown += `## 🤖 Asistente\n\n`;
        
        if (message.agentResponses && message.agentResponses.length > 0) {
          message.agentResponses.forEach((response, idx) => {
            markdown += `### ${response.agent_name}\n\n`;
            markdown += `${response.raw_content || response.summary || message.content}\n\n`;
            if (idx < message.agentResponses!.length - 1) {
              markdown += `---\n\n`;
            }
          });
        } else {
          markdown += `${message.content}\n\n`;
        }
      }
      
      markdown += `---\n\n`;
    });

    return markdown;
  }

  /**
   * Descargar conversación como archivo
   */
  static downloadConversation(conversation: Conversation, format: 'json' | 'markdown'): void {
    const content = format === 'json' 
      ? this.exportToJSON(conversation)
      : this.exportToMarkdown(conversation);
    
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conversation.title.replace(/[^a-z0-9]/gi, '_')}.${format === 'json' ? 'json' : 'md'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Limpiar conversaciones antiguas (mantener últimas N)
   */
  static cleanOldConversations(keepCount: number = 50): void {
    try {
      const conversations = this.getAllConversations();
      
      if (conversations.length > keepCount) {
        // Ordenar por fecha de actualización (más recientes primero)
        conversations.sort((a, b) => 
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        
        // Mantener solo las más recientes
        const toKeep = conversations.slice(0, keepCount);
        this.persist(toKeep);
      }
    } catch (error) {
      console.error("Error cleaning old conversations:", error);
    }
  }

  // ============== HISTORIAL EN SERVIDOR (solo con sesión iniciada) ==============

  /** Conversaciones guardadas en el servidor (resumen, sin mensajes). */
  static async getServerConversations(): Promise<Conversation[]> {
    if (!hasSession()) return [];
    try {
      const conversations = await listServerConversations();
      return conversations.map((conv) => ({
        id: conv.conversation_id,
        title: conv.title,
        messages: [],
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        model: conv.model || "",
        agents: conv.agents || [],
      }));
    } catch (error) {
      console.warn("No se pudo leer el historial del servidor:", error);
      return [];
    }
  }

  /** Mensajes de una conversación del servidor. */
  static async getServerConversationMessages(conversationId: string): Promise<StoredMessage[]> {
    if (!hasSession()) return [];
    try {
      const detail = await getServerConversation(conversationId);
      return (detail?.messages || []).map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.created_at,
        agent_id: msg.agent_id || undefined,
        metadata: msg.metadata || undefined,
      }));
    } catch (error) {
      console.warn("No se pudo leer la conversación del servidor:", error);
      return [];
    }
  }

  static async deleteServerConversation(conversationId: string): Promise<boolean> {
    if (!hasSession()) return false;
    try {
      return await apiDeleteServerConversation(conversationId);
    } catch {
      return false;
    }
  }

  /** El título se edita localmente; el servidor conserva el título original del primer mensaje. */
  static async updateServerConversationTitle(_conversationId: string, _title: string): Promise<boolean> {
    return false;
  }
}
