import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Entorno de test aislado: sin .env.nexo real, sin DB ni Redis accesibles
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-0123456789")
os.environ.setdefault("DATABASE_URL", "postgresql://nobody:nothing@127.0.0.1:1/none")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:1/0")
os.environ.setdefault("ALLOW_PRIVATE_LLM_URLS", "false")


class FakeLLM:
    """Sustituto de LLMClient: responde texto determinístico en fragmentos."""

    def __init__(self, replies=None, fail_for=(), delay=0.0, thinking=""):
        self.replies = replies or {}
        self.fail_for = set(fail_for)
        self.delay = delay
        self.thinking = thinking
        self.calls = []

    async def stream(self, messages, max_tokens=2048, temperature=0.7, usage=None, on_reasoning=None, reasoning=None):
        import asyncio
        from app.services.llm_client import LLMError, Usage

        self.calls.append(messages)
        system = messages[0]["content"]
        key = next((k for k in self.replies if k in system), None)
        if any(f in system for f in self.fail_for):
            raise LLMError("API key inválida o revocada")
        text = self.replies.get(key, "Respuesta de prueba con **markdown** y detalle suficiente.")
        if self.thinking and on_reasoning:
            await on_reasoning(self.thinking)
        if usage is not None:
            usage.add(Usage(10, len(text) // 4))
        for i in range(0, len(text), 7):
            if self.delay:
                await asyncio.sleep(self.delay)
            yield text[i:i + 7]

    async def complete(self, messages, max_tokens=1024, temperature=0.3, usage=None):
        return "".join([p async for p in self.stream(messages, max_tokens, temperature, usage)])


@pytest.fixture
def fake_llm():
    return FakeLLM()


def call_with_system(llm, marker):
    """Primera llamada registrada cuyo system prompt contiene `marker`."""
    return next(c for c in llm.calls if marker in c[0]["content"])
