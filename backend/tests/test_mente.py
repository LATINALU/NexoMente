"""NexoMente: la memoria (Neuromapa) dentro del orquestador y sus rutas."""

import asyncio

from app.agents.catalog import list_agents
from app.services.orchestrator import Orchestrator
from tests.conftest import FakeLLM


class FakeNotes:
    """Sustituto de mente.Memoria: notas fijas y registro de lo que se anota."""

    def __init__(self, notas=None):
        self.notas = notas if notas is not None else [
            {"ruta": "C:/notas/precios.md", "titulo": "Precios", "linea": 3, "contenido": "El termo cuesta 95 MXN."},
        ]
        self.lecturas = []
        self.eventos = []

    async def search(self, consulta):
        self.eventos.append(("search", consulta))
        return self.notas

    async def read(self, agente, rutas):
        self.lecturas.append((agente, rutas))

    async def start(self, largo):
        self.eventos.append(("start", largo))

    async def end(self):
        self.eventos.append(("end",))


class Recorder:
    def __init__(self):
        self.events = []

    async def __call__(self, event):
        self.events.append(event)


AGENTS = list_agents(["fullstack_developer", "seo_specialist"])


def test_notes_become_citable_context_and_sources():
    llm, notes, rec = FakeLLM(), FakeNotes(), Recorder()
    summary = asyncio.run(Orchestrator(AGENTS, llm, rec, followups=False, notes=notes).run("¿Cuánto cuesta el termo?"))
    agent_call = next(c for c in llm.calls if AGENTS[0].system_prompt[:30] in c[0]["content"])
    assert "[N1] Precios (C:/notas/precios.md:3)" in agent_call[-1]["content"]
    assert "El termo cuesta 95 MXN." in agent_call[-1]["content"]
    assert summary["sources"][0] == {"label": "N1", "kind": "note", "title": "Precios", "path": "C:/notas/precios.md",
                                     "line": 3}
    assert any(e["type"] == "context_ready" for e in rec.events)


def test_each_agent_registers_what_it_read_and_the_run_is_bracketed():
    notes = FakeNotes()
    asyncio.run(Orchestrator(AGENTS, FakeLLM(), Recorder(), followups=False, notes=notes).run("termo"))
    assert sorted(a for a, _ in notes.lecturas) == sorted(a.id for a in AGENTS)
    assert all(r == ["C:/notas/precios.md"] for _, r in notes.lecturas)
    assert notes.eventos[0] == ("start", len("termo")) and notes.eventos[-1] == ("end",)


def test_without_matching_notes_nothing_is_added():
    llm, notes = FakeLLM(), FakeNotes(notas=[])
    asyncio.run(Orchestrator(AGENTS[:1], llm, Recorder(), followups=False, notes=notes).run("hola"))
    assert "[N1]" not in llm.calls[0][-1]["content"] and notes.lecturas == []


def test_without_notes_object_the_orchestrator_works_as_before():
    rec = Recorder()
    summary = asyncio.run(Orchestrator(AGENTS[:1], FakeLLM(), rec, followups=False).run("hola"))
    assert summary["sources"] == []


def test_mente_routes_are_local_only():
    from app.routes import mente_routes
    from starlette.testclient import TestClient
    from app.main import app
    local = TestClient(app)
    assert local.get("/api/mente/estado").json()["habilitada"] is True  # TestClient = local
    import pytest
    from types import SimpleNamespace
    from fastapi import HTTPException
    remoto = SimpleNamespace(client=SimpleNamespace(host="203.0.113.9"))
    with pytest.raises(HTTPException) as e:
        mente_routes._exigir_local(remoto)
    assert e.value.status_code == 403
    mente_routes._exigir_local(SimpleNamespace(client=SimpleNamespace(host="127.0.0.1")))  # no falla


def test_session_ids_are_neuromapa_compatible():
    import re
    from app.services import mente
    s = mente.sesion_de("conv_123")
    assert re.fullmatch(r"[0-9a-f]{8}", s) and s == mente.sesion_de("conv_123") != mente.sesion_de("otra")


