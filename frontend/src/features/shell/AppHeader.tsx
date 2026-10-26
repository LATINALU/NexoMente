"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronDown, Cpu, Settings, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { selectApiReady, selectEnabledProviders, useWorkspace } from "@/stores/workspace";
import { Button } from "@/components/ui/button";
import { PaletteHint } from "@/components/CommandPalette";

export function AppHeader({ wsConnected, onOpenSettings }: { wsConnected: boolean; onOpenSettings: () => void }) {
  const apiReady = useWorkspace(selectApiReady);
  // useShallow: el selector filtra (array nuevo en cada llamada) y sin esto Zustand 5 re-renderiza en bucle
  const enabledProviders = useWorkspace(useShallow(selectEnabledProviders));
  const { apiConfig, model, selectModel } = useWorkspace();
  const [open, setOpen] = useState(false);

  return (
    <header className="h-16 border-b border-primary/20 bg-card/50 backdrop-blur-sm px-6 flex items-center justify-between shrink-0 relative z-20">
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicon.svg" alt="" className="h-11 w-11 rounded-xl shadow-lg shadow-primary/20" />
        <div className="hidden sm:block">
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Nexo</h1>
          <span className="text-xs font-semibold text-muted-foreground">Equipos de agentes IA · 500 especialistas</span>
        </div>
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3">
        <button
          onClick={() => !apiReady && onOpenSettings()}
          className={cn(
            "hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs font-bold tracking-wider uppercase transition-all",
            apiReady ? "bg-green-500/10 border-green-500/30 text-green-500" : "bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20",
          )}
          title={wsConnected ? "Servidor conectado en tiempo real" : "Servidor sin WebSocket (se usará SSE)"}
        >
          <Zap className={cn("h-4 w-4", apiReady && "fill-current")} />
          {apiReady ? `${apiConfig.name} lista` : "Configura tu API"}
          <span className={cn("h-2 w-2 rounded-full", wsConnected ? "bg-green-500" : "bg-amber-500")} />
        </button>

        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            disabled={enabledProviders.length === 0}
            className={cn(
              "flex items-center gap-2 px-4 py-1.5 rounded-full border transition-all",
              enabledProviders.length ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20" : "bg-muted/30 border-border text-muted-foreground",
            )}
          >
            <Cpu className="h-4 w-4" />
            <span className="text-xs font-mono max-w-24 md:max-w-40 truncate">{model || "Sin modelo"}</span>
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
          </button>
          {open && enabledProviders.length > 0 && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <div className="absolute top-full left-0 mt-2 min-w-64 bg-card border border-border rounded-lg shadow-xl z-40 max-h-72 overflow-y-auto">
                {enabledProviders.map((provider) => (
                  <div key={provider.id}>
                    <div className="px-3 py-2 bg-muted/30 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{provider.name}</div>
                    {(provider.enabledModels || []).map((m) => (
                      <button
                        key={m}
                        onClick={() => { selectModel(provider, m); setOpen(false); }}
                        className={cn("w-full flex items-center justify-between px-3 py-2 hover:bg-primary/10 text-left",
                          m === model && provider.id === apiConfig.id && "bg-primary/20 text-primary")}
                      >
                        <span className="text-xs font-mono truncate">{m}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <PaletteHint />
        <Button variant="outline" size="sm" onClick={onOpenSettings} className="gap-2">
          <Settings className="h-4 w-4" /><span className="hidden sm:inline">Ajustes</span>
        </Button>
      </div>
    </header>
  );
}
