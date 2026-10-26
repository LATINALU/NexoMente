"use client";

import { Compass, FileText, Globe, Loader2, Search, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunState } from "@/core/runReducer";
import { Markdown } from "@/components/Markdown";
import { RunProgress } from "./RunProgress";

const Skeleton = ({ className }: { className?: string }) => <div className={cn("h-4 rounded animate-pulse", className)} />;

/** Mientras el modelo razona y todavía no escribe: muestra un adelanto de lo que piensa. */
function Thinking({ text, fallback }: { text?: string; fallback: React.ReactNode }) {
  if (!text) return <>{fallback}</>;
  return (
    <div className="text-xs text-muted-foreground italic flex gap-2">
      <span className="not-italic">💭</span>
      <span className="line-clamp-3">Razonando… {text.slice(-280)}</span>
    </div>
  );
}

/** Lo que está ocurriendo ahora: investigación, agentes escribiendo, revisión y síntesis. */
export function LiveRun({ run }: { run: RunState }) {
  const agents = run.order.map((id) => run.agents[id]).filter(Boolean);
  return (
    <>
      <RunProgress run={run} />
      {run.research && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm">
          <Search className="h-4 w-4 text-cyan-400 mt-0.5 animate-pulse" />
          <div>
            <div className="font-semibold text-cyan-400">Buscando en la web…</div>
            {run.research.queries.length > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5">{run.research.queries.map((q) => `“${q}”`).join(" · ")}</div>
            )}
          </div>
        </div>
      )}

      {agents.map((agent) => (
        <div key={agent.id} className="mb-4 rounded-xl border border-primary/20 bg-muted/20 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
            <span className="text-xl">{agent.emoji}</span>{agent.name}
            <Loader2 className={cn("h-3.5 w-3.5 animate-spin text-primary", agent.status === "waiting" && "opacity-40")} />
            <span className="text-xs font-normal text-muted-foreground">{agent.text ? "escribiendo…" : run.thinking[agent.id] ? "razonando…" : agent.status === "waiting" ? "en cola" : "esperando respuesta…"}</span>
          </div>
          {agent.tools?.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1 text-xs text-cyan-400">
              {t.tool === "buscar_web" ? <Globe className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
              {t.tool === "buscar_web" ? "Buscó en la web:" : "Buscó en los documentos:"} <span className="italic">“{t.query}”</span>
            </div>
          ))}
          {agent.text ? <Markdown className="streaming-caret">{agent.text}</Markdown> : <Thinking text={run.thinking[agent.id]} fallback={<Skeleton className="w-1/3 bg-primary/10" />} />}
        </div>
      ))}

      {run.review !== null && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-amber-500">
            <ShieldCheck className="h-4 w-4" />Revisando aportes<Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
          {run.review ? <Markdown className="streaming-caret">{run.review}</Markdown> : <Thinking text={run.thinking.reviewer} fallback={<Skeleton className="w-1/3 bg-amber-500/10" />} />}
        </div>
      )}

      {run.synthesis !== null && (
        <div className="mb-6 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-cyan-500/5 p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-2 mb-3 font-semibold text-primary">
            <Compass className="h-5 w-5" />Integrando respuestas<Loader2 className="h-4 w-4 animate-spin" />
          </div>
          {run.synthesis ? <Markdown className="streaming-caret">{run.synthesis}</Markdown> : <Thinking text={run.thinking.coordinator} fallback={<Skeleton className="w-1/2 bg-primary/10" />} />}
        </div>
      )}
    </>
  );
}
