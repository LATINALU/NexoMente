"use client";

import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import type { ReasoningLevel, RunMode, RunOptions, ToolMode } from "@/lib/chat";
import { Button } from "@/components/ui/button";

interface Choice<T extends string> {
  value: T;
  title: string;
  help: string;
}

const MODES: Choice<RunMode>[] = [
  { value: "parallel", title: "Paralelo", help: "Todos a la vez: más rápido." },
  { value: "sequential", title: "Secuencial", help: "Cada agente ve lo que dijeron los anteriores." },
];
const TOOL_MODES: Choice<ToolMode>[] = [
  { value: "prefetch", title: "Búsqueda previa", help: "Se busca una vez y todos reciben las mismas fuentes. Funciona con cualquier modelo." },
  { value: "native", title: "Herramientas nativas", help: "Cada agente decide qué y cuándo buscar. Requiere un modelo con function calling." },
];
const REASONING: Choice<ReasoningLevel>[] = [
  { value: "auto", title: "Automático", help: "Lo que haga el modelo por defecto." },
  { value: "none", title: "Apagado", help: "Responde directo. Mucho más rápido en modelos locales." },
  { value: "low", title: "Bajo", help: "Piensa un poco antes de responder." },
  { value: "high", title: "Alto", help: "Piensa a fondo: mejor en problemas difíciles, más lento y caro." },
];
const TOGGLES: Array<{ key: "synthesize" | "review" | "followups"; title: string; help: string }> = [
  { key: "synthesize", title: "Respuesta integrada", help: "Un Coordinador une los aportes en una sola respuesta." },
  { key: "review", title: "Revisión crítica", help: "Un Revisor busca errores y vacíos antes de integrar. Usa más tokens." },
  { key: "followups", title: "Sugerir seguimientos", help: "Propone 3 preguntas para continuar." },
];

export function RunOptionsMenu({ options, onChange }: { options: RunOptions; onChange: (patch: Partial<RunOptions>) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // que Esc cierre el menú y no detenga una consulta
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  const radio = <T extends string>(title: string, choices: Choice<T>[], current: T, set: (v: T) => void) => (
    <div>
      <div className="font-semibold mb-1">{title}</div>
      {choices.map((c) => (
        <label key={c.value} className="flex items-start gap-2 py-1 cursor-pointer">
          <input type="radio" checked={current === c.value} onChange={() => set(c.value)} className="mt-0.5" />
          <span><b>{c.title}</b><span className="block text-muted-foreground">{c.help}</span></span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="relative">
      <Button variant="outline" size="sm" className="h-[28px] w-[34px] px-0" onClick={() => setOpen(!open)} title="Opciones de ejecución">
        <Settings2 className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-border bg-card p-3 shadow-xl z-40 text-xs space-y-3">
            {radio("Modo de trabajo", MODES, options.mode, (mode) => onChange({ mode }))}
            <div className="border-t border-border pt-2">
              {radio("Fuentes (documentos y web)", TOOL_MODES, options.toolMode, (toolMode) => onChange({ toolMode }))}
            </div>
            <div className="border-t border-border pt-2">
              {radio("Razonamiento del modelo", REASONING, options.reasoning, (reasoning) => onChange({ reasoning }))}
            </div>
            <div className="border-t border-border pt-2 space-y-1">
              {TOGGLES.map((t) => (
                <label key={t.key} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={options[t.key]} onChange={(e) => onChange({ [t.key]: e.target.checked })} className="mt-0.5" />
                  <span><b>{t.title}</b><span className="block text-muted-foreground">{t.help}</span></span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
