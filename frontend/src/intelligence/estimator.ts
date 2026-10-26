/**
 * Estimación previa de una ejecución: llamadas al modelo, rango de tokens y costo.
 * Usa un modelo simple del orquestador y, si hay historial, se calibra con los
 * tokens reales de turnos anteriores (por agente).
 */

import type { RunOptions, Turn } from "@/lib/chat";
import { ModelPrice } from "@/lib/pricing";

export interface RunEstimate {
  calls: number;
  tokensLow: number;
  tokensHigh: number;
  costLow: number | null;
  costHigh: number | null;
  calibrated: boolean;
  breakdown: string[];
}

export interface EstimateInput {
  agents: number;
  options: RunOptions;
  inputChars: number;
  historyChars: number;
  documents: number;
  webReady: boolean;
  previousTurns: Turn[];
  price?: ModelPrice;
}

// Supuestos (orquestador): ver tokens_per_agent y los prompts de backend/app/services/orchestrator.py
const SYSTEM_PROMPT_TOKENS = 1100;
const DOC_CONTEXT_TOKENS = 1750;
const WEB_CONTEXT_TOKENS = 1400;
const charsToTokens = (c: number) => Math.ceil(c / 4);
const outputBudget = (agents: number) => (agents <= 1 ? 3000 : agents <= 3 ? 2048 : 1500);

export function estimateRun(input: EstimateInput): RunEstimate | null {
  const { agents, options } = input;
  if (agents <= 0) return null;
  const web = options.webSearch && input.webReady;
  const synthesize = options.synthesize && (agents > 1 || options.review);
  const breakdown: string[] = [`${agents} agente${agents === 1 ? "" : "s"}`];

  const context = (input.documents ? DOC_CONTEXT_TOKENS : 0) + (web ? WEB_CONTEXT_TOKENS : 0);
  const perAgentIn = SYSTEM_PROMPT_TOKENS + charsToTokens(input.inputChars + input.historyChars) + context;
  const perAgentOut = outputBudget(agents);
  let low = agents * (perAgentIn + perAgentOut * 0.35);
  let high = agents * (perAgentIn + perAgentOut * 0.85);
  let calls = agents;

  if (web && options.toolMode === "prefetch") {
    calls += 1;
    low += 400;
    high += 600;
    breakdown.push("búsqueda web");
  } else if (web || input.documents) {
    if (options.toolMode === "native") breakdown.push("herramientas nativas");
  }
  if (options.review) {
    calls += 1;
    const reviewIn = 600 + agents * perAgentOut * 0.6;
    low += reviewIn + 300;
    high += reviewIn + 1000;
    breakdown.push("revisión");
  }
  if (synthesize) {
    calls += 1;
    const synthIn = 700 + Math.min(agents * perAgentOut * 0.6, 3500);
    low += synthIn + 800;
    high += synthIn + 2200;
    breakdown.push("síntesis");
  }
  if (options.followups) {
    calls += 1;
    low += 700;
    high += 1000;
  }
  // Los modelos que piensan cobran el razonamiento como tokens de salida
  if (options.reasoning === "high") {
    high *= 1.6;
    breakdown.push("razonamiento alto");
  }

  // Calibración: tokens reales por agente en turnos anteriores con opciones similares
  const samples = input.previousTurns
    .map((t) => t.stats)
    .filter((s): s is NonNullable<typeof s> => !!s && s.totalTokens > 0 && s.agents > 0)
    .slice(-5);
  let calibrated = false;
  if (samples.length) {
    const perAgent = samples.reduce((acc, s) => acc + s.totalTokens / s.agents, 0) / samples.length;
    const observed = perAgent * agents;
    low = (low + observed * 0.8) / 2;
    high = (high + observed * 1.25) / 2;
    calibrated = true;
  }

  const cost = (tokens: number) => {
    if (!input.price) return null;
    // ~70 % entrada / 30 % salida en este tipo de flujos
    return (tokens * 0.7 * input.price.input + tokens * 0.3 * input.price.output) / 1_000_000;
  };
  return {
    calls,
    tokensLow: Math.round(low),
    tokensHigh: Math.round(Math.max(high, low)),
    costLow: cost(low),
    costHigh: cost(Math.max(high, low)),
    calibrated,
    breakdown,
  };
}

export const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`);
