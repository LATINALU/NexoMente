"use client";

import { Brain, Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReadinessStep {
  id: string;
  label: string;
  done: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

const EXAMPLES = [
  "Plan de lanzamiento para una app de delivery en Montevideo con presupuesto de 20 mil USD",
  "Revisá este contrato de alquiler y marcá los riesgos para el inquilino",
  "Arquitectura y stack para un SaaS B2B multi-tenant, con diagrama",
];

/** Pantalla inicial: qué falta para empezar y ejemplos de buenas consultas. */
export function EmptyState({ steps, onExample }: { steps: ReadinessStep[]; onExample: (text: string) => void }) {
  const pending = steps.filter((s) => !s.done);
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-8">
      <div className="flex flex-col items-center text-center max-w-lg w-full">
        <div className="bg-gradient-to-br from-primary/20 to-cyan-500/20 rounded-full p-7 mb-6 ring-1 ring-primary/30">
          <Brain className="h-14 w-14 text-primary" />
        </div>
        <h3 className="text-2xl font-black mb-2 bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">NexoMente</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Un equipo de especialistas trabaja tu consulta en paralelo, consulta tus notas y un Coordinador integra todo con fuentes citadas. Abre el 🧠 para ver tu memoria en vivo.
        </p>

        {pending.length > 0 && (
          <div className="w-full rounded-xl border border-border bg-muted/10 p-4 mb-6 text-left">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Para empezar</div>
            <ol className="space-y-2">
              {steps.map((step) => (
                <li key={step.id} className="flex items-center gap-2 text-sm">
                  {step.done ? <Check className="h-4 w-4 text-green-500" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                  <span className={cn("flex-1", step.done && "line-through text-muted-foreground")}>{step.label}</span>
                  {!step.done && step.onAction && (
                    <button onClick={step.onAction} className="text-xs font-semibold text-primary hover:underline">{step.actionLabel}</button>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="w-full text-left">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Ejemplos de buenas consultas</div>
          <div className="space-y-1.5">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => onExample(example)}
                className="w-full text-left px-3 py-2 rounded-lg border border-border hover:border-primary hover:bg-primary/5 text-xs">
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
