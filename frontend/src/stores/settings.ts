/**
 * Preferencias persistentes del usuario (no secretas): opciones de ejecución,
 * instrucciones por agente, favoritos y modelos de documentos.
 *
 * Reemplaza las claves sueltas de localStorage y los eventos `nexo:*-changed`.
 * `skipHydration`: se rehidrata en el cliente desde <StoreHydrator/> para no romper
 * la hidratación de la página pre-renderizada.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { RunOptions } from "@/lib/chat";
import type { DocSettings } from "@/lib/docSettings";

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  mode: "parallel", synthesize: true, webSearch: false, toolMode: "prefetch", review: false, followups: true,
  reasoning: "auto",
  notes: true,
};

interface SettingsState {
  runOptions: RunOptions;
  agentInstructions: Record<string, string>;
  favorites: string[];
  docSettings: DocSettings;
  setRunOptions: (patch: Partial<RunOptions>) => void;
  setInstruction: (agentId: string, text: string) => void;
  mergeInstructions: (instructions: Record<string, string>) => void;
  toggleFavorite: (agentId: string) => void;
  setDocSettings: (settings: DocSettings) => void;
}

function legacy<T>(key: string, fallback: T): T {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? { ...(fallback as object), ...JSON.parse(raw) } as T : fallback;
  } catch {
    return fallback;
  }
}

function legacyList(key: string): string[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      runOptions: DEFAULT_RUN_OPTIONS,
      agentInstructions: {},
      favorites: [],
      docSettings: { ocr: null, embeddings: null },
      setRunOptions: (patch) => set((s) => ({ runOptions: { ...s.runOptions, ...patch } })),
      setInstruction: (agentId, text) =>
        set((s) => {
          const next = { ...s.agentInstructions };
          if (text.trim()) next[agentId] = text.trim().slice(0, 1500);
          else delete next[agentId];
          return { agentInstructions: next };
        }),
      mergeInstructions: (instructions) => set((s) => ({ agentInstructions: { ...s.agentInstructions, ...instructions } })),
      toggleFavorite: (agentId) =>
        set((s) => ({ favorites: s.favorites.includes(agentId) ? s.favorites.filter((id) => id !== agentId) : [...s.favorites, agentId] })),
      setDocSettings: (docSettings) => set({ docSettings }),
    }),
    {
      name: "nexo_settings",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: ({ runOptions, agentInstructions, favorites, docSettings }) => ({ runOptions, agentInstructions, favorites, docSettings }),
      // Primera vez: adoptar las claves que usaban las versiones anteriores
      merge: (persisted, current) => {
        if (persisted) {
          const saved = persisted as Partial<SettingsState>;
          // Opciones agregadas en versiones nuevas toman su valor por defecto
          return { ...current, ...saved, runOptions: { ...DEFAULT_RUN_OPTIONS, ...saved.runOptions } };
        }
        return {
          ...current,
          runOptions: { ...DEFAULT_RUN_OPTIONS, ...legacy("nexo_run_options", DEFAULT_RUN_OPTIONS) },
          agentInstructions: legacy<Record<string, string>>("nexo_agent_instructions", {}),
          favorites: legacyList("nexo_favorite_agents"),
          docSettings: legacy<DocSettings>("nexo_doc_settings", { ocr: null, embeddings: null }),
        };
      },
    },
  ),
);
