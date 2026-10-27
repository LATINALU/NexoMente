"""
Nexo - Orquestador multi-agente
==============================
Ejecuta los agentes seleccionados sobre una consulta y emite eventos en vivo.

Modos:
  - parallel   (default): todos los agentes trabajan a la vez sobre la consulta.
  - sequential: cada agente recibe un resumen de lo que dijeron los anteriores.

Si hay más de un agente, un Coordinador final sintetiza una respuesta integrada
(patrón manager-worker). Opcionalmente, un Revisor crítico analiza los aportes
antes de la síntesis (errores, contradicciones, vacíos, afirmaciones sin fuente)
y el Coordinador corrige en consecuencia. Al final se sugieren preguntas de
seguimiento. Toda la salida se transmite token a token.

Contexto (opcional), en uno de dos modos:
  - prefetch (default): antes de los agentes se recuperan fragmentos de los documentos
    (BM25, + embeddings si hay) y, si está activa, se hace la búsqueda web. Todos reciben
    las mismas fuentes [D#]/[W#]. Funciona con cualquier modelo.
  - native: cada agente recibe herramientas (buscar_documentos, buscar_web) y decide
    cuándo usarlas (function calling). Si el modelo no las soporta, se cae a prefetch.

Eventos emitidos (dict con "type"):
  pipeline_start, research_start, research_queries, context_ready, warning, tool_call, thinking,
  agent_start, agent_token, agent_response, agent_error,
  review_start, review_token, review_complete,
  synthesis_start, synthesis_token, synthesis_complete, followups, pipeline_complete
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from app.agents.catalog import FORMAT_HINTS, AgentSpec
from app.formatters.human_formatter import HumanResponseFormatter
from app.services import ml_costs, web_search
from app.services.documents import Document, Embedder, retrieve, semantic_ranking
from app.services.llm_client import LLMClient, LLMError, ToolsUnsupported, Usage

logger = logging.getLogger("nexo.orchestrator")

Emit = Callable[[Dict[str, Any]], Awaitable[None]]

MAX_PARALLEL_AGENTS = 4
MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_CHARS = 2500
SYNTHESIS_INPUT_CHARS = 3500
TOKEN_FLUSH_CHARS = 48
TOKEN_FLUSH_SECONDS = 0.05

SYNTHESIS_AGENT_ID = "coordinator"
REVIEWER_AGENT_ID = "reviewer"
MAX_FOLLOWUPS = 3
MAX_TOOL_ROUNDS = 3
MAX_CALLS_PER_ROUND = 3
TOOL_DOC_CHUNKS = 4

_TEXT = {
    "es": {
        "identity": "Respondes siempre en español.",
        "today": "Fecha de hoy: {date}. Ten en cuenta que reglas, precios y tarifas pueden haber cambiado después de tu entrenamiento.",
        "format": "Estructura sugerida",
        "diagrams": ("Si un diagrama aclara la respuesta (flujos, arquitecturas, cronogramas, organigramas), "
                     "inclúyelo en un bloque ```mermaid válido."),
        "focus": ("Trabajas dentro de un equipo de especialistas. Aporta lo que corresponde a TU especialidad "
                  "con profundidad práctica, sin relleno ni repetir la consulta."),
        "memory": "Contexto persistente del usuario (úsalo si es relevante)",
        "previous": "Aportes previos del equipo (complementa, no repitas)",
        "synth_name": "Coordinador",
        "synth_system": (
            "Eres el Coordinador de un equipo de agentes especialistas. Integras sus aportes en UNA respuesta "
            "final clara y accionable para el usuario. Resuelve contradicciones explicitando el criterio, "
            "elimina redundancias, conserva datos concretos (cifras, código, pasos) y termina con un plan de "
            "acción priorizado. No menciones que eres un modelo ni describas el proceso interno."),
        "synth_user": "Consulta del usuario",
        "synth_inputs": "Aportes de los especialistas",
        "synth_task": "Escribe la respuesta final integrada en markdown.",
        "docs": "Documentos adjuntos por el usuario (extractos relevantes)",
        "notes": "Notas del usuario (su memoria personal, vía Neuromapa)",
        "calc": "Cálculo de costos de Mercado Libre (hecho por Nexo con código, cifras exactas)",
        "calc_rule": ("Usa EXACTAMENTE estas cifras: no recalcules ni cambies cargos, comisiones o envíos. "
                      "Interprétalas, explica los supuestos y recomienda. Si el usuario dio otros datos, "
                      "señala la diferencia."),
        "calc_missing": ("Para calcular el costo real de la venta faltan el precio de venta y/o el costo "
                         "unitario: pídeselos al usuario y no inventes esos números."),
        "calc_country": ("La calculadora de Nexo solo tiene tarifas de México; para {country} no hay cifras "
                         "verificadas: no inventes comisiones ni cargos, pide los del simulador de costos."),
        "fragment": "fragmento",
        "web": "Resultados de búsqueda web",
        "cite": ("Usa estas fuentes cuando sean pertinentes y cítalas en línea como [D1], [W2] o [N1]. "
                 "No inventes datos que no estén en las fuentes; si no alcanzan, dilo."),
        "synth_cite": "Conserva las citas [D#]/[W#]/[N#] de los especialistas.",
        "web_failed": "No se pudo completar la búsqueda web",
        "tools_hint": ("Tienes herramientas para buscar información. Úsalas cuando necesites datos que no "
                       "conoces con certeza y cita las fuentes devueltas como [D#] o [W#]."),
        "tools_fallback": "El modelo no soporta herramientas nativas; se usó la búsqueda previa",
        "semantic_failed": "La búsqueda semántica falló; se usó búsqueda por palabras",
        "tool_docs": "Busca en los documentos que adjuntó el usuario. Devuelve fragmentos citables [D#].",
        "tool_web": "Busca información actual en la web. Devuelve resultados citables [W#].",
        "tool_query": "Consulta de búsqueda breve y específica",
        "no_results": "Sin resultados.",
        "review_name": "Revisor crítico",
        "review_system": (
            "Eres un Revisor crítico riguroso. Analizas los aportes de un equipo de especialistas y señalas, en "
            "viñetas breves y concretas: (1) errores o datos dudosos, (2) contradicciones entre especialistas, "
            "(3) vacíos importantes respecto del pedido, (4) afirmaciones fuertes sin fuente cuando hay fuentes "
            "disponibles, (5) riesgos. Para cada punto indica cómo corregirlo. No reescribas la respuesta. "
            "Si los aportes son sólidos, dilo en una línea."),
        "review_task": "Escribe tus observaciones en markdown.",
        "review_inputs": "Observaciones del Revisor crítico (corrige lo señalado)",
        "followup_system": (
            "Propones las preguntas de seguimiento más útiles que el usuario podría hacer a continuación. "
            f'Responde SOLO JSON: {{"questions": ["...", "...", "..."]}} con hasta {MAX_FOLLOWUPS} preguntas '
            "cortas (máx. 15 palabras), concretas y en primera persona del usuario."),
    },
    "en": {
        "identity": "Always answer in English.",
        "today": "Today's date: {date}. Rules, prices and fees may have changed after your training.",
        "format": "Suggested structure",
        "diagrams": ("If a diagram clarifies the answer (flows, architectures, timelines, org charts), "
                     "include it in a valid ```mermaid block."),
        "focus": ("You work inside a team of specialists. Contribute what belongs to YOUR specialty with "
                  "practical depth, no filler and without restating the request."),
        "memory": "Persistent user context (use it when relevant)",
        "previous": "Previous team contributions (build on them, don't repeat)",
        "synth_name": "Coordinator",
        "synth_system": (
            "You are the Coordinator of a team of specialist agents. Merge their contributions into ONE clear, "
            "actionable final answer. Resolve contradictions stating the criterion, remove redundancy, keep "
            "concrete data (figures, code, steps) and finish with a prioritized action plan. Do not mention "
            "being a model or describe the internal process."),
        "synth_user": "User request",
        "synth_inputs": "Specialist contributions",
        "synth_task": "Write the integrated final answer in markdown.",
        "docs": "Documents attached by the user (relevant excerpts)",
        "notes": "The user's notes (personal memory, via Neuromapa)",
        "calc": "Mercado Libre cost calculation (computed by Nexo in code, exact figures)",
        "calc_rule": ("Use EXACTLY these figures: do not recompute or change fees, commissions or shipping. "
                      "Interpret them, explain the assumptions and recommend."),
        "calc_missing": "To compute the real cost of the sale the price and/or unit cost are missing: ask for them.",
        "calc_country": ("Nexo's calculator only has Mexico's fees; for {country} there are no verified "
                         "figures: do not invent commissions or fees."),
        "fragment": "excerpt",
        "web": "Web search results",
        "cite": ("Use these sources when relevant and cite them inline as [D1], [W2] or [N1]. "
                 "Do not invent facts not supported by the sources; say so if they are insufficient."),
        "synth_cite": "Keep the specialists' [D#]/[W#]/[N#] citations.",
        "web_failed": "Web search could not be completed",
        "tools_hint": ("You have search tools. Use them when you need facts you are not sure about and cite "
                       "the returned sources as [D#] or [W#]."),
        "tools_fallback": "The model does not support native tools; pre-search was used instead",
        "semantic_failed": "Semantic search failed; keyword search was used",
        "tool_docs": "Search the documents attached by the user. Returns citable excerpts [D#].",
        "tool_web": "Search the web for current information. Returns citable results [W#].",
        "tool_query": "Short, specific search query",
        "no_results": "No results.",
        "review_name": "Critical reviewer",
        "review_system": (
            "You are a rigorous Critical Reviewer. You analyze a team of specialists' contributions and point out, "
            "in short concrete bullets: (1) errors or doubtful facts, (2) contradictions between specialists, "
            "(3) important gaps versus the request, (4) strong claims without sources when sources exist, "
            "(5) risks. For each point say how to fix it. Do not rewrite the answer. "
            "If the contributions are solid, say so in one line."),
        "review_task": "Write your observations in markdown.",
        "review_inputs": "Critical reviewer's observations (fix what is pointed out)",
        "followup_system": (
            "You suggest the most useful follow-up questions the user could ask next. "
            f'Answer ONLY JSON: {{"questions": ["...", "...", "..."]}} with up to {MAX_FOLLOWUPS} short questions '
            "(max 15 words), concrete, written as the user."),
    },
}


def tokens_per_agent(agent_count: int) -> int:
    """Presupuesto de salida por agente según el tamaño del equipo."""
    if agent_count <= 1:
        return 3000
    if agent_count <= 3:
        return 2048
    return 1500


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + " …"


def compact_summary(text: str, limit: int = 400) -> str:
    """Resumen corto de una respuesta para pasar contexto entre agentes (modo secuencial)."""
    lines = [ln.strip() for ln in text.splitlines()]
    useful = [ln for ln in lines if ln and not ln.startswith(("```", "---", "|-"))]
    return _truncate(" | ".join(useful), limit)


def sanitize_history(history: Any) -> List[Dict[str, str]]:
    """Últimos turnos válidos de la conversación enviados por el cliente."""
    if not isinstance(history, list):
        return []
    clean = []
    for item in history[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            clean.append({"role": role, "content": _truncate(content.strip(), MAX_HISTORY_CHARS)})
    return clean


class _TokenBuffer:
    """Agrupa fragmentos para no emitir un mensaje WebSocket por token."""

    def __init__(self, emit: Emit, event_type: str, agent_id: str):
        self._emit, self._type, self._agent_id = emit, event_type, agent_id
        self._parts: List[str] = []
        self._size = 0
        self._last = time.monotonic()
        self.total = 0  # caracteres recibidos en toda la ejecución

    async def push(self, delta: str) -> None:
        self._parts.append(delta)
        self._size += len(delta)
        self.total += len(delta)
        if self._size >= TOKEN_FLUSH_CHARS or time.monotonic() - self._last >= TOKEN_FLUSH_SECONDS:
            await self.flush()

    async def flush(self) -> None:
        if not self._parts:
            return
        text = "".join(self._parts)
        self._parts, self._size, self._last = [], 0, time.monotonic()
        await self._emit({"type": self._type, "agent_id": self._agent_id, "delta": text})


def _empty_answer(thinking: _TokenBuffer) -> LLMError:
    if thinking.total:
        return LLMError("El modelo gastó todos sus tokens razonando y no llegó a responder. "
                        "Bajá el razonamiento en Opciones de ejecución.")
    return LLMError("El modelo devolvió una respuesta vacía")


@dataclass
class AgentResult:
    spec: AgentSpec
    content: str = ""
    error: Optional[str] = None
    elapsed_ms: float = 0.0
    usage: Usage = field(default_factory=Usage)


class Orchestrator:

    def __init__(self, agents: List[AgentSpec], llm: LLMClient, emit: Emit, *, language: str = "es",
                 mode: str = "parallel", synthesize: bool = True, memory_context: str = "",
                 history: Optional[List[Dict[str, str]]] = None,
                 agent_instructions: Optional[Dict[str, str]] = None,
                 documents: Optional[List[Document]] = None,
                 web_search_config: Optional[Dict[str, str]] = None,
                 embedder: Optional[Embedder] = None,
                 tool_mode: str = "prefetch",
                 review: bool = False,
                 followups: bool = True,
                 notes: Optional[Any] = None):
        if not agents:
            raise ValueError("Se requiere al menos un agente")
        self.agents = agents
        self.llm = llm
        self.emit = emit
        self.language = language if language in _TEXT else "es"
        self.mode = mode if mode in ("parallel", "sequential") else "parallel"
        self.review = review
        # Con revisión, la síntesis tiene sentido aun con un solo agente: aplica las correcciones
        self.synthesize = synthesize and (len(agents) > 1 or review)
        self.suggest_followups = followups
        self.memory_context = memory_context
        self.history = history or []
        self.agent_instructions = agent_instructions or {}
        self.documents = documents or []
        self.web_search_config = web_search_config
        self.embedder = embedder
        self.native_tools = tool_mode == "native" and bool(self.documents or web_search_config)
        self.doc_snippets: List[Dict[str, Any]] = []
        # Memoria (Neuromapa): objeto con search/read/start/end; None = sin notas
        self.notes = notes
        self.note_snippets: List[Dict[str, Any]] = []
        self.web_sources: List[Dict[str, Any]] = []
        self._prefetched = False
        self._prefetch_lock = asyncio.Lock()
        self._warned: set = set()
        self.usage = Usage()
        self.results: List[Dict[str, Any]] = []
        self.synthesis: Optional[str] = None
        self.review_text: Optional[str] = None
        self.followups: List[str] = []
        self.calculation = ""  # bloque de cálculo determinístico (agentes de Mercado Libre)
        self._t = _TEXT[self.language]

    # ------------------------------------------------------------------ prompts

    @property
    def _identity(self) -> str:
        today = self._t["today"].format(date=datetime.now(timezone.utc).date().isoformat())
        return f"{self._t['identity']}\n{today}"

    def _system_prompt(self, spec: AgentSpec) -> str:
        hint = FORMAT_HINTS.get(spec.response_format, FORMAT_HINTS["analysis"])[self.language]
        parts = [spec.system_prompt, "", self._t["focus"], f"{self._t['format']}: {hint}.", self._t["diagrams"],
                 self._identity]
        extra = (self.agent_instructions.get(spec.id) or "").strip()
        if extra:
            parts += ["", extra[:1500]]
        if self.memory_context:
            parts += ["", f"## {self._t['memory']}", _truncate(self.memory_context, 3000)]
        if self.native_tools:
            parts += ["", self._t["tools_hint"]]
        return "\n".join(parts)

    def _context_block(self) -> str:
        parts = [self.calculation] if self.calculation else []
        if self.note_snippets:
            parts.append(f"## {self._t['notes']}")
            parts += [f"[{n['label']}] {n['titulo']} ({n['ruta']}:{n['linea']}):\n{n['contenido']}"
                      for n in self.note_snippets]
        if self.doc_snippets:
            parts.append(f"## {self._t['docs']}")
            parts += [f"[{d['label']}] {d['name']} ({self._t['fragment']} {d['chunk']}):\n{d['content']}"
                      for d in self.doc_snippets]
        if self.web_sources:
            parts.append(f"## {self._t['web']}")
            parts += [f"[{w['label']}] {w['title']} — {w['url']}\n{w['content']}" for w in self.web_sources]
        if parts:
            parts.append(self._t["cite"])
        return "\n\n".join(parts)

    def _messages(self, spec: AgentSpec, task: str, previous: List[AgentResult]) -> List[Dict[str, str]]:
        user = task
        context = self._context_block()
        if context:
            user = f"{context}\n\n---\n{task}"
        if previous:
            notes = "\n".join(f"- {r.spec.name}: {compact_summary(r.content)}" for r in previous if r.content)
            if notes:
                user = f"{user}\n\n---\n{self._t['previous']}:\n{notes}"
        return [{"role": "system", "content": self._system_prompt(spec)}, *self.history,
                {"role": "user", "content": user}]

    # ---------------------------------------------------------------- ejecución

    def _public(self, spec: AgentSpec) -> Dict[str, Any]:
        return {"id": spec.id, "name": spec.name, "emoji": spec.emoji, "category": spec.category,
                "specialty": spec.specialization}

    # ------------------------------------------------------------ herramientas

    async def _warn_once(self, key: str) -> None:
        if key not in self._warned:
            self._warned.add(key)
            await self.emit({"type": "warning", "message": self._t[key]})

    async def _search_documents(self, query: str, k: int) -> List[Dict[str, Any]]:
        semantic = None
        if self.embedder:
            try:
                total = sum(len(d.chunks) for d in self.documents)
                semantic = await semantic_ranking(query, self.documents, self.embedder, min(total, k * 3))
            except LLMError as e:
                logger.info("Embeddings fallaron: %s", e)
                self.embedder = None
                await self._warn_once("semantic_failed")
        return retrieve(query, self.documents, k=k, semantic=semantic)

    def _register_docs(self, snippets: List[Dict[str, Any]]) -> None:
        seen = {(d["document_id"], d["chunk"]) for d in self.doc_snippets}
        self.doc_snippets += [d for d in snippets if (d["document_id"], d["chunk"]) not in seen]

    def _register_web(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Numera globalmente las fuentes web (W1, W2…) para que todos los agentes compartan etiquetas."""
        by_url = {w["url"]: w for w in self.web_sources}
        labeled = []
        for r in results:
            if r["url"] not in by_url:
                entry = {**r, "label": f"W{len(self.web_sources) + 1}"}
                self.web_sources.append(entry)
                by_url[r["url"]] = entry
            labeled.append(by_url[r["url"]])
        return labeled

    def _tool_specs(self) -> List[Dict[str, Any]]:
        params = {"type": "object", "required": ["consulta"],
                  "properties": {"consulta": {"type": "string", "description": self._t["tool_query"]}}}
        tools = []
        if self.documents:
            tools.append({"type": "function", "function": {
                "name": "buscar_documentos", "description": self._t["tool_docs"], "parameters": params}})
        if self.web_search_config:
            tools.append({"type": "function", "function": {
                "name": "buscar_web", "description": self._t["tool_web"], "parameters": params}})
        return tools

    async def _execute_tool(self, spec: AgentSpec, call: Dict[str, Any]) -> str:
        query = str(call["arguments"].get("consulta") or call["arguments"].get("query") or "").strip()[:300]
        await self.emit({"type": "tool_call", "agent_id": spec.id, "agent": spec.name, "tool": call["name"],
                         "query": query, "timestamp": _now()})
        if not query:
            return self._t["no_results"]
        if call["name"] == "buscar_documentos" and self.documents:
            hits = await self._search_documents(query, TOOL_DOC_CHUNKS)
            self._register_docs(hits)
            text = "\n\n".join(f"[{h['label']}] {h['name']} ({self._t['fragment']} {h['chunk']}):\n{h['content']}"
                               for h in hits)
        elif call["name"] == "buscar_web" and self.web_search_config:
            try:
                results = self._register_web(await web_search.search(self.web_search_config, [query]))
            except web_search.WebSearchError as e:
                return f"{self._t['web_failed']}: {e}"
            text = "\n\n".join(f"[{w['label']}] {w['title']} — {w['url']}\n{w['content']}" for w in results)
        else:
            return self._t["no_results"]
        await self.emit({"type": "context_ready", "sources": self.sources(), "timestamp": _now()})
        return text or self._t["no_results"]

    async def _stream_native(self, spec: AgentSpec, task: str, previous: List[AgentResult], max_tokens: int,
                             usage: Usage, buffer: "_TokenBuffer", chunks: List[str],
                             thinking: "_TokenBuffer") -> None:
        """Bucle de function calling: el modelo pide herramientas, se ejecutan y continúa."""
        convo: List[Dict[str, Any]] = list(self._messages(spec, task, previous))
        tools = self._tool_specs()
        for round_ in range(MAX_TOOL_ROUNDS + 1):
            round_text: List[str] = []
            calls: List[Dict[str, Any]] = []
            offer = tools if round_ < MAX_TOOL_ROUNDS else None  # última ronda: respuesta final obligada
            async for kind, payload in self.llm.stream_events(convo, tools=offer, max_tokens=max_tokens,
                                                              usage=usage):
                if kind == "text":
                    round_text.append(payload)
                    chunks.append(payload)
                    await buffer.push(payload)
                elif kind == "reasoning":
                    await thinking.push(payload)
                else:
                    calls = payload[:MAX_CALLS_PER_ROUND]
            await buffer.flush()
            await thinking.flush()
            if not calls:
                return
            convo.append({"role": "assistant", "content": "".join(round_text) or None, "tool_calls": [
                {"id": c["id"], "type": "function",
                 "function": {"name": c["name"], "arguments": json.dumps(c["arguments"], ensure_ascii=False)}}
                for c in calls]})
            for call in calls:
                convo.append({"role": "tool", "tool_call_id": call["id"],
                              "content": await self._execute_tool(spec, call)})
            if round_text:
                chunks.append("\n\n")

    async def _run_agent(self, spec: AgentSpec, task: str, step: int, previous: List[AgentResult],
                         max_tokens: int) -> AgentResult:
        result = AgentResult(spec=spec)
        started = time.monotonic()
        await self.emit({"type": "agent_start", "agent_id": spec.id, "agent": spec.name, "step": step,
                         "total": len(self.agents), "timestamp": _now()})
        if self.notes and self.note_snippets:
            await self.notes.read(spec.id, [n["ruta"] for n in self.note_snippets])
        buffer = _TokenBuffer(self.emit, "agent_token", spec.id)
        thinking = _TokenBuffer(self.emit, "thinking", spec.id)
        chunks: List[str] = []
        try:
            native_done = False
            if self.native_tools:
                try:
                    await self._stream_native(spec, task, previous, max_tokens, result.usage, buffer, chunks, thinking)
                    native_done = True
                except ToolsUnsupported:
                    self.native_tools = False
                    await self._warn_once("tools_fallback")
                    await self._ensure_prefetch(task)
            if not native_done:
                async for delta in self.llm.stream(self._messages(spec, task, previous), max_tokens=max_tokens,
                                                   usage=result.usage, on_reasoning=thinking.push):
                    chunks.append(delta)
                    await buffer.push(delta)
                await buffer.flush()
            await thinking.flush()
            result.content = "".join(chunks).strip()
            if not result.content:
                raise _empty_answer(thinking)
        except LLMError as e:
            result.error = str(e)
            logger.warning("Agente %s falló (%s/%s): %s", spec.id, getattr(self.llm, "provider", "?"),
                           getattr(self.llm, "model", "?"), e)
        result.elapsed_ms = (time.monotonic() - started) * 1000
        self.usage.add(result.usage)

        if result.error:
            await self.emit({"type": "agent_error", "agent_id": spec.id, "agent": spec.name,
                             "error": result.error, "timestamp": _now()})
        else:
            formatted = self._format(result, step)
            self.results.append(formatted)
            await self.emit({"type": "agent_response", "data": formatted, "timestamp": _now()})
        return result

    def _format(self, result: AgentResult, step: int) -> Dict[str, Any]:
        spec = result.spec
        formatted = HumanResponseFormatter.format_agent_response(
            raw_response=result.content, agent_id=spec.id, agent_name=spec.name, level=3,
            specialty=spec.specialization, step=step, total_steps=len(self.agents), language=self.language,
        )
        formatted.update({
            "agent_emoji": spec.emoji,
            "category": spec.category,
            "format_type": spec.response_format,
            "raw_content": result.content,
            "elapsed_ms": round(result.elapsed_ms),
            "usage": result.usage.as_dict(),
        })
        return formatted

    async def _stream_section(self, kind: str, agent_id: str, name: str, messages: List[Dict[str, Any]],
                              max_tokens: int, temperature: float) -> Optional[str]:
        """Genera un bloque del Revisor/Coordinador con eventos {kind}_start/_token/_complete."""
        await self.emit({"type": f"{kind}_start", "agent_id": agent_id, "agent": name, "timestamp": _now()})
        usage = Usage()
        buffer = _TokenBuffer(self.emit, f"{kind}_token", agent_id)
        thinking = _TokenBuffer(self.emit, "thinking", agent_id)
        chunks: List[str] = []
        try:
            async for delta in self.llm.stream(messages, max_tokens=max_tokens, temperature=temperature, usage=usage,
                                               on_reasoning=thinking.push):
                chunks.append(delta)
                await buffer.push(delta)
            await buffer.flush()
            await thinking.flush()
            if not "".join(chunks).strip():
                raise _empty_answer(thinking)
        except LLMError as e:
            await self.emit({"type": "agent_error", "agent_id": agent_id, "agent": name, "error": str(e),
                             "timestamp": _now()})
            return None
        finally:
            self.usage.add(usage)
        text = "".join(chunks).strip()
        await self.emit({"type": f"{kind}_complete", "agent_id": agent_id, "agent": name, "content": text,
                         "usage": usage.as_dict(), "timestamp": _now()})
        return text

    def _contributions(self, ok: List[AgentResult]) -> str:
        per_agent = max(800, SYNTHESIS_INPUT_CHARS * 3 // max(1, len(ok)))
        return "\n\n".join(f"### {r.spec.emoji} {r.spec.name}\n{_truncate(r.content, per_agent)}" for r in ok)

    async def _run_review(self, task: str, results: List[AgentResult]) -> None:
        ok = [r for r in results if r.content]
        if not ok:
            return
        sources = "".join(f"[{src['label']}] {src['title']}\n" for src in self.sources())
        messages = [
            {"role": "system", "content": f"{self._t['review_system']}\n{self._identity}"},
            {"role": "user", "content": (f"## {self._t['synth_user']}\n{task}\n\n## {self._t['synth_inputs']}\n"
                                         f"{self._contributions(ok)}\n\n{self._calc_for_inputs()}"
                                         f"{sources + chr(10) if sources else ''}"
                                         f"{self._t['review_task']}")},
        ]
        self.review_text = await self._stream_section("review", REVIEWER_AGENT_ID, self._t["review_name"],
                                                      messages, max_tokens=1200, temperature=0.2)

    async def _run_followups(self, task: str, answer: str) -> None:
        messages = [
            {"role": "system", "content": f"{self._t['followup_system']}\n{self._identity}"},
            {"role": "user", "content": f"{task[:1500]}\n\n---\n{_truncate(answer, 2500)}"},
        ]
        usage = Usage()
        try:
            raw = await self.llm.complete(messages, max_tokens=250, temperature=0.5, usage=usage)
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            questions = json.loads(match.group(0)).get("questions", []) if match else []
        except (LLMError, ValueError, AttributeError):
            questions = []
        finally:
            self.usage.add(usage)
        self.followups = [str(q).strip()[:200] for q in questions if str(q).strip()][:MAX_FOLLOWUPS]
        if self.followups:
            await self.emit({"type": "followups", "questions": self.followups, "timestamp": _now()})

    async def _run_synthesis(self, task: str, results: List[AgentResult]) -> None:
        ok = [r for r in results if r.content]
        if len(ok) < (1 if self.review_text else 2):
            return
        inputs = self._contributions(ok)
        if self.calculation:
            inputs += f"\n\n{self.calculation}"
        if self.review_text:
            inputs += f"\n\n## {self._t['review_inputs']}\n{_truncate(self.review_text, 2500)}"
        sources = self.sources()
        source_list = "".join(f"[{src['label']}] {src['title']} {src.get('url', '')}\n" for src in sources)
        messages = [
            {"role": "system", "content": f"{self._t['synth_system']}\n{self._identity}"
                                          + (f"\n{self._t['synth_cite']}" if sources else "")},
            *self.history,
            {"role": "user", "content": (f"## {self._t['synth_user']}\n{task}\n\n## {self._t['synth_inputs']}\n"
                                         f"{inputs}\n\n{source_list + chr(10) if source_list else ''}"
                                         f"{self._t['synth_task']}")},
        ]
        self.synthesis = await self._stream_section("synthesis", SYNTHESIS_AGENT_ID, self._t["synth_name"],
                                                    messages, max_tokens=2500, temperature=0.4)

    def sources(self) -> List[Dict[str, Any]]:
        docs = [{"label": d["label"], "kind": "document", "title": d["name"], "document_id": d["document_id"],
                 "chunk": d["chunk"]} for d in self.doc_snippets]
        web = [{"label": w["label"], "kind": "web", "title": w["title"], "url": w["url"]} for w in self.web_sources]
        notes = [{"label": n["label"], "kind": "note", "title": n["titulo"], "path": n["ruta"], "line": n["linea"]}
                 for n in self.note_snippets]
        return notes + docs + web

    def _calc_for_inputs(self) -> str:
        return f"{self.calculation}\n\n" if self.calculation else ""

    async def _prepare_calculation(self, task: str) -> None:
        """Si hay agentes de Mercado Libre y la consulta trae números, calcula los costos con código."""
        if not any(a.category == "mercadolibre" for a in self.agents):
            return
        usage = Usage()
        try:
            sale, reason = await ml_costs.extract_sale(task, self.llm, usage)
        finally:
            self.usage.add(usage)
        if sale:
            table = ml_costs.render_markdown(sale)
            self.calculation = f"## {self._t['calc']}\n{self._t['calc_rule']}\n\n{table}"
            await self.emit({"type": "calculation", "title": self._t["calc"], "content": table,
                             "timestamp": _now()})
        elif reason == "faltan_datos":
            self.calculation = f"## {self._t['calc']}\n{self._t['calc_missing']}"
        elif reason.startswith("pais:"):
            self.calculation = f"## {self._t['calc']}\n" + self._t["calc_country"].format(country=reason[5:])

    async def _prepare_notes(self, task: str) -> None:
        """Las notas del usuario que tocan la consulta, como contexto citable [N#]."""
        if not self.notes:
            return
        query = " ".join([m["content"] for m in self.history if m["role"] == "user"][-1:] + [task])
        found = await self.notes.search(query)
        self.note_snippets = [{**n, "label": f"N{i}"} for i, n in enumerate(found, 1)]
        if self.note_snippets:
            await self.emit({"type": "context_ready", "sources": self.sources(), "timestamp": _now()})

    async def _ensure_prefetch(self, task: str) -> None:
        async with self._prefetch_lock:
            if not self._prefetched:
                self._prefetched = True
                await self._gather_context(task)

    async def _gather_context(self, task: str) -> None:
        if self.documents:
            query = " ".join([m["content"] for m in self.history if m["role"] == "user"][-1:] + [task])
            self._register_docs(await self._search_documents(query, 6))
        if self.web_search_config:
            await self.emit({"type": "research_start", "timestamp": _now()})
            usage = Usage()
            try:
                queries = await web_search.plan_queries(task, self.llm, self.language, self.history, usage)
                await self.emit({"type": "research_queries", "queries": queries, "timestamp": _now()})
                self._register_web(await web_search.search(self.web_search_config, queries))
            except web_search.WebSearchError as e:
                await self.emit({"type": "warning", "message": f"{self._t['web_failed']}: {e}"})
            finally:
                self.usage.add(usage)
        if self.doc_snippets or self.web_search_config:
            await self.emit({"type": "context_ready", "sources": self.sources(), "timestamp": _now()})

    async def run(self, task: str) -> Dict[str, Any]:
        started = time.monotonic()
        max_tokens = tokens_per_agent(len(self.agents))
        await self.emit({"type": "pipeline_start", "mode": self.mode, "synthesis": self.synthesize,
                         "total_agents": len(self.agents), "agents": [self._public(a) for a in self.agents],
                         "review": self.review,
                         "web_search": bool(self.web_search_config), "documents": len(self.documents),
                         "tool_mode": "native" if self.native_tools else "prefetch", "timestamp": _now()})
        if self.notes:
            await self.notes.start(len(task))
        await self._prepare_calculation(task)
        await self._prepare_notes(task)
        if not self.native_tools:
            await self._ensure_prefetch(task)

        if self.mode == "sequential":
            done: List[AgentResult] = []
            for step, spec in enumerate(self.agents, 1):
                done.append(await self._run_agent(spec, task, step, done, max_tokens))
        else:
            semaphore = asyncio.Semaphore(MAX_PARALLEL_AGENTS)

            async def limited(step: int, spec: AgentSpec) -> AgentResult:
                async with semaphore:
                    return await self._run_agent(spec, task, step, [], max_tokens)

            done = list(await asyncio.gather(*(limited(i, s) for i, s in enumerate(self.agents, 1))))

        if self.review and any(r.content for r in done):
            await self._run_review(task, done)
        if self.synthesize:
            await self._run_synthesis(task, done)
        final_answer = self.synthesis or next((r.content for r in reversed(done) if r.content), "")
        if self.suggest_followups and final_answer:
            await self._run_followups(task, final_answer)

        elapsed_ms = (time.monotonic() - started) * 1000
        succeeded = [r.spec.id for r in done if not r.error]
        summary = HumanResponseFormatter.create_pipeline_summary(
            agents_completed=succeeded, total_time_ms=elapsed_ms,
            success=len(succeeded) == len(done), language=self.language,
        )
        summary.update({"usage": self.usage.as_dict(), "failed": [r.spec.id for r in done if r.error],
                        "has_synthesis": self.synthesis is not None, "sources": self.sources(),
                        "has_review": self.review_text is not None, "followups": self.followups})
        if self.notes:
            await self.notes.end()
        await self.emit({"type": "pipeline_complete", "data": summary, "timestamp": _now()})
        return summary
