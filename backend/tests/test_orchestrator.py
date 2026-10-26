import asyncio

import pytest

from app.agents.catalog import AGENTS
from app.services.agent_router import prefilter, suggest_agents
from app.services.orchestrator import Orchestrator, compact_summary, sanitize_history, tokens_per_agent
from tests.conftest import FakeLLM, call_with_system

A, B, C = AGENTS["fullstack_developer"], AGENTS["seo_specialist"], AGENTS["backend_architect"]


def run(coro):
    return asyncio.run(coro)


class Recorder:
    def __init__(self):
        self.events = []

    async def __call__(self, event):
        self.events.append(event)

    def types(self):
        return [e["type"] for e in self.events]

    def text_for(self, agent_id, kind="agent_token"):
        return "".join(e["delta"] for e in self.events if e["type"] == kind and e["agent_id"] == agent_id)


def test_single_agent_streams_tokens_and_has_no_synthesis():
    rec, llm = Recorder(), FakeLLM()
    summary = run(Orchestrator([A], llm, rec).run("Diseña una API"))
    types = rec.types()
    assert types[0] == "pipeline_start" and types[-1] == "pipeline_complete"
    assert "agent_token" in types and "synthesis_start" not in types
    response = next(e for e in rec.events if e["type"] == "agent_response")["data"]
    assert rec.text_for(A.id).strip() == response["raw_content"]
    assert response["agent_name"] == A.name and response["agent_emoji"] == A.emoji
    assert summary["usage"]["total_tokens"] > 0


def test_parallel_with_synthesis_and_partial_failure():
    rec = Recorder()
    llm = FakeLLM(fail_for=[B.system_prompt[:60]])
    orch = Orchestrator([A, B, C], llm, rec)
    summary = run(orch.run("Lanzar un SaaS"))
    assert summary["failed"] == [B.id]
    assert {e["agent_id"] for e in rec.events if e["type"] == "agent_error"} == {B.id}
    assert "synthesis_complete" in rec.types()
    assert orch.synthesis and summary["has_synthesis"]
    synth_prompt = call_with_system(llm, "Coordinador")[-1]["content"]
    assert A.name in synth_prompt and C.name in synth_prompt and B.name not in synth_prompt


def test_synthesis_can_be_disabled():
    rec = Recorder()
    run(Orchestrator([A, C], FakeLLM(), rec, synthesize=False).run("x"))
    assert "synthesis_start" not in rec.types()


def test_sequential_passes_previous_context():
    llm = FakeLLM()
    run(Orchestrator([A, C], llm, Recorder(), mode="sequential", synthesize=False).run("Tarea"))
    first_user, second_user = llm.calls[0][-1]["content"], llm.calls[1][-1]["content"]
    assert "Aportes previos" not in first_user
    assert "Aportes previos" in second_user and A.name in second_user


def test_history_memory_instructions_and_language_reach_the_prompt():
    llm = FakeLLM()
    history = [{"role": "user", "content": "Antes"}, {"role": "assistant", "content": "Respuesta previa"}]
    orch = Orchestrator([A], llm, Recorder(), language="en", memory_context="Prefiere Python",
                        history=history, agent_instructions={A.id: "Usa ejemplos en Go"})
    run(orch.run("Now"))
    messages = llm.calls[0]
    assert messages[1:3] == history and messages[-1]["content"] == "Now"
    system = messages[0]["content"]
    assert "Prefiere Python" in system and "Usa ejemplos en Go" in system and "English" in system


