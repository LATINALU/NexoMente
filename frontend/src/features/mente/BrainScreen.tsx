"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUp, Brain, ChevronUp, Loader2, MessageSquare, Minus, Plus, Square, X } from "lucide-react";
import type { Turn } from "@/lib/chat";
import type { RunState } from "@/core/runReducer";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { useWorkspace } from "@/stores/workspace";
import { progressPercent } from "@/features/chat/components/RunProgress";
import { MAX_INPUT } from "@/features/chat/useChatSession";
import { CategoryDock } from "./CategoryDock";
import { escenaDe } from "./escena";
import { faseDe, hayRespuesta, TEXTO_FASE } from "./fase";
import { SaveToMind } from "./SaveToMind";
import { useBrainMap } from "./useBrainMap";

interface BrainScreenProps {
  /** La última consulta del camino */
  turn?: Turn;
  run: RunState | null;
  pending: boolean;
  processing: boolean;
  conversationId: string;
  canRemember: boolean;
  error: string | null;
  notice: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onNew: () => void;
  onDismiss: () => void;
  onExit: () => void;
}

/**
 * Modo Cerebro: una sola pantalla. El cerebro de fondo; abajo las categorías y la caja para preguntar;
 * mientras piensa, el borde late y arriba dice en qué anda; la respuesta salta en un recuadro.
 */
