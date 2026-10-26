"use client";

import { useEffect, useRef } from "react";

/**
 * Título de la pestaña según la ejecución: "⏳ Trabajando…" mientras corre y
 * "✅ Respuesta lista" si terminó con la pestaña en segundo plano (hasta volver a ella).
 */
export function useRunTitle(processing: boolean) {
  const base = useRef<string | null>(null);
  const wasProcessing = useRef(false);

  useEffect(() => {
    if (base.current === null) base.current = document.title;
    const original = base.current;
    if (processing) {
      document.title = `⏳ Trabajando… · ${original}`;
    } else if (wasProcessing.current && document.hidden) {
      document.title = `✅ Respuesta lista · ${original}`;
    } else {
      document.title = original;
    }
    wasProcessing.current = processing;
  }, [processing]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && base.current && document.title.startsWith("✅")) document.title = base.current;
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
