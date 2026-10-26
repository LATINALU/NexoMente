"use client";

/**
 * Markdown de Nexo: GFM (tablas, listas de tareas), bloques de código con botón de
 * copiar y diagramas ```mermaid renderizados (Mermaid se carga solo si hace falta).
 * El HTML crudo del modelo no se interpreta (react-markdown lo escapa).
 */

import { Children, Fragment, ReactNode, memo, useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      const dark = document.documentElement.classList.contains("dark") ||
        window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export function MermaidDiagram({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Durante el streaming el diagrama llega incompleto: esperar a que se estabilice
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        await mermaid.parse(code);
        const { svg } = await mermaid.render(`mmd${id}`, code);
        if (!cancelled) {
          setSvg(svg);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id]);

  if (failed || !svg) {
    return <CodeBlock language="mermaid" code={code} note={failed ? "Diagrama inválido o incompleto" : "Generando diagrama…"} />;
  }
  return (
    <div className="my-3 rounded-lg border border-border bg-background p-3 overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full"
      // SVG generado por Mermaid con securityLevel "strict" (sin scripts ni HTML del usuario)
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

export function CodeBlock({ language, code, note }: { language?: string; code: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden not-prose">
      <div className="flex items-center justify-between px-3 py-1 bg-muted/50 text-[11px] text-muted-foreground">
        <span className="font-mono">{language || "código"}{note ? ` · ${note}` : ""}</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 hover:text-primary"
          title="Copiar código"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="m-0 p-3 overflow-x-auto bg-black/40 text-xs leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

// Los modelos usan <br> para saltos dentro de celdas de tabla. El HTML crudo no se
// interpreta (seguridad), así que solo ese caso se convierte en un salto real.
const BR = /<br\s*\/?>/gi;

function withLineBreaks(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string" || !BR.test(child)) return child;
    BR.lastIndex = 0;
    const parts = child.split(BR);
    return parts.map((part, i) => <Fragment key={i}>{part}{i < parts.length - 1 && <br />}</Fragment>);
  });
}

function MarkdownImpl({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none prose-table:text-xs prose-th:px-2 prose-td:px-2", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: cls, children: content, ...props }) {
            const language = /language-([\w-]+)/.exec(cls || "")?.[1];
            const text = String(content ?? "").replace(/\n$/, "");
            const isBlock = !!language || text.includes("\n");
            if (!isBlock) return <code className={cls} {...props}>{content}</code>;
            if (language === "mermaid") return <MermaidDiagram code={text} />;
            return <CodeBlock language={language} code={text} />;
          },
          pre({ children: inner }) {
            return <>{inner}</>;
          },
          td({ children: inner, node: _node, ...props }) {
            return <td {...props}>{withLineBreaks(inner)}</td>;
          },
          th({ children: inner, node: _node, ...props }) {
            return <th {...props}>{withLineBreaks(inner)}</th>;
          },
          li({ children: inner, node: _node, ...props }) {
            return <li {...props}>{withLineBreaks(inner)}</li>;
          },
          p({ children: inner, node: _node, ...props }) {
            return <p {...props}>{withLineBreaks(inner)}</p>;
          },
          a({ href, children: label }) {
            const safe = href && /^(https?:|mailto:)/i.test(href) ? href : undefined;
            return <a href={safe} target="_blank" rel="noreferrer noopener">{label}</a>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