export function BrainScreen(props: BrainScreenProps) {
  const { turn, run, pending, processing, conversationId, canRemember, error, notice } = props;
  const escena = escenaDe(turn, run, pending);
  const { url, error: errorMapa, cargar, marco, enviar } = useBrainMap(escena);
  const selected = useWorkspace((s) => s.selectedAgents);
  const [texto, setTexto] = useState("");
  const caja = useRef<HTMLTextAreaElement>(null);

  const fase = faseDe(pending ? run : null);
  const pensando = fase !== "quieto";
  const sinSintesis = !!run && !run.plan.synthesis;
  const terminada = !!turn && !pending && turn.answers.length > 0;
  const respuestaLista = hayRespuesta(fase, terminada, sinSintesis);

  // El recuadro salta solo cuando hay respuesta de esta consulta; se puede minimizar
  const [abierta, setAbierta] = useState(true);
  const turnoVisto = useRef(turn?.id);
  useEffect(() => {
    if (turn?.id !== turnoVisto.current) { turnoVisto.current = turn?.id; setAbierta(true); }
  }, [turn?.id]);

  const enviarPregunta = () => {
    const t = texto.trim();
    if (!t || processing) return;
    props.onSend(t.slice(0, MAX_INPUT));
    setTexto("");
  };

  // Escape: minimiza la respuesta, o sale del modo
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (respuestaLista && abierta) setAbierta(false);
      else props.onExit();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [respuestaLista, abierta, props]);

  const respuesta = (() => {
    if (!turn) return null;
    if (pending && run) {
      if (run.synthesis !== null) return run.synthesis;
      const escribiendo = run.order.map((id) => run.agents[id]).filter((a) => a?.text);
      const hechas = turn.answers.filter((a) => !a.isReview && a.content.trim());
      const partes = [...hechas.map((a) => [a.agentEmoji, a.agentName, a.content] as const),
                      ...escribiendo.map((a) => [a!.emoji, a!.name, a!.text] as const)];
      return partes.map(([e, n, c]) => `**${e || "🤖"} ${n || "Experto"}**\n\n${c}`).join("\n\n---\n\n") || null;
    }
    const sintesis = turn.answers.find((a) => a.isSynthesis && !a.interrupted);
    if (sintesis) return sintesis.content;
    const agentes = turn.answers.filter((a) => !a.isReview && a.content.trim());
    return agentes.map((a) => `**${a.agentEmoji || "🤖"} ${a.agentName || "Experto"}**\n\n${a.content}`).join("\n\n---\n\n") || null;
  })();

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-black text-white animate-in fade-in duration-300">
      {url && !errorMapa && (
        <iframe ref={marco} key={url} src={url} title="Cerebro de NexoMente" onLoad={enviar}
          className="absolute inset-0 h-full w-full border-0" sandbox="allow-scripts allow-same-origin" />
      )}
      {!url && !errorMapa && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />Despertando el cerebro…
        </div>
      )}
      {errorMapa && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/60">
          <Brain className="h-8 w-8 opacity-40" /><p>{errorMapa}</p>
          <button onClick={cargar} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:border-primary hover:text-primary">Reintentar</button>
        </div>
      )}

      {/* Pensando: el borde de la pantalla late y una barra avanza arriba */}
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 transition-opacity duration-700", pensando ? "opacity-100" : "opacity-0")}>
        <div className="absolute inset-0 animate-pulse shadow-[inset_0_0_120px_30px_rgba(139,92,246,0.35)]" />
        {run && pending && (
          <div className="absolute inset-x-0 top-0 h-0.5 bg-white/5">
            <div className="h-full bg-gradient-to-r from-violet-500 via-sky-400 to-violet-500 transition-[width] duration-700"
              style={{ width: `${progressPercent(run)}%` }} />
          </div>
        )}
      </div>

      {/* Arriba: marca, pregunta y en qué anda */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-sm font-semibold backdrop-blur">
          <Brain className="h-4 w-4 text-primary" />NexoMente
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
          {turn && (
            <p className="max-w-2xl rounded-2xl border border-white/10 bg-black/55 px-4 py-2 text-center text-sm text-white/90 shadow-lg backdrop-blur line-clamp-2 animate-in fade-in slide-in-from-top-2">
              “{turn.user.content}”
            </p>
          )}
          {pensando && (
            <div className="flex flex-col items-center gap-1.5 animate-in fade-in zoom-in-95">
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/20 px-4 py-1.5 text-sm font-medium shadow-lg shadow-violet-500/20 backdrop-blur">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-300 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-300" />
                </span>
                {TEXTO_FASE[fase]}<Puntos />
              </span>
              {escena.expertos.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1">
                  {escena.expertos.map((e) => (
                    <span key={e.id} title={e.nombre} className={cn("rounded-full border px-1.5 py-0.5 text-sm backdrop-blur transition-all",
                      e.estado === "escribe" || e.estado === "piensa" ? "scale-110 border-violet-300/60 bg-violet-500/25" :
                      e.estado === "listo" ? "border-emerald-400/40 bg-emerald-500/15" :
                      e.estado === "error" ? "border-red-400/40 bg-red-500/15" : "border-white/10 bg-black/40 opacity-60")}>
                      {e.emoji}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={props.onNew} disabled={processing} title="Nueva conversación"
            className="rounded-full border border-white/10 bg-black/50 p-2 text-white/75 backdrop-blur hover:text-white disabled:opacity-40">
            <Plus className="h-4 w-4" />
          </button>
          <button onClick={props.onExit} title="Volver a la conversación (Esc)"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white/80 backdrop-blur hover:text-white">
            <MessageSquare className="h-3.5 w-3.5" />Conversación
          </button>
        </div>
      </div>

      {/* La respuesta salta desde abajo */}
      {respuestaLista && respuesta && abierta && (
        <div className="absolute inset-x-0 bottom-40 z-20 flex justify-center px-4 sm:bottom-44">
          <div className="w-full max-w-3xl rounded-2xl border border-primary/40 bg-zinc-950/90 shadow-2xl shadow-violet-500/25 backdrop-blur-md animate-in fade-in zoom-in-95 slide-in-from-bottom-8 duration-500">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                <Brain className={cn("h-3.5 w-3.5", pending && "animate-pulse")} />
                {pending ? (fase === "responde" ? "El cerebro está respondiendo" : "Los expertos responden") : "Respuesta del cerebro"}
              </span>
              <span className="flex items-center gap-2 text-white/60">
                {!pending && canRemember && turn && <SaveToMind turn={turn} conversationId={conversationId} />}
                <button onClick={() => setAbierta(false)} title="Minimizar (Esc)" className="rounded p-1 hover:bg-white/10 hover:text-white"><Minus className="h-3.5 w-3.5" /></button>
              </span>
            </div>
            <div className="max-h-[45vh] overflow-y-auto px-5 py-4 text-sm leading-relaxed">
              <Markdown>{respuesta}</Markdown>
              {pending && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />}
            </div>
          </div>
        </div>
      )}
      {respuestaLista && respuesta && !abierta && (
        <button onClick={() => setAbierta(true)}
          className="absolute bottom-44 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-primary/40 bg-black/70 px-4 py-2 text-xs font-semibold text-primary shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <ChevronUp className="h-3.5 w-3.5" />Ver la respuesta
        </button>
      )}

      {/* Abajo: avisos, categorías y la caja para preguntar */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center p-4">
        <div className="flex w-full max-w-3xl flex-col gap-2">
          {(error || notice) && (
            <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-xs backdrop-blur",
              error ? "border-red-500/40 bg-red-950/70 text-red-200" : "border-white/10 bg-black/60 text-white/80")}>
              {error && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span className="flex-1">{error || notice}</span>
              <button onClick={props.onDismiss}><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <CategoryDock disabled={processing} />
          <div className={cn("flex items-end gap-2 rounded-2xl border bg-black/60 p-2 shadow-2xl backdrop-blur-md transition-colors",
            pensando ? "border-violet-400/50 shadow-violet-500/20" : "border-white/15 focus-within:border-primary/60")}>
            <textarea ref={caja} value={texto} rows={1} maxLength={MAX_INPUT} disabled={processing}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarPregunta(); } }}
              placeholder={processing ? "El cerebro está pensando…" : selected.length ? "Preguntale al cerebro…" : "Elegí una categoría y preguntale al cerebro…"}
              className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none disabled:opacity-60" />
            {processing ? (
              <button onClick={props.onStop} title="Detener"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/80 text-white hover:bg-red-500">
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button onClick={enviarPregunta} disabled={!texto.trim()} title="Enviar (Enter)"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-30">
                <ArrowUp className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Puntos() {
  return (
    <span className="inline-flex w-4 justify-start" aria-hidden>
      <span className="animate-bounce [animation-delay:-0.3s]">.</span>
      <span className="animate-bounce [animation-delay:-0.15s]">.</span>
      <span className="animate-bounce">.</span>
    </span>
  );
}
