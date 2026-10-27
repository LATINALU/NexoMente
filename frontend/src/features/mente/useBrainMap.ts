"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { menteMapa } from "@/lib/mente";
import type { Escena } from "./escena";

/**
 * El mapa de Neuromapa en un marco, sin sus paneles (`cine`), con la capa de NexoMente (`nexo`).
 * Corre en su servidor local (otro origen): se le manda la escena por postMessage cada vez que cambia,
 * y otra vez cuando avisa que ya escucha (tarda en cargar las notas).
 */
export function useBrainMap(escena: Escena): {
  url: string | null; error: string | null; cargar: () => void; marco: RefObject<HTMLIFrameElement>; enviar: () => void;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const marco = useRef<HTMLIFrameElement>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setUrl(`${await menteMapa()}&cine&nexo`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el cerebro");
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

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

  useEffect(() => {
    const oir = (ev: MessageEvent) => {
      if (ev.source === marco.current?.contentWindow && ev.data?.nexo === "listo") enviar();
    };
    window.addEventListener("message", oir);
    return () => window.removeEventListener("message", oir);
  }, [enviar]);

  return { url, error, cargar, marco, enviar };
}
