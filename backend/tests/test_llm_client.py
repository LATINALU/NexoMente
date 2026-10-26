import asyncio
from types import SimpleNamespace

import httpx
import openai

from app.services.llm_client import LLMClient


def _chunk(text):
    delta = SimpleNamespace(content=text, tool_calls=None, model_extra={})
    return SimpleNamespace(usage=None, choices=[SimpleNamespace(delta=delta)])


class FakeCompletions:
    """Imita chat.completions: registra los kwargs y rechaza los parámetros indicados."""

    def __init__(self, reject=()):
        self.reject = set(reject)
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(dict(kwargs))
        for param in self.reject:
            if param in kwargs:
                response = httpx.Response(400, request=httpx.Request("POST", "http://x/v1/chat/completions"))
                raise openai.BadRequestError(f"Unrecognized request argument: {param}", response=response, body=None)

        async def gen():
            yield _chunk("hola")
        return gen()


def _client(reasoning=None, reject=()):
    llm = LLMClient({"type": "local", "api_key": "local", "base_url": "http://localhost:11434/v1"}, "m",
                    reasoning=reasoning)
    fake = FakeCompletions(reject)
    llm._client = SimpleNamespace(chat=SimpleNamespace(completions=fake))
    return llm, fake


def _collect(llm, **kw):
    async def go():
        return "".join([p async for p in llm.stream([{"role": "user", "content": "x"}], **kw)])
    return asyncio.run(go())


def test_reasoning_effort_is_sent_only_when_configured():
    llm, fake = _client()
    _collect(llm)
    assert "reasoning_effort" not in fake.calls[0]

    llm, fake = _client(reasoning="low")
    assert _collect(llm) == "hola"
    assert fake.calls[0]["reasoning_effort"] == "low"

    llm, fake = _client(reasoning="bogus")
    _collect(llm)
    assert "reasoning_effort" not in fake.calls[0]


def test_complete_turns_reasoning_off():
    llm, fake = _client(reasoning="high")
    assert asyncio.run(llm.complete([{"role": "user", "content": "x"}])) == "hola"
    assert fake.calls[0]["reasoning_effort"] == "none"


def test_rejected_optional_params_are_dropped_and_remembered():
    llm, fake = _client(reasoning="medium", reject=("reasoning_effort", "stream_options"))
    assert _collect(llm) == "hola"
    last = fake.calls[-1]
    assert "reasoning_effort" not in last and "stream_options" not in last
    calls_before = len(fake.calls)
    _collect(llm)
    assert len(fake.calls) == calls_before + 1  # ya no reintenta


def test_thinking_gets_extra_token_budget():
    llm, fake = _client(reasoning="high")
    _collect(llm, max_tokens=1000)
    assert fake.calls[0]["max_tokens"] == 1000 + 8192

    llm, fake = _client(reasoning="none")
    _collect(llm, max_tokens=1000)
    assert fake.calls[0]["max_tokens"] == 1000


def test_local_errors_say_what_to_do():
    import httpx
    from app.services.llm_client import _friendly_error
    req = httpx.Request("POST", "http://localhost:11434/v1/chat/completions")
    down = _friendly_error(openai.APIConnectionError(request=req), "local", "qwen", "http://localhost:11434/v1")
    assert "localhost:11434" in str(down) and "ollama serve" in str(down)
    missing = _friendly_error(openai.NotFoundError("nf", response=httpx.Response(404, request=req), body=None),
                              "local", "qwen3.5:9b", "http://localhost:11434/v1")
    assert "ollama pull qwen3.5:9b" in str(missing)
    cloud = _friendly_error(openai.APIConnectionError(request=req), "groq", "m", "https://api.groq.com")
    assert str(cloud) == "No se pudo conectar con el proveedor de IA"
