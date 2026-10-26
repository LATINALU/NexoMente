"use client";

import { useState } from "react";
import { Calculator, Check, Compass, Copy, ShieldCheck } from "lucide-react";
import type { ChatMessage } from "@/lib/chat";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { SpecializedAgentResponse } from "@/components/SpecializedAgentResponse";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
      title="Copiar"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const Interrupted = ({ show, label = "interrumpido" }: { show?: boolean; label?: string }) =>
  show ? <Badge variant="outline" className="text-[10px]">{label}</Badge> : null;

/** Una respuesta terminada: agente, cálculo, revisión crítica o síntesis. */
export function AnswerCard({ message, collapsed, conversationId }: { message: ChatMessage; collapsed: boolean; conversationId: string }) {
  if (message.isCalculation) {
    return (
      <details className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300" open={!collapsed}>
        <summary className="flex items-center justify-between gap-2 text-sm font-semibold text-emerald-500 cursor-pointer">
          <span className="flex items-center gap-2"><Calculator className="h-4 w-4" />{message.agentName || "Cálculo de costos"}</span>
          <CopyButton text={message.content} />
        </summary>
        <div className="mt-2 overflow-x-auto"><Markdown>{message.content}</Markdown></div>
      </details>
    );
  }
  if (message.isReview) {
    return (
      <details className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300" open={!collapsed}>
        <summary className="flex items-center gap-2 text-sm font-semibold text-amber-500 cursor-pointer">
          <ShieldCheck className="h-4 w-4" />Revisor crítico<Interrupted show={message.interrupted} />
        </summary>
        <div className="mt-2"><Markdown>{message.content}</Markdown></div>
      </details>
    );
  }
  if (message.isSynthesis) {
    return (
      <div className="mb-6 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-cyan-500/5 p-5 shadow-lg shadow-primary/10 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-primary/20">
          <div className="flex items-center gap-2 font-semibold text-primary">
            <Compass className="h-5 w-5" /> Respuesta integrada<Interrupted show={message.interrupted} label="interrumpida" />
          </div>
          <CopyButton text={message.content} />
        </div>
        <Markdown>{message.content}</Markdown>
      </div>
    );
  }
  if (message.agentResponse && !message.interrupted) {
    return (
      <div className="mb-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <SpecializedAgentResponse
          response={{
            ...message.agentResponse,
            agent_name: message.agentName || message.agentResponse.agent_name,
            agent_emoji: message.agentEmoji || message.agentResponse.agent_emoji,
            raw_content: message.content || message.agentResponse.raw_content,
          }}
          conversationId={conversationId}
          isExpanded={!collapsed}
        />
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-primary/20 bg-muted/20 p-4">
      <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
        <span className="text-xl">{message.agentEmoji || "🤖"}</span>
        {message.agentName || "Agente"}<Interrupted show={message.interrupted} />
      </div>
      <Markdown>{message.content}</Markdown>
    </div>
  );
}