def test_cancellation_propagates():
    async def scenario():
        orch = Orchestrator([A, C], FakeLLM(delay=0.05), Recorder())
        task = asyncio.create_task(orch.run("x"))
        await asyncio.sleep(0.1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    run(scenario())


def test_helpers():
    assert tokens_per_agent(1) > tokens_per_agent(3) > tokens_per_agent(6)
    assert len(compact_summary("línea " * 500)) <= 402
    hist = sanitize_history([{"role": "system", "content": "x"}, {"role": "user", "content": " hola "}, "bad"])
    assert hist == [{"role": "user", "content": "hola"}]
    assert len(sanitize_history([{"role": "user", "content": "x"}] * 50)) == 8


def test_prefilter_finds_relevant_agents():
    ids = [a.id for a in prefilter("optimizar el SEO de mi tienda online y posicionamiento en Google")]
    assert any("seo" in i for i in ids[:10])


def test_suggest_falls_back_without_llm_and_validates_llm_output():
    result = run(suggest_agents("seguridad y pentesting de mi API", None))
    assert 1 <= len(result["agents"]) <= 4

    class BadLLM(FakeLLM):
        async def complete(self, *a, **k):
            return '{"agents": ["no_existe", "fullstack_developer"], "reason": "ok"}'
    result = run(suggest_agents("desarrollar una app web fullstack con backend", BadLLM()))
    assert "no_existe" not in result["agents"]


def test_review_runs_before_synthesis_and_feeds_it():
    rec = Recorder()
    llm = FakeLLM(replies={"Revisor crítico": "- Falta el presupuesto de marketing"})
    orch = Orchestrator([A, C], llm, rec, review=True)
    summary = run(orch.run("Plan de lanzamiento"))
    types = rec.types()
    assert types.index("review_complete") < types.index("synthesis_start")
    assert rec.text_for("reviewer", "review_token") == "- Falta el presupuesto de marketing"
    synth_input = call_with_system(llm, "Coordinador")[-1]["content"]
    assert "Observaciones del Revisor" in synth_input and "presupuesto de marketing" in synth_input
    assert summary["has_review"] is True


def test_review_with_single_agent_still_produces_corrected_answer():
    rec = Recorder()
    run(Orchestrator([A], FakeLLM(), rec, review=True).run("x"))
    assert "review_complete" in rec.types() and "synthesis_complete" in rec.types()


def test_followups_are_suggested_and_can_be_disabled():
    rec = Recorder()
    llm = FakeLLM(replies={"preguntas de seguimiento": '{"questions": ["¿Y el presupuesto?", "¿Qué riesgos hay?", "a", "b"]}'})
    summary = run(Orchestrator([A], llm, rec).run("Plan"))
    assert summary["followups"] == ["¿Y el presupuesto?", "¿Qué riesgos hay?", "a"]
    assert rec.events[-2]["type"] == "followups"

    rec2 = Recorder()
    run(Orchestrator([A], FakeLLM(), rec2, followups=False).run("Plan"))
    assert "followups" not in rec2.types()


def test_bad_followup_json_is_ignored():
    rec = Recorder()
    summary = run(Orchestrator([A], FakeLLM(replies={"preguntas de seguimiento": "no es json"}), rec).run("x"))
    assert summary["followups"] == [] and "followups" not in rec.types()


def test_reasoning_is_streamed_as_thinking_events():
    rec = Recorder()
    run(Orchestrator([A], FakeLLM(thinking="Analizo el pedido paso a paso"), rec, followups=False).run("x"))
    thoughts = [e for e in rec.events if e["type"] == "thinking"]
    assert thoughts and thoughts[0]["agent_id"] == A.id
    assert "".join(e["delta"] for e in thoughts) == "Analizo el pedido paso a paso"
    # el razonamiento no se mezcla con la respuesta
    response = next(e for e in rec.events if e["type"] == "agent_response")["data"]["raw_content"]
    assert "paso a paso" not in response


def test_prefilter_ranks_by_field_and_diversifies():
    from app.services.agent_router import diversified
    security = [a.id for a in prefilter("auditoría de seguridad y pentesting de mi API")[:4]]
    assert "pentester" in security and "security_specialist" in security
    marketing = diversified(prefilter("plan de marketing para lanzar una cafetería"), 4)
    assert marketing[0].category == "marketing"
    assert max(sum(1 for a in marketing if a.category == c) for c in {a.category for a in marketing}) <= 2


def test_reasoning_without_answer_explains_the_cause():
    rec = Recorder()
    llm = FakeLLM(thinking="Pienso y pienso...", replies={A.system_prompt[:40]: ""})
    run(Orchestrator([A], llm, rec, followups=False).run("x"))
    error = next(e for e in rec.events if e["type"] == "agent_error")
    assert "razonando" in error["error"]


def test_prompts_include_todays_date():
    from datetime import datetime, timezone
    llm = FakeLLM()
    run(Orchestrator([A], llm, Recorder(), followups=False).run("x"))
    assert datetime.now(timezone.utc).date().isoformat() in llm.calls[0][0]["content"]
