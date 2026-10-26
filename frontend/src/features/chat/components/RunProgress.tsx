"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunState } from "@/core/runReducer";

type StepState = "pending" | "active" | "done";

interface Step {
  label: string;
  state: StepState;
  weight: number;
}

/** Fases de la ejecución a partir del estado en vivo (agentes → revisión → síntesis). */
export function runSteps(run: RunState): Step[] {
  const total = run.order.length;
  const remaining = run.order.filter((id) => run.agents[id]).length;
  const doneAgents = total - remaining;
  const agentsDone = remaining === 0;
  const synthesisActive = run.synthesis !== null;
  const steps: Step[] = [{
    label: total > 1 ? `Agentes ${doneAgents}/${total}` : "Agente",
    state: agentsDone ? "done" : "active",
    weight: 3,
  }];
  if (run.plan.review) {
    steps.push({
      label: "Revisión",
      state: run.reviewDone || synthesisActive ? "done" : run.review !== null ? "active" : "pending",
      weight: 1,
    });
  }
  if (run.plan.synthesis && (total > 1 || run.plan.review)) {
    steps.push({ label: "Respuesta integrada", state: synthesisActive ? "active" : "pending", weight: 2 });
  }
  return steps;
}

export function progressPercent(run: RunState): number {
  const steps = runSteps(run);
  const total = steps.reduce((acc, s) => acc + s.weight, 0);
  let done = 0;
  for (const s of steps) {
    if (s.state === "done") done += s.weight;
    else if (s.state === "active") {
      // Agentes: avance proporcional; resto de fases: a mitad de camino mientras corren
      const ratio = s.label.startsWith("Agentes") && run.order.length
        ? (run.order.length - run.order.filter((id) => run.agents[id]).length) / run.order.length
        : 0.5;
      done += s.weight * Math.max(0.08, ratio);
    }
  }
  return Math.min(98, Math.round((done / total) * 100));
}

const formatElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Barra de progreso fija arriba de la ejecución en vivo, con fases y cronómetro. */
export function RunProgress({ run }: { run: RunState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!run.running || !run.startedAt) return null;
  const steps = runSteps(run);
  const percent = progressPercent(run);

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 rounded-xl border border-primary/25 bg-card/95 px-3 py-2 shadow-sm backdrop-blur animate-in fade-in slide-in-from-top-2"
      role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {steps.map((step, i) => (
          <span key={step.label} className={cn("inline-flex items-center gap-1 font-medium",
            step.state === "done" ? "text-primary" : step.state === "active" ? "text-foreground" : "text-muted-foreground")}>
            {i > 0 && <span className="mr-2 text-muted-foreground">›</span>}
            {step.state === "done" ? <Check className="h-3.5 w-3.5" />
              : step.state === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <span className="h-2 w-2 rounded-full border border-muted-foreground" />}
            {step.label}
          </span>
        ))}
        <span className="ml-auto font-mono tabular-nums text-muted-foreground" title="Tiempo transcurrido">
          ⏱ {formatElapsed(now - run.startedAt)}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-700 ease-out" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
