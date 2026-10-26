"use client";

/**
 * Paleta de comandos (Ctrl/⌘+K) y atajos globales de Nexo.
 * Busca acciones, agentes (para agregarlos/quitarlos), equipos guardados y temas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Command, CornerDownLeft, Keyboard, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/stores/workspace";
import { Team, listTeams } from "@/lib/teams";
import { ChatCommand, sendChatCommand } from "@/features/chat/commands";
import { THEMES, applyTheme, saveTheme } from "@/lib/theme";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  selectedAgents: string[];
  onToggleAgent: (id: string) => void;
  onApplyTeam: (team: Team) => void;
  onOpenSettings: () => void;
  onClearAgents: () => void;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = () => (isMac() ? "⌘" : "Ctrl");

export const SHORTCUTS: Array<{ keys: string; label: string; command?: ChatCommand }> = [
  { keys: "Mod+K", label: "Abrir la paleta de comandos" },
  { keys: "Mod+Shift+O", label: "Nueva conversación", command: "new-chat" },
  { keys: "Mod+Shift+E", label: "Exportar a Markdown", command: "export" },
  { keys: "Mod+Shift+L", label: "Compartir por link", command: "share" },
  { keys: "Mod+Shift+F", label: "Activar/desactivar búsqueda web", command: "toggle-web" },
  { keys: "/", label: "Escribir una consulta", command: "focus-input" },
  { keys: "Esc", label: "Detener la generación", command: "stop" },
];

function normalize(text: string) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function CommandPalette({ selectedAgents, onToggleAgent, onApplyTeam, onOpenSettings, onClearAgents }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const agents = useWorkspace((s) => s.catalog);
  const [teams, setTeams] = useState<Team[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  // Atajos globales
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const modKey = e.metaKey || e.ctrlKey;
      if (modKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (modKey && e.shiftKey) {
        const map: Record<string, ChatCommand> = { o: "new-chat", e: "export", l: "share", f: "toggle-web" };
        const command = map[e.key.toLowerCase()];
        if (command) {
          e.preventDefault();
          sendChatCommand(command);
        }
        return;
      }
      if (e.key === "Escape" && !open) sendChatCommand("stop");
      if (e.key === "/" && !open && !isTyping(e.target)) {
        e.preventDefault();
        sendChatCommand("focus-input");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 0);
    useWorkspace.getState().loadCatalog(); // no-op si ya está cargado
    listTeams().then(setTeams).catch(() => {});
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const run = (fn: () => void) => () => {
      close();
      fn();
    };
    const actions: PaletteItem[] = [
      { id: "new", group: "Acciones", label: "Nueva conversación", hint: `${mod()}+Shift+O`, icon: "➕", run: run(() => sendChatCommand("new-chat")) },
      { id: "suggest", group: "Acciones", label: "Sugerir agentes para lo que escribí", icon: "🪄", run: run(() => sendChatCommand("suggest")) },
      { id: "regen", group: "Acciones", label: "Regenerar la última respuesta", icon: "🔁", run: run(() => sendChatCommand("regenerate")) },
      { id: "web", group: "Acciones", label: "Activar/desactivar búsqueda web", hint: `${mod()}+Shift+F`, icon: "🌐", run: run(() => sendChatCommand("toggle-web")) },
      { id: "export", group: "Acciones", label: "Exportar conversación a Markdown", hint: `${mod()}+Shift+E`, icon: "📄", run: run(() => sendChatCommand("export")) },
      { id: "share", group: "Acciones", label: "Compartir por link", hint: `${mod()}+Shift+L`, icon: "🔗", run: run(() => sendChatCommand("share")) },
      { id: "clear", group: "Acciones", label: "Quitar todos los agentes seleccionados", icon: "🧹", run: run(onClearAgents) },
      { id: "settings", group: "Acciones", label: "Abrir ajustes", icon: "⚙️", keywords: "configuracion api keys costos documentos", run: run(onOpenSettings) },
    ];
    const teamItems: PaletteItem[] = teams.map((t) => ({
      id: `team-${t.id}`, group: "Mis equipos", label: t.name, icon: t.emoji, hint: `${t.agents.length} agentes`,
      run: run(() => onApplyTeam(t)),
    }));
    const agentItems: PaletteItem[] = agents.map((a) => {
      const selected = selectedAgents.includes(a.id);
      return {
        id: `agent-${a.id}`, group: "Agentes", icon: a.emoji,
        label: `${selected ? "Quitar" : "Agregar"} ${a.name}`, hint: a.specialization,
        keywords: `${a.description} ${a.category} ${(a.capabilities || []).join(" ")}`,
        run: () => onToggleAgent(a.id), // no cierra: permite elegir varios
      };
    });
    const themeItems: PaletteItem[] = THEMES.map((t) => ({
      id: `theme-${t.id}`, group: "Temas", icon: t.scheme === "dark" ? "🌙" : "☀️", label: `Tema: ${t.name}`,
      hint: t.description, keywords: `tema theme apariencia color ${t.scheme === "dark" ? "oscuro" : "claro"}`,
      run: run(() => { applyTheme(t.id); saveTheme(t.id); }),
    }));
    return [...actions, ...teamItems, ...themeItems, ...agentItems];
  }, [agents, teams, selectedAgents, close, onApplyTeam, onClearAgents, onOpenSettings, onToggleAgent]);

  const filtered = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    const matches = terms.length
      ? items.filter((i) => terms.every((t) => normalize(`${i.label} ${i.hint || ""} ${i.keywords || ""}`).includes(t)))
      : items.filter((i) => i.group !== "Agentes" && i.group !== "Temas"); // aparecen al buscar
    return matches.slice(0, 60);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center pt-[12vh] p-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca acciones, agentes o equipos…"
            className="flex-1 py-3 bg-transparent text-sm focus:outline-none" />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Sin resultados</p>}
          {filtered.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{header}</div>}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={item.run}
                  className={cn("w-full flex items-center gap-3 px-4 py-2 text-left text-sm", i === active && "bg-primary/10 text-primary")}
                >
                  <span className="w-5 text-center">{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="text-[11px] text-muted-foreground truncate max-w-[40%]">{item.hint}</span>}
                  {i === active && <CornerDownLeft className="h-3 w-3" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border px-4 py-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-semibold"><Keyboard className="h-3 w-3" />Atajos</span>
          {SHORTCUTS.map((s) => (
            <span key={s.keys}><kbd className="font-mono">{s.keys.replace("Mod", mod())}</kbd> {s.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PaletteHint() {
  return (
    <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
      className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:text-primary hover:border-primary"
      title="Paleta de comandos">
      <Command className="h-3 w-3" />K
    </button>
  );
}
