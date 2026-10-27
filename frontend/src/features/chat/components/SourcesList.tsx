import { Brain, FileText, Globe } from "lucide-react";
import type { Source } from "@/lib/chat";

export function SourcesList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <div className="mb-6 rounded-xl border border-border/60 bg-muted/10 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Fuentes</div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) =>
          s.kind === "note" ? (
            <span key={s.label} title={s.path ? `${s.path}:${s.line ?? 1}` : undefined}
              className="inline-flex items-center gap-1 max-w-xs px-2 py-1 rounded-md border border-primary/30 bg-primary/5 text-xs">
              <Brain className="h-3 w-3 shrink-0 text-primary" /><b>[{s.label}]</b><span className="truncate">{s.title}</span>
            </span>
          ) : s.kind === "web" && s.url ? (
            <a key={s.label} href={s.url} target="_blank" rel="noreferrer noopener"
              className="inline-flex items-center gap-1 max-w-xs px-2 py-1 rounded-md border border-border bg-background text-xs hover:border-primary hover:text-primary">
              <Globe className="h-3 w-3 shrink-0" /><b>[{s.label}]</b><span className="truncate">{s.title}</span>
            </a>
          ) : (
            <span key={s.label} className="inline-flex items-center gap-1 max-w-xs px-2 py-1 rounded-md border border-border bg-background text-xs">
              <FileText className="h-3 w-3 shrink-0" /><b>[{s.label}]</b><span className="truncate">{s.title}</span>
              {s.chunk && <span className="text-muted-foreground">· frag. {s.chunk}</span>}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
