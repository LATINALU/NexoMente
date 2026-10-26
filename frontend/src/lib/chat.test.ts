import { describe, expect, it } from "vitest";
import {
  ChatMessage, ConversationTree, Turn, activePath, addTurn, buildHistory, conversationToMarkdown, emptyTree,
  latestLeaf, messagesToTree, reviveTree, siblingsOf, slugify, treeToMessages, updateTurn,
} from "./chat";

let clock = 0;
const user = (content: string): ChatMessage => ({ role: "user", content, timestamp: new Date(2026, 0, 1, 0, 0, clock++) });
const agent = (content: string, name = "SEO"): ChatMessage => ({ role: "agent", content, timestamp: new Date(), agentName: name });
const synth = (content: string): ChatMessage => ({ role: "assistant", content, timestamp: new Date(), isSynthesis: true });

function turn(id: string, parentId: string | null, text: string, answers: ChatMessage[] = []): Turn {
  return { id, parentId, user: user(text), answers, createdAt: new Date(2026, 0, 1, 0, 0, clock++).toISOString() };
}

/** a → b → c   y una rama b' (hermana de b) → d */
function branchedTree(): ConversationTree {
  let t = emptyTree();
  t = addTurn(t, turn("a", null, "hola", [agent("r-a")]));
  t = addTurn(t, turn("b", "a", "pregunta 2", [agent("r-b"), synth("s-b")]));
  t = addTurn(t, turn("c", "b", "pregunta 3", [agent("r-c")]));
  t = addTurn(t, turn("b2", "a", "pregunta 2 editada", [agent("r-b2")]));
  t = addTurn(t, turn("d", "b2", "seguimiento", [agent("r-d")]));
  return t;
}

describe("árbol de turnos", () => {
  it("el camino activo va de la raíz a la hoja", () => {
    const t = branchedTree();
    expect(activePath(t).map((x) => x.id)).toEqual(["a", "b2", "d"]);
    expect(activePath(t, "c").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("los hermanos comparten padre y se ordenan por creación", () => {
    const t = branchedTree();
    expect(siblingsOf(t, t.turns.b2).map((x) => x.id)).toEqual(["b", "b2"]);
    expect(siblingsOf(t, t.turns.a).map((x) => x.id)).toEqual(["a"]);
  });

  it("al cambiar de rama se baja hasta la hoja más reciente", () => {
    const t = branchedTree();
    expect(latestLeaf(t, "b")).toBe("c");
    expect(latestLeaf(t, "a")).toBe("d");
  });

  it("updateTurn es inmutable", () => {
    const t = branchedTree();
    const next = updateTurn(t, "c", (x) => ({ ...x, answers: [...x.answers, agent("extra")] }));
    expect(next.turns.c.answers).toHaveLength(2);
    expect(t.turns.c.answers).toHaveLength(1);
    expect(updateTurn(t, "nope", (x) => x)).toBe(t);
  });

  it("serializa y reconstruye todas las ramas y la hoja activa", () => {
    const t = branchedTree();
    const back = messagesToTree(JSON.parse(JSON.stringify(treeToMessages(t))));
    expect(Object.keys(back.turns).sort()).toEqual(Object.keys(t.turns).sort());
    expect(back.leafId).toBe("d");
    expect(back.turns.b.answers.map((m) => m.isSynthesis)).toEqual([false, true]);
    expect(back.turns.b.answers[0].role).toBe("agent");
  });

  it("lee el formato viejo (sin metadata) como una sola rama", () => {
    const legacy = [
      { role: "user", content: "q1", timestamp: "2026-01-01T00:00:00Z" },
      { role: "agent", content: "a1", timestamp: "2026-01-01T00:00:01Z" },
      { role: "user", content: "q2", timestamp: "2026-01-01T00:00:02Z" },
      { role: "assistant", content: "s2", timestamp: "2026-01-01T00:00:03Z", agent_id: "coordinator" },
    ] as any;
    const tree = messagesToTree(legacy);
    const path = activePath(tree);
    expect(path.map((x) => x.user.content)).toEqual(["q1", "q2"]);
    expect(path[1].answers[0].isSynthesis).toBe(true);
  });
});

describe("árbol guardado en JSON", () => {
  it("al recargarlo las fechas vuelven a ser Date y se puede volver a guardar", () => {
    const fromJson = JSON.parse(JSON.stringify(branchedTree()));
    expect(() => treeToMessages(fromJson)).not.toThrow(); // storeMessage tolera texto
    const revived = reviveTree(fromJson);
    expect(revived.turns.b.user.timestamp).toBeInstanceOf(Date);
    expect(revived.turns.b.answers[1].timestamp).toBeInstanceOf(Date);
    expect(activePath(revived).map((x) => x.id)).toEqual(["a", "b2", "d"]);
  });
});

describe("historial y exportación", () => {
  it("usa la síntesis si existe y si no un extracto por agente", () => {
    const t = branchedTree();
    const h = buildHistory(activePath(t, "c"));
    expect(h).toEqual([
      { role: "user", content: "hola" }, { role: "assistant", content: "[SEO] r-a" },
      { role: "user", content: "pregunta 2" }, { role: "assistant", content: "s-b" },
      { role: "user", content: "pregunta 3" }, { role: "assistant", content: "[SEO] r-c" },
    ]);
  });

  it("exporta el camino activo con fuentes", () => {
    let t = branchedTree();
    t = updateTurn(t, "d", (x) => ({ ...x, sources: [{ label: "W1", kind: "web", title: "Fuente", url: "https://x.com" }] }));
    const md = conversationToMarkdown("Título", activePath(t));
    expect(md).toContain("pregunta 2 editada");
    expect(md).not.toContain("pregunta 3");
    expect(md).toContain("[W1] [Fuente](https://x.com)");
  });

  it("slugify genera nombres de archivo seguros", () => {
    expect(slugify("¿Cómo lanzo mi SaaS B2B?")).toBe("como-lanzo-mi-saas-b2b");
    expect(slugify("???")).toBe("conversacion");
  });
});
