"""
Nexo - Cliente LLM
=================
Wrapper sobre AsyncOpenAI para cualquier proveedor con API compatible con
OpenAI (Groq, OpenAI, Anthropic, Google, OpenRouter, Ollama, LM Studio).

- Reutiliza un cliente por (base_url, api_key) en vez de crear uno por llamada.
- Streaming real token a token.
- Registra el uso de tokens cuando el proveedor lo informa.
- Embeddings (/embeddings) y llamadas a herramientas (function calling) en streaming.
- Esfuerzo de razonamiento (`reasoning_effort`) opcional; si el proveedor no lo acepta se omite.
"""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from dataclasses import dataclass
import json
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional, Tuple

import openai
from openai import AsyncOpenAI

logger = logging.getLogger("nexo.llm")

REQUEST_TIMEOUT_S = 120.0
_MAX_CACHED_CLIENTS = 64


class LLMError(Exception):
    """Error presentable al usuario."""


class ToolsUnsupported(LLMError):
    """El modelo/proveedor no acepta `tools` (function calling)."""


EMBED_BATCH = 64

OnReasoning = Optional[Callable[[str], Awaitable[None]]]

# "none" apaga el razonamiento de los modelos que piensan (Ollama, OpenAI, Gemini, Groq)
REASONING_LEVELS = ("none", "low", "medium", "high")
# Tokens extra para pensar: en la mayoría de los proveedores el razonamiento cuenta dentro
# de max_tokens y, sin margen, el modelo se queda sin presupuesto antes de responder.
# None = el proveedor decide (puede pensar o no).
THINKING_ALLOWANCE = {None: 4096, "low": 2048, "medium": 4096, "high": 8192}


def _reasoning_of(delta: Any) -> str:
    """Texto de razonamiento ("thinking") si el proveedor lo envía aparte (Ollama, Groq, DeepSeek…)."""
    extra = getattr(delta, "model_extra", None) or {}
    value = extra.get("reasoning") or extra.get("reasoning_content") or getattr(delta, "reasoning_content", None)
    return value if isinstance(value, str) else ""


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def add(self, other: "Usage") -> None:
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens

    def as_dict(self) -> Dict[str, int]:
        return {"prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens,
                "total_tokens": self.total_tokens}


_clients: "OrderedDict[str, AsyncOpenAI]" = OrderedDict()


def _client_for(api_key: str, base_url: str) -> AsyncOpenAI:
    key = hashlib.sha256(f"{base_url}|{api_key}".encode()).hexdigest()
    client = _clients.get(key)
    if client is None:
        client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=REQUEST_TIMEOUT_S, max_retries=2)
        _clients[key] = client
        if len(_clients) > _MAX_CACHED_CLIENTS:
            _clients.popitem(last=False)
    else:
        _clients.move_to_end(key)
    return client


def _friendly_error(e: Exception, provider: str = "", model: str = "", base_url: str = "") -> LLMError:
    """Mensaje claro y accionable; para servidores locales dice dónde y cómo arrancarlos."""
    local = provider == "local"
    # APITimeoutError hereda de APIConnectionError: un timeout no es «servidor apagado»
    if local and isinstance(e, openai.APIConnectionError) and not isinstance(e, openai.APITimeoutError):
        return LLMError(f"No se pudo conectar con el servidor local en {base_url}. ¿Está abierto Ollama/LM Studio? "
                        "Con Ollama: abre la app o ejecuta «ollama serve».")
    if local and isinstance(e, openai.NotFoundError):
        return LLMError(f"El modelo «{model}» no está instalado en el servidor local. "
                        f"Descárgalo con «ollama pull {model}» o elige otro en el selector de modelo.")
    if isinstance(e, openai.AuthenticationError):
        return LLMError("API key inválida o revocada")
    if isinstance(e, openai.PermissionDeniedError):
        return LLMError("La API key no tiene permiso para este modelo")
    if isinstance(e, openai.NotFoundError):
        return LLMError("Modelo no encontrado en el proveedor")
    if isinstance(e, openai.RateLimitError):
        return LLMError("Límite de uso del proveedor alcanzado; intenta en unos segundos")
    if isinstance(e, openai.APITimeoutError):
        return LLMError("El proveedor tardó demasiado en responder"
                        + ("; los modelos locales grandes pueden necesitar más memoria de la que tiene tu GPU" if local else ""))
    if isinstance(e, openai.APIConnectionError):
        return LLMError("No se pudo conectar con el proveedor de IA")
    if isinstance(e, openai.BadRequestError):
        return LLMError(f"Solicitud rechazada por el proveedor: {getattr(e, 'message', e)}"[:300])
    if isinstance(e, openai.APIStatusError):
        return LLMError(f"Error del proveedor ({e.status_code})")
    return LLMError("Error inesperado llamando al modelo")


