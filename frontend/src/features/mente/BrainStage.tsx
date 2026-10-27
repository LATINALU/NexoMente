"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Loader2, MessageSquare, Sparkles } from "lucide-react";
import type { Turn } from "@/lib/chat";
import type { RunState } from "@/core/runReducer";
import { menteMapa } from "@/lib/mente";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { useWorkspace } from "@/stores/workspace";
import { escenaDe, EstadoExperto } from "./escena";
import { SaveToMind } from "./SaveToMind";

const TEXTO_ESTADO: Record<EstadoExperto, string> = {
  espera: "en cola", piensa: "pensando", escribe: "escribiendo", listo: "listo", error: "falló",
};

interface BrainStageProps {
  /** La consulta a mostrar: la última del camino */
  turn?: Turn;
  run: RunState | null;
  pending: boolean;
  conversationId: string;
  canRemember: boolean;
  onExit: () => void;
}

/**
 * Modo Cerebro: el mapa 3D ocupa la escena. La pregunta flota arriba, cada experto elegido es una luz que
 * viaja por el cerebro hasta las notas que lee, y la respuesta se arma abajo. El mapa corre en su servidor
 * local (otro origen): la app le manda la escena por postMessage y él solo la dibuja.
 */
export function BrainStage({ turn, run, pending, conversationId, canRemember, onExit }: BrainStageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const marco = useRef<HTMLIFrameElement>(null);
  const selectedAgents = useWorkspace((s) => s.selectedAgents);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setUrl(`${await menteMapa()}&cine&nexo`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el cerebro");
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const escena = escenaDe(turn, run, pending);
  const clave = JSON.stringify(escena);
  const ultima = useRef(clave);
  ultima.current = clave;

  const enviar = useCallback(() => {
    const destino = marco.current?.contentWindow;
    if (!destino || !url) return;
    destino.postMessage({ nexo: "escena", escena: JSON.parse(ultima.current) }, new URL(url).origin);
  }, [url]);

  // Solo cuando cambia algo de la escena (no con cada token)
  useEffect(() => { enviar(); }, [clave, enviar]);

  // El mapa avisa cuando ya escucha (tarda en cargar sus notas): se le manda la escena actual
  useEffect(() => {
    const oir = (ev: MessageEvent) => {
      if (ev.source === marco.current?.contentWindow && ev.data?.nexo === "listo") enviar();
    };
    window.addEventListener("message", oir);
    return () => window.removeEventListener("message", oir);
  }, [enviar]);

  const respuesta = useMemo(() => {
    if (!turn) return null;
    if (pending && run) {
      if (run.synthesis !== null) return { texto: run.synthesis, quien: "El cerebro integra las respuestas" };
      const escribiendo = run.order.map((id) => run.agents[id]).find((a) => a?.text);
      if (escribiendo) return { texto: escribiendo.text, quien: `${escribiendo.emoji} ${escribiendo.name} escribe` };
      return null;
    }
    const sintesis = turn.answers.find((a) => a.isSynthesis && !a.interrupted);
    if (sintesis) return { texto: sintesis.content, quien: "Respuesta del cerebro" };
    const agentes = turn.answers.filter((a) => !a.isReview && a.content.trim());
    if (!agentes.length) return null;
    return { texto: agentes.map((a) => `**${a.agentEmoji || "🤖"} ${a.agentName || "Experto"}**\n\n${a.content}`).join("\n\n---\n\n"),
             quien: "Respuesta del cerebro" };
  }, [turn, run, pending]);

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-black">
      {url && !error && (
        <iframe ref={marco} key={url} src={url} title="Cerebro de NexoMente" onLoad={enviar}
          className="absolute inset-0 h-full w-full border-0" sandbox="allow-scripts allow-same-origin" />
      )}
      {!url && !error && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Despertando el cerebro…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <Brain className="h-8 w-8 opacity-40" /><p>{error}</p>
          <button onClick={cargar} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary">Reintentar</button>
        </div>
      )}

      <button onClick={onExit} title="Volver a la conversación"
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white/80 backdrop-blur hover:text-white">
        <MessageSquare className="h-3.5 w-3.5" />Conversación
      </button>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 p-4 pt-5">
        {turn ? (
          <p className="max-w-2xl rounded-2xl border border-white/10 bg-black/55 px-4 py-2 text-center text-sm text-white/90 shadow-lg backdrop-blur line-clamp-3 animate-in fade-in slide-in-from-top-2">
            “{turn.user.content}”
          </p>
        ) : (
          <p className="max-w-md rounded-2xl border border-white/10 bg-black/55 px-4 py-2 text-center text-sm text-white/80 backdrop-blur">
            <Sparkles className="mr-1 inline h-3.5 w-3.5 text-primary" />
            {selectedAgents.length ? `Preguntale al cerebro: ${selectedAgents.length === 1 ? "tu experto lo pensará" : `${selectedAgents.length} expertos lo pensarán`} aquí adentro.` : "Elegí uno o más expertos y preguntale al cerebro."}
          </p>
        )}
        {escena.expertos.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {escena.expertos.map((e) => (
              <span key={e.id} className={cn("rounded-full border px-2 py-0.5 text-[11px] backdrop-blur transition-colors",
                e.estado === "escribe" || e.estado === "piensa" ? "border-primary/50 bg-primary/15 text-white" :
                e.estado === "error" ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-white/10 bg-black/50 text-white/60")}>
                {e.emoji} {e.nombre} · {TEXTO_ESTADO[e.estado]}
              </span>
            ))}
            {escena.coordinador === "escribe" && (
              <span className="rounded-full border border-violet-400/50 bg-violet-500/15 px-2 py-0.5 text-[11px] text-white backdrop-blur animate-pulse">
                🧠 integrando
              </span>
            )}
          </div>
        )}
      </div>

      {respuesta && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-primary/30 bg-background/85 shadow-2xl shadow-primary/20 backdrop-blur animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between gap-2 border-b border-primary/15 px-4 py-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                <Brain className={cn("h-3.5 w-3.5", pending && "animate-pulse")} />{respuesta.quien}
              </span>
              {!pending && canRemember && turn && <span className="text-muted-foreground"><SaveToMind turn={turn} conversationId={conversationId} /></span>}
            </div>
            <div className="max-h-[34vh] overflow-y-auto px-4 py-3 text-sm"><Markdown>{respuesta.texto}</Markdown></div>
          </div>
        </div>
      )}
    </div>
  );
}
