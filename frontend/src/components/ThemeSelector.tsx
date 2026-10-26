"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES, ThemeId, applyTheme, saveTheme, savedTheme } from "@/lib/theme";

export type { ThemeId } from "@/lib/theme";

interface ThemeSelectorProps {
  onThemeChange?: (theme: ThemeId) => void;
}

/**
 * Selector de tema. Cada tarjeta se pinta con su propio `data-theme`, así la vista previa
 * usa los colores reales del tema (no una copia que se desactualice).
 */
export function ThemeSelector({ onThemeChange }: ThemeSelectorProps) {
  const [current, setCurrent] = useState<ThemeId | null>(null);

  useEffect(() => setCurrent(savedTheme()), []);

  const choose = (id: ThemeId) => {
    setCurrent(id);
    applyTheme(id);
    saveTheme(id);
    onThemeChange?.(id);
  };

  if (!current) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Tema visual">
      {THEMES.map((theme) => {
        const active = current === theme.id;
        return (
          <button
            key={theme.id}
            data-theme={theme.id}
            role="radio"
            aria-checked={active}
            onClick={() => choose(theme.id)}
            className={cn(
              "relative flex items-stretch gap-3 rounded-xl border-2 p-3 text-left transition-all",
              "bg-background text-foreground",
              active ? "border-primary shadow-md ring-2 ring-primary/30" : "border-border hover:border-primary/60",
            )}
          >
            {/* Mini maqueta: barra lateral, mensaje y botón con los colores del tema */}
            <div className="flex w-16 shrink-0 overflow-hidden rounded-md border border-border" aria-hidden>
              <div className="w-4 bg-card" />
              <div className="flex flex-1 flex-col justify-between gap-1 bg-background p-1">
                <div className="h-1.5 w-full rounded-full bg-muted" />
                <div className="h-1.5 w-2/3 rounded-full bg-foreground/70" />
                <div className="h-2 w-6 self-end rounded-sm bg-primary" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-bold">
                {theme.name}
                {active && <Check className="h-3.5 w-3.5 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground">{theme.description}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {theme.scheme === "dark" ? "Oscuro" : "Claro"}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
