"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Category, getCategories } from "@/lib/api";
import { MAX_SELECTED_AGENTS, useWorkspace } from "@/stores/workspace";

/**
 * Las categorías como una fila de píldoras debajo del cerebro. Tocar una abre sus expertos para
 * activarlos de a uno (o todos); la píldora cuenta cuántos de los suyos están elegidos.
 */
export function CategoryDock({ disabled }: { disabled?: boolean }) {
  const catalog = useWorkspace((s) => s.catalog);
  const selected = useWorkspace((s) => s.selectedAgents);
  const toggleAgent = useWorkspace((s) => s.toggleAgent);
  const toggleCategory = useWorkspace((s) => s.toggleCategory);
  const setAgents = useWorkspace((s) => s.setAgents);
  const [categorias, setCategorias] = useState<Category[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    if (useWorkspace.getState().catalogStatus === "idle") useWorkspace.getState().loadCatalog();
    getCategories().then((r) => setCategorias(r.categories || [])).catch(() => setCategorias([]));
  }, []);

  const porCategoria = useMemo(() => {
    const m = new Map<string, typeof catalog>();
    for (const a of catalog) m.set(a.category, [...(m.get(a.category) || []), a]);
    return m;
  }, [catalog]);

  // Primero las categorías con expertos elegidos
  const ordenadas = useMemo(() => {
    const cuenta = (c: Category) => (porCategoria.get(c.id) || []).filter((a) => selected.includes(a.id)).length;
    return [...categorias].sort((a, b) => cuenta(b) - cuenta(a));
  }, [categorias, porCategoria, selected]);

  const actual = categorias.find((c) => c.id === abierta);
  const expertos = abierta ? porCategoria.get(abierta) || [] : [];
  const elegidos = catalog.filter((a) => selected.includes(a.id));

  return (
    <div className="relative w-full">
      {actual && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-white/10 bg-black/75 p-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white">{actual.emoji} {actual.name}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => toggleCategory(expertos.map((a) => a.id))} disabled={disabled}
                className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/80 hover:border-primary hover:text-white disabled:opacity-40">
                {expertos.length && expertos.every((a) => selected.includes(a.id)) ? "Quitar todos" : "Todos"}
              </button>
              <button onClick={() => setAbierta(null)} className="rounded-full p-1 text-white/60 hover:text-white" title="Cerrar"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {expertos.map((a) => {
              const on = selected.includes(a.id);
              const lleno = !on && selected.length >= MAX_SELECTED_AGENTS;
              return (
                <button key={a.id} onClick={() => toggleAgent(a.id)} disabled={disabled || lleno} title={a.description}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40",
                    on ? "border-primary bg-primary/25 text-white" : "border-white/10 bg-white/5 text-white/75 hover:border-white/30")}>
                  {on && <Check className="h-3 w-3" />}{a.emoji} {a.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {elegidos.length > 0 && (
          <button onClick={() => setAgents([])} disabled={disabled} title="Quitar todos los expertos"
            className="shrink-0 rounded-full border border-primary/50 bg-primary/20 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            {elegidos.slice(0, 4).map((a) => a.emoji).join("")} {elegidos.length} {elegidos.length === 1 ? "experto" : "expertos"} <X className="ml-0.5 inline h-3 w-3" />
          </button>
        )}
        {ordenadas.map((c) => {
          const n = (porCategoria.get(c.id) || []).filter((a) => selected.includes(a.id)).length;
          return (
            <button key={c.id} onClick={() => setAbierta(abierta === c.id ? null : c.id)}
              className={cn("shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs backdrop-blur transition-colors",
                abierta === c.id ? "border-primary bg-primary/30 text-white" :
                n ? "border-primary/50 bg-primary/15 text-white" : "border-white/10 bg-black/50 text-white/70 hover:border-white/30 hover:text-white")}>
              {c.emoji} {c.name}{n > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
