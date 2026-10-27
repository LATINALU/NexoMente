"use client";

import { memo, useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb, Pencil, RotateCcw, User } from "lucide-react";
import type { Turn } from "@/lib/chat";
import { formatUSD } from "@/lib/pricing";
import type { RunState } from "@/core/runReducer";
import { Button } from "@/components/ui/button";
import { AnswerCard } from "./AnswerCard";
import { LiveRun } from "./LiveRun";
import { SourcesList } from "./SourcesList";
import { SaveToMind } from "@/features/mente/SaveToMind";
import { MAX_INPUT } from "../useChatSession";

interface TurnViewProps {
  turn: Turn;
  siblings: Turn[];
  isLast: boolean;
  isPending: boolean;
  processing: boolean;
  run: RunState | null;
  conversationId: string;
  /** La memoria (Neuromapa) está lista: se puede guardar la respuesta como nota */
  canRemember?: boolean;
  onEdit: (turnId: string, text: string) => void;
  onSwitchBranch: (turn: Turn, direction: -1 | 1) => void;
  onRegenerate: () => void;
  onFollowUp: (question: string, parentId: string) => void;
}

function TurnViewImpl({
  turn, siblings, isLast, isPending, processing, run, conversationId, canRemember, onEdit, onSwitchBranch, onRegenerate, onFollowUp,
}: TurnViewProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const position = siblings.findIndex((s) => s.id === turn.id);
  const hasSynthesis = turn.answers.some((a) => a.isSynthesis);

  const submit = () => {
    if (draft?.trim()) onEdit(turn.id, draft.slice(0, MAX_INPUT));
    setDraft(null);
  };

  return (
    <div>
      <div className="group flex gap-3 mb-6 justify-end animate-in fade-in-0 slide-in-from-bottom-2">
        <div className="flex flex-col items-end max-w-[85%] w-full">
          {draft !== null ? (
            <div className="w-full rounded-2xl border border-primary/40 bg-background p-3">
              <textarea
                autoFocus value={draft} maxLength={MAX_INPUT} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                  if (e.key === "Escape") { e.stopPropagation(); setDraft(null); }
                }}
                className="w-full min-h-[80px] bg-transparent text-sm resize-y focus:outline-none"
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
                <Button size="sm" onClick={submit} disabled={!draft.trim()}>Enviar como nueva rama</Button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl px-4 py-3 shadow-sm bg-gradient-to-r from-blue-600 to-blue-700 text-white">
              <p className="text-sm whitespace-pre-wrap">{turn.user.content}</p>
            </div>
          )}
          {draft === null && (
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              {siblings.length > 1 && (
                <span className="inline-flex items-center gap-0.5 mr-1" title="Versiones de esta pregunta">
                  <button onClick={() => onSwitchBranch(turn, -1)} disabled={position <= 0 || processing} className="p-0.5 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="font-mono">{position + 1}/{siblings.length}</span>
                  <button onClick={() => onSwitchBranch(turn, 1)} disabled={position >= siblings.length - 1 || processing} className="p-0.5 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
                </span>
              )}
              {!processing && (
                <button onClick={() => setDraft(turn.user.content)} title="Editar y crear una rama"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:text-primary">
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
          <User className="h-4 w-4 text-blue-400" />
        </div>
      </div>

      {turn.answers.map((a, i) => (
        <AnswerCard key={i} message={a} collapsed={hasSynthesis && !a.isSynthesis} conversationId={conversationId} />
      ))}

      {isPending && run && <LiveRun run={run} />}

      {turn.sources && <SourcesList sources={turn.sources} />}

      {isLast && !isPending && !processing && !!turn.followups?.length && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Lightbulb className="h-3.5 w-3.5 text-primary" />
          {turn.followups.map((q) => (
            <button key={q} onClick={() => onFollowUp(q, turn.id)}
              className="px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-xs hover:bg-primary/15 hover:border-primary transition-colors text-left">
              {q}
            </button>
          ))}
        </div>
      )}

      {!isPending && (turn.stats || isLast || canRemember) && (
        <div className="flex flex-wrap items-center justify-center gap-3 mb-8 text-xs text-muted-foreground">
          {turn.stats && (
            <span>
              ✅ {turn.stats.agents} agente{turn.stats.agents === 1 ? "" : "s"}
              {turn.stats.failed > 0 && ` · ⚠️ ${turn.stats.failed} con error`}
              {" · "}⏱️ {(turn.stats.elapsedMs / 1000).toFixed(1)} s
              {turn.stats.totalTokens > 0 && ` · ${turn.stats.totalTokens.toLocaleString()} tokens`}
              {turn.stats.cost != null && turn.stats.cost > 0 && ` · ${formatUSD(turn.stats.cost)}`}
            </span>
          )}
          {canRemember && turn.answers.length > 0 && <SaveToMind turn={turn} conversationId={conversationId} />}
          {isLast && !processing && (
            <button onClick={onRegenerate} className="inline-flex items-center gap-1 hover:text-primary transition-colors" title="Crear otra versión de esta respuesta">
              <RotateCcw className="h-3 w-3" />Regenerar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Los turnos pasados no se re-renderizan mientras otro turno hace streaming. */
export const TurnView = memo(TurnViewImpl);