def test_map_frame_policy_only_allows_local_origins():
    import importlib.util
    from app.services import mente
    spec = importlib.util.spec_from_file_location("_nm_servidor_politica", mente.NEUROMAPA / "servidor.py")
    texto = spec.origin and open(spec.origin, encoding="utf-8").read()
    assert "def marcos_permitidos" in texto
    # Se evalúa la función sola (importar servidor.py arrancaría su configuración)
    import re
    namespace = {"re": re}
    bloque = texto[texto.index("RE_ORIGEN_LOCAL"):texto.index("POLITICA = (")]
    exec(bloque, namespace)
    permitir = namespace["marcos_permitidos"]
    assert permitir("http://localhost:3000 http://127.0.0.1:3000") == "http://localhost:3000 http://127.0.0.1:3000"
    assert permitir("https://evil.example http://localhost:3000;") == "'none'"
    assert permitir("") == "'none'"


def _mente_en(tmp_path, monkeypatch):
    from app.services import mente
    monkeypatch.setattr(mente, "NOTAS", tmp_path / "notas")
    monkeypatch.setattr(mente, "_refrescar_indice", lambda: None)
    return mente


def test_saved_note_has_frontmatter_question_and_links_to_cited_notes(tmp_path, monkeypatch):
    mente = _mente_en(tmp_path, monkeypatch)
    citada = tmp_path / "precios.md"
    citada.write_text("# Precios\n", encoding="utf-8")
    hecho = mente.guardar_nota("¿Cuánto cuesta el termo?", "Cuesta 95 MXN [N1].",
                               [str(citada), str(tmp_path / "no-existe.md"), "C:/x.txt"], pregunta="precio termo")
    assert hecho["nueva"] is True
    ruta = mente.NOTAS / hecho["ruta"].split("\\")[-1].split("/")[-1]
    texto = ruta.read_text(encoding="utf-8")
    assert ruta.name.endswith("-cuanto-cuesta-el-termo.md")
    assert texto.startswith("---\nname: ") and "  type: nexo\n" in texto and "  huella: " in texto
    assert "# ¿Cuánto cuesta el termo?" in texto and "> precio termo" in texto and "Cuesta 95 MXN [N1]." in texto
    assert f"- [precios](<{citada}>)" in texto
    assert "no-existe" not in texto and "x.txt" not in texto


def test_saving_the_same_answer_twice_keeps_one_note(tmp_path, monkeypatch):
    mente = _mente_en(tmp_path, monkeypatch)
    a = mente.guardar_nota("Termo", "Cuesta 95 MXN.")
    b = mente.guardar_nota("Otro título", "  Cuesta 95 MXN.  ")
    c = mente.guardar_nota("Termo", "Cuesta 100 MXN.")
    assert b == {"ruta": a["ruta"], "titulo": "Otro título", "nueva": False}
    assert c["nueva"] and c["ruta"] != a["ruta"]
    assert [n["titulo"] for n in mente.notas_propias()].count("Termo") == 2
    indice = (mente.NOTAS / "MEMORY.md").read_text(encoding="utf-8")
    assert indice.count("- [Termo](") == 2 and len(mente.notas_propias()) == 2


def test_note_needs_title_and_content(tmp_path, monkeypatch):
    import pytest
    mente = _mente_en(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        mente.guardar_nota("   ", "algo")
    with pytest.raises(ValueError):
        mente.guardar_nota("Título", "  ")


def test_notes_route_saves_and_lists(tmp_path, monkeypatch):
    from starlette.testclient import TestClient
    from app.main import app
    _mente_en(tmp_path, monkeypatch)
    cliente = TestClient(app)
    r = cliente.post("/api/mente/notas", json={"titulo": "Plan", "contenido": "Hacer X."})
    assert r.status_code == 200 and r.json()["nueva"] is True
    assert cliente.get("/api/mente/notas").json()["notas"][0]["titulo"] == "Plan"
    assert cliente.post("/api/mente/notas", json={"titulo": "Plan", "contenido": "   "}).status_code == 422


def test_neuromapa_adds_the_app_notes_as_a_source(tmp_path, monkeypatch):
    from app.services import mente
    mente._preparar()
    import configuracion
    monkeypatch.setenv("NEUROMAPA_NOTAS_APP", str(tmp_path))
    fuente = configuracion.fuente_de_la_app([{"id": "memoria"}])
    assert fuente[0]["id"] == "nexo" and fuente[0]["raices"][0][0] == str(tmp_path)
    assert configuracion.fuente_de_la_app([{"id": "nexo"}]) == []
    monkeypatch.delenv("NEUROMAPA_NOTAS_APP")
    assert configuracion.fuente_de_la_app([]) == []
