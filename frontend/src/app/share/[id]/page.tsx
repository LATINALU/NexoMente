"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Compass, Download, FileText, Globe, Loader2, Search, User } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { ConversationStorage } from "@/lib/conversationStorage";
import { treeToMessages } from "@/lib/chat";
import { SharedConversation, fetchShare, sharedToTree } from "@/lib/shares";

export default function SharedConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<SharedConversation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchShare(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  const importConversation = () => {
    if (!data) return;
    const tree = sharedToTree(data);
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();
    ConversationStorage.saveConversation({
      id: conversationId,
      title: data.title,
      messages: treeToMessages(tree),
      tree,
      createdAt: now,
      updatedAt: now,
      model: "",
      agents: [],
    });
    localStorage.setItem("nexo_current_conversation", conversationId);
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-primary/20 bg-card/80 backdrop-blur px-6 py-3 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-lg" />
          <span className="font-black text-lg bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Nexo</span>
        </a>
        {data && (
          <button onClick={importConversation}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">
            <Download className="h-4 w-4" />Copiar a mis conversaciones
          </button>
        )}
      </header>

      <main className="max-w-4xl mx-auto p-6">
        {error && (
          <div className="mt-20 text-center">
            <p className="text-lg font-semibold">{error}</p>
            <a href="/" className="text-primary text-sm hover:underline">Ir a Nexo</a>
          </div>
        )}
        {!data && !error && <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-primary" />}
        {data && (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-black">{data.title}</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Conversación compartida · solo lectura · {new Date(data.created_at * 1000).toLocaleString()} · {data.views} visitas
              </p>
            </div>
            {data.turns.map((turn, i) => (
              <section key={i} className="mb-10">
                <div className="flex gap-3 justify-end mb-5">
                  <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm whitespace-pre-wrap">{turn.question}</div>
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0"><User className="h-4 w-4 text-blue-400" /></div>
                </div>
                {turn.answers.map((a, j) => (
                  <div key={j} className={a.is_synthesis
                    ? "mb-5 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-cyan-500/5 p-5"
                    : a.is_review ? "mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4" : "mb-4 rounded-xl border border-border bg-muted/10 p-4"}>
                    <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
                      {a.is_synthesis ? <Compass className="h-5 w-5 text-primary" /> : a.is_review ? <Search className="h-4 w-4 text-amber-500" /> : <span className="text-lg">{a.emoji}</span>}
                      {a.name}
                    </div>
                    <Markdown>{a.content}</Markdown>
                  </div>
                ))}
                {turn.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {turn.sources.map((s) => s.url ? (
                      <a key={s.label} href={s.url} target="_blank" rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-xs hover:text-primary">
                        <Globe className="h-3 w-3" /><b>[{s.label}]</b> {s.title}
                      </a>
                    ) : (
                      <span key={s.label} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-xs">
                        <FileText className="h-3 w-3" /><b>[{s.label}]</b> {s.title}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            ))}
            <p className="text-center text-xs text-muted-foreground mt-12">
              Generado con <a href="/" className="text-primary hover:underline">Nexo</a> · Las respuestas de IA pueden contener errores.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
