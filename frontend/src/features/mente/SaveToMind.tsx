"use client";

import { useState } from "react";
import { BrainCircuit, Check, Loader2 } from "lucide-react";
import type { Turn } from "@/lib/chat";
import { menteGuardar } from "@/lib/mente";
import { notaDeTurno } from "./notaDeTurno";

type Estado = { tipo: "listo" } | { tipo: "guardando" } | { tipo: "guardada"; nueva: boolean } | { tipo: "error"; texto: string };

/** "Recordar": guarda la respuesta del turno como nota de NexoMente (aparece en el cerebro, enlazada a sus [N#]). */
export function SaveToMind({ turn, conversationId }: { turn: Turn; conversationId: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "listo" });
  const nota = notaDeTurno(turn);
  if (!nota) return null;

  const guardar = async () => {
    setEstado({ tipo: "guardando" });
    try {
      const hecho = await menteGuardar({ ...nota, conversacion: conversationId });
      setEstado({ tipo: "guardada", nueva: hecho.nueva });
    } catch (e) {
      setEstado({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo guardar" });
    }
  };

  if (estado.tipo === "guardada") {
    return (
      <span className="inline-flex items-center gap-1 text-primary" title="Está en tu memoria: los agentes la pueden citar como [N#]">
        <Check className="h-3 w-3" />{estado.nueva ? "Guardada en la mente" : "Ya estaba en la mente"}
      </span>
    );
  }
  return (
    <button onClick={guardar} disabled={estado.tipo === "guardando"}
      className="inline-flex items-center gap-1 hover:text-primary transition-colors disabled:opacity-60"
      title={estado.tipo === "error" ? estado.texto : "Guardar esta respuesta como nota en tu memoria (Neuromapa)"}>
      {estado.tipo === "guardando" ? <Loader2 className="h-3 w-3 animate-spin" /> : <BrainCircuit className="h-3 w-3" />}
      {estado.tipo === "error" ? "Reintentar guardar" : "Recordar"}
    </button>
  );
}
