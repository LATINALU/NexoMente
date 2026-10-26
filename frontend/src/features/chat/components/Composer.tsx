"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FileText, Globe, Loader2, Paperclip, Send, Sparkles, Square, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/chat";
import { ACCEPTED_DOCUMENTS, DocumentRef, MAX_DOCUMENTS_PER_CHAT, formatBytes } from "@/lib/documents";
import { loadPrices } from "@/lib/pricing";
import { CoachAction, analyzeQuery, contextTemplate } from "@/intelligence/queryCoach";
import { estimateRun } from "@/intelligence/estimator";
import { useDebounced } from "@/hooks/useDebounced";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";
import { Button } from "@/components/ui/button";
import { CoachBar } from "./CoachBar";
import { EstimateBadge } from "./EstimateBadge";
import { RunOptionsMenu } from "./RunOptionsMenu";
import { MAX_INPUT } from "../useChatSession";

export interface ComposerHandle {
  focus: () => void;
  getText: () => string;
  setText: (text: string) => void;
}

interface ComposerProps {
  path: Turn[];
  attachments: DocumentRef[];
  uploading: number;
  processing: boolean;
  suggesting: boolean;
  webReady: boolean;
  ocrEnabled: boolean;
  notice: string | null;
  onDismissNotice: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onSuggest: (text: string) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (doc: DocumentRef) => void;
  onNeedWebConfig: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(props, ref) {
  const {
    path, attachments, uploading, processing, suggesting, webReady, ocrEnabled, notice,
    onDismissNotice, onSend, onStop, onSuggest, onAddFiles, onRemoveAttachment, onNeedWebConfig,
  } = props;
  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const options = useSettings((s) => s.runOptions);
  const setRunOptions = useSettings((s) => s.setRunOptions);
  const selectedAgents = useWorkspace((s) => s.selectedAgents);
  const model = useWorkspace((s) => s.model);
  const providerType = useWorkspace((s) => s.apiConfig.type);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    getText: () => input,
    setText: (text: string) => {
      setInput(text.slice(0, MAX_INPUT));
      setTimeout(() => inputRef.current?.focus(), 0);
    },
  }), [input]);

  // El análisis corre con debounce: no en cada tecla
  const debounced = useDebounced(input, 350);
  const tips = useMemo(
    () => analyzeQuery({
      text: debounced, attachments: attachments.length, webReady, webOn: options.webSearch, reviewOn: options.review,
      selectedAgents: selectedAgents.length, hasHistory: path.length > 0,
      localModel: providerType === "local", reasoning: options.reasoning,
    }).filter((t) => !dismissed.has(t.id)),
    [debounced, attachments.length, webReady, options.webSearch, options.review, selectedAgents.length, path.length, dismissed,
     providerType, options.reasoning],
  );
  const estimate = useMemo(() => {
    if (!debounced.trim()) return null;
    const historyChars = path.slice(-4).reduce((n, t) => n + t.user.content.length + t.answers.reduce((m, a) => m + Math.min(a.content.length, 700), 0), 0);
    return estimateRun({
      agents: selectedAgents.length, options, inputChars: debounced.length, historyChars, documents: attachments.length,
      webReady, previousTurns: path, price: loadPrices()[model],
    });
  }, [debounced, selectedAgents.length, options, attachments.length, webReady, path, model]);

  const send = () => {
    const text = input.trim();
    if (!text || processing || uploading > 0) return;
    setInput("");
    setDismissed(new Set());
    onSend(text);
  };

  const onCoachAction = (action: CoachAction) => {
    switch (action) {
      case "enable-web": setRunOptions({ webSearch: true }); break;
      case "configure-web": onNeedWebConfig(); break;
      case "attach": fileRef.current?.click(); break;
      case "suggest-team": onSuggest(input); break;
      case "enable-review": setRunOptions({ review: true }); break;
      case "reasoning-off": setRunOptions({ reasoning: "none" }); break;
      case "add-context":
        setInput(contextTemplate(input));
        setDismissed((d) => new Set(d).add("context"));
        setTimeout(() => inputRef.current?.focus(), 0);
        break;
    }
  };

  const toggleWeb = () => (webReady ? setRunOptions({ webSearch: !options.webSearch }) : onNeedWebConfig());

  return (
    <div
      className={cn("p-4 border-t border-primary/10 bg-background/95 backdrop-blur transition-colors", dragOver && "bg-primary/10")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) onAddFiles(e.dataTransfer.files); }}
    >
      <div className="max-w-5xl mx-auto">
        {notice && (
          <div className="flex items-start gap-2 mb-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /><span className="flex-1">{notice}</span>
            <button onClick={onDismissNotice}><X className="h-3 w-3" /></button>
          </div>
        )}

        {!processing && <CoachBar tips={tips} onAction={onCoachAction} />}

        {(attachments.length > 0 || uploading > 0 || (options.webSearch && webReady)) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((doc) => (
              <span key={doc.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-muted/30 text-xs max-w-xs">
                <FileText className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate">{doc.name}</span>
                {doc.ocr && <span className="px-1 rounded bg-primary/15 text-[10px] text-primary" title="Texto leído por OCR">OCR</span>}
                <span className="text-muted-foreground">{formatBytes(doc.size)}</span>
                <button onClick={() => onRemoveAttachment(doc)} disabled={processing} title="Quitar"><X className="h-3 w-3" /></button>
              </span>
            ))}
            {uploading > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />Procesando {uploading}…
              </span>
            )}
            {options.webSearch && webReady && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/5 text-xs text-cyan-400">
                <Globe className="h-3 w-3" />Búsqueda web activa
              </span>
            )}
          </div>
        )}

        <div className="relative flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              maxLength={MAX_INPUT}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder={processing ? "Los agentes están trabajando…" : "Describe tu tarea… (Enter envía · arrastra archivos aquí · Ctrl+K comandos)"}
              className="w-full min-h-[60px] max-h-[200px] p-4 pb-6 rounded-xl bg-background border border-primary/20 focus:border-primary focus:ring-1 focus:ring-primary/50 resize-none text-sm"
              disabled={processing}
            />
            <div className="absolute left-4 right-3 bottom-1.5 flex items-center justify-between gap-2 pointer-events-none">
              <span className="pointer-events-auto">{!processing && <EstimateBadge estimate={estimate} />}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{input.length}/{MAX_INPUT}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1">
            <input ref={fileRef} type="file" multiple accept={ACCEPTED_DOCUMENTS} className="hidden"
              onChange={(e) => { if (e.target.files?.length) onAddFiles(e.target.files); e.target.value = ""; }} />
            <Button variant="outline" size="sm" className="h-[28px] w-[34px] px-0"
              title={ocrEnabled ? "Adjuntar documentos o imágenes (PDF, DOCX, TXT, PNG, JPG…)" : "Adjuntar documentos (PDF, DOCX, TXT, MD, CSV…)"}
              onClick={() => fileRef.current?.click()} disabled={processing || attachments.length >= MAX_DOCUMENTS_PER_CHAT}>
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={toggleWeb}
              title={webReady ? "Buscar en la web" : "Configura un buscador en Ajustes → Búsqueda web"}
              className={cn("h-[28px] w-[34px] px-0", options.webSearch && webReady && "border-cyan-500/60 text-cyan-400 bg-cyan-500/10")}>
              <Globe className="h-3.5 w-3.5" />
            </Button>
            <RunOptionsMenu options={options} onChange={setRunOptions} />
            <Button variant="outline" size="sm" className="h-[28px] w-[34px] px-0 text-primary" onClick={() => onSuggest(input)}
              disabled={suggesting || processing} title="Sugerir agentes para esta consulta">
              {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {processing ? (
            <Button onClick={onStop} title="Detener (Esc)" className="h-[60px] w-[60px] rounded-xl bg-red-500/90 hover:bg-red-500 text-white">
              <Square className="h-5 w-5 fill-current" />
            </Button>
          ) : (
            <Button onClick={send} disabled={!input.trim() || uploading > 0} title="Enviar"
              className="h-[60px] w-[60px] rounded-xl shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground">
              <Send className="h-6 w-6 ml-0.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