class LLMClient:
    """Cliente ligado a la configuración de un usuario: {type, api_key, base_url}."""

    def __init__(self, api_config: Dict[str, str], model: str, reasoning: Optional[str] = None):
        self.provider = api_config.get("type", "openai")
        self.model = model
        # None = lo que decida el proveedor; si no, uno de REASONING_LEVELS
        self.reasoning = reasoning if reasoning in REASONING_LEVELS else None
        self._base_url = api_config["base_url"]
        self._client = _client_for(api_config["api_key"], api_config["base_url"])
        # Algunos proveedores (p.ej. Ollama viejo) rechazan stream_options
        self._supports_usage = True
        # Los modelos sin razonamiento (p.ej. gpt-4o) rechazan reasoning_effort
        self._supports_reasoning = True

    def _kwargs(self, messages: List[Dict[str, Any]], max_tokens: int, temperature: float,
                reasoning: Optional[str]) -> Dict[str, Any]:
        effort = reasoning if reasoning in REASONING_LEVELS else self.reasoning
        if effort != "none":
            max_tokens += THINKING_ALLOWANCE[effort]
        kwargs: Dict[str, Any] = dict(model=self.model, messages=messages, max_tokens=max_tokens,
                                      temperature=temperature, stream=True)
        if self._supports_usage:
            kwargs["stream_options"] = {"include_usage": True}
        if effort and self._supports_reasoning:
            kwargs["reasoning_effort"] = effort
        return kwargs

    async def _create(self, kwargs: Dict[str, Any]) -> Any:
        """Abre el stream; quita los parámetros opcionales que el proveedor rechace y reintenta."""
        while True:
            try:
                return await self._client.chat.completions.create(**kwargs)
            except openai.BadRequestError as e:
                text = str(e).lower()
                if kwargs.get("tools") and ("tool" in text or "function" in text):
                    raise ToolsUnsupported("El modelo no soporta herramientas") from e
                if "reasoning" in text and "reasoning_effort" in kwargs:
                    self._supports_reasoning = False
                    kwargs.pop("reasoning_effort")
                elif "stream_options" in text and "stream_options" in kwargs:
                    self._supports_usage = False
                    kwargs.pop("stream_options")
                else:
                    raise

    async def stream(self, messages: List[Dict[str, str]], max_tokens: int = 2048,
                     temperature: float = 0.7, usage: Optional[Usage] = None,
                     on_reasoning: OnReasoning = None, reasoning: Optional[str] = None) -> AsyncIterator[str]:
        """Genera fragmentos de texto a medida que llegan. El razonamiento va a `on_reasoning`."""
        try:
            response = await self._create(self._kwargs(messages, max_tokens, temperature, reasoning))
            async for chunk in response:
                if chunk.usage and usage is not None:
                    usage.add(Usage(chunk.usage.prompt_tokens or 0, chunk.usage.completion_tokens or 0))
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                if on_reasoning:
                    thought = _reasoning_of(delta)
                    if thought:
                        await on_reasoning(thought)
                if delta.content:
                    yield delta.content
        except openai.OpenAIError as e:
            logger.info("Error LLM (%s/%s): %s", self.provider, self.model, e)
            raise _friendly_error(e, self.provider, self.model, self._base_url) from e

    async def complete(self, messages: List[Dict[str, Any]], max_tokens: int = 1024,
                       temperature: float = 0.3, usage: Optional[Usage] = None) -> str:
        """Respuesta completa sin razonar: son tareas cortas (JSON, OCR) y el razonamiento
        consumiría el presupuesto de tokens dejando la respuesta vacía."""
        parts = [p async for p in self.stream(messages, max_tokens, temperature, usage, reasoning="none")]
        return "".join(parts)

    async def stream_events(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict]] = None,
                            max_tokens: int = 2048, temperature: float = 0.7,
                            usage: Optional[Usage] = None) -> AsyncIterator[Tuple[str, Any]]:
        """
        Como `stream`, pero con herramientas. Emite ("text", str) a medida que llega y,
        al final, ("tool_calls", [{"id", "name", "arguments": dict}]) si el modelo pidió herramientas.
        """
        kwargs = self._kwargs(messages, max_tokens, temperature, None)
        if tools:
            kwargs["tools"] = tools
        calls: Dict[int, Dict[str, str]] = {}
        try:
            response = await self._create(kwargs)
            async for chunk in response:
                if chunk.usage and usage is not None:
                    usage.add(Usage(chunk.usage.prompt_tokens or 0, chunk.usage.completion_tokens or 0))
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                thought = _reasoning_of(delta)
                if thought:
                    yield ("reasoning", thought)
                if delta.content:
                    yield ("text", delta.content)
                for tc in delta.tool_calls or []:
                    slot = calls.setdefault(tc.index or 0, {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function and tc.function.name:
                        slot["name"] += tc.function.name
                    if tc.function and tc.function.arguments:
                        slot["arguments"] += tc.function.arguments
        except ToolsUnsupported:
            raise
        except openai.OpenAIError as e:
            logger.info("Error LLM (%s/%s): %s", self.provider, self.model, e)
            raise _friendly_error(e, self.provider, self.model, self._base_url) from e

        if calls:
            parsed = []
            for i, call in sorted(calls.items()):
                try:
                    args = json.loads(call["arguments"] or "{}")
                except ValueError:
                    args = {}
                parsed.append({"id": call["id"] or f"call_{i}", "name": call["name"],
                               "arguments": args if isinstance(args, dict) else {}})
            yield ("tool_calls", parsed)

    async def embed(self, texts: List[str], model: str) -> List[List[float]]:
        """Vectores para cada texto (API /embeddings compatible con OpenAI), en lotes."""
        vectors: List[List[float]] = []
        try:
            for i in range(0, len(texts), EMBED_BATCH):
                batch = [t[:8000] or " " for t in texts[i:i + EMBED_BATCH]]
                response = await self._client.embeddings.create(model=model, input=batch)
                vectors.extend(item.embedding for item in sorted(response.data, key=lambda d: d.index))
        except openai.OpenAIError as e:
            logger.info("Error embeddings (%s/%s): %s", self.provider, model, e)
            raise _friendly_error(e, self.provider, self.model, self._base_url) from e
        if len(vectors) != len(texts):
            raise LLMError("El proveedor devolvió una cantidad inesperada de embeddings")
        return vectors
