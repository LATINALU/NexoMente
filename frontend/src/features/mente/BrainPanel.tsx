"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Brain, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MenteSalud, menteMapa, menteSalud } from "@/lib/mente";

/**
 * El cerebro de NexoMente: el mapa 3D en vivo de Neuromapa (tus notas y lo que leen los agentes)
 * y el resumen del médico. El mapa corre en su propio servidor local; acá va incrustado.
 */
export function BrainPanel({ onClose, className }: { onClose: () => void; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [salud, setSalud] = useState<MenteSalud | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [direccion, resumen] = await Promise.all([menteMapa(), menteSalud().catch(() => null)]);
      setUrl(direccion);
      setSalud(resumen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el cerebro");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // La entrada del mapa es de un solo uso: para otra pestaña se pide una nueva
  const abrirAparte = async () => {
    try {
      window.open(await menteMapa(), "_blank", "noopener");
    } catch {
      /* el error ya se ve en el panel si el mapa no está disponible */
    }
  };

  const problemas = salud ? salud.hallazgos.peligro + salud.hallazgos.aviso : 0;

  return (
    <div className={cn("flex h-full flex-col border-l border-primary/10 bg-card animate-in fade-in slide-in-from-right-4 duration-300", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-primary/10 px-3 py-2">
        <div className="flex items-center gap-2 font-semibold text-primary">
          <Brain className="h-4 w-4" />Cerebro
          {salud && <span className="text-xs font-normal text-muted-foreground">{salud.notas} notas</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={cargar} title="Recargar" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} />
          </button>
          <button onClick={abrirAparte} title="Abrir en otra pestaña" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} title="Cerrar" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {problemas > 0 && salud && (
        <details className="border-b border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5" />El médico encontró {problemas} {problemas === 1 ? "problema" : "problemas"} en tus notas
          </summary>
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            {salud.destacados.map((d, i) => (
              <li key={i}><span className="font-mono text-[10px] text-foreground/70">{d.nota.split("/").pop()}:{d.linea}</span> — {d.texto}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="relative flex-1 bg-black">
        {cargando && !url && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Despertando el cerebro…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            <Brain className="h-8 w-8 opacity-40" />
            <p>{error}</p>
            <button onClick={cargar} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary">Reintentar</button>
          </div>
        )}
        {url && !error && (
          <iframe key={url} src={url} title="Cerebro de NexoMente" className="h-full w-full border-0"
            // El mapa solo necesita sus propios scripts: sin formularios, ventanas ni navegación del padre
            sandbox="allow-scripts allow-same-origin" />
        )}
      </div>
    </div>
  );
}
