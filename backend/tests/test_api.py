import pytest
from fastapi.testclient import TestClient

import app.main as main
from tests.conftest import FakeLLM

API_CONFIG = {"type": "groq", "apiKey": "gsk_" + "x" * 40}


@pytest.fixture(scope="module")
def client():
    mp = pytest.MonkeyPatch()
    mp.setattr(main, "LLMClient", lambda cfg, model, **kw: FakeLLM())
    with TestClient(main.app) as c:  # sin DB ni Redis: el lifespan degrada a memoria
        yield c
    mp.undo()


def test_catalog_endpoints(client):
    assert client.get("/api/health").json()["agents_count"] == 500
    cats = client.get("/api/categories").json()
    assert cats["total"] == 50
    names = [c["name"].lower() for c in cats["categories"]]
    assert names == sorted(names)
    one = client.get("/api/agents", params={"category": "legal"}).json()
    assert one["total"] == 10 and all(a["category"] == "legal" for a in one["agents"])
    assert client.get("/api/agents/no_existe").status_code == 404


def test_removed_insecure_endpoints_are_gone(client):
    assert client.get("/api/chat/conversations", params={"client_id": "x"}).status_code == 404
    assert client.post("/api/chat", json={}).status_code in (404, 405)


def test_protected_endpoints_require_auth(client):
    for path in ("/api/history/", "/api/memory/", "/api/auth/me", "/api/ws-stats", "/api/admin/stats/system"):
        assert client.get(path).status_code == 401, path


def test_fetch_models_blocks_ssrf(client):
    r = client.post("/api/fetch-models", json={"api_type": "custom", "api_key": "k",
                                              "base_url": "http://169.254.169.254/latest"})
    assert r.json() == {"success": False, "models": [], "error": "URL base no permitida"}


def test_websocket_full_run_with_synthesis(client):
    with client.websocket_connect("/ws/test-client") as ws:
        assert ws.receive_json()["type"] == "connected"
        ws.send_json({"action": "start_pipeline", "message": "Crear landing page", "apiConfig": API_CONFIG,
                      "agents": ["fullstack_developer", "seo_specialist"], "model": "llama-3.3-70b-versatile"})
        events = []
        while True:
            event = ws.receive_json()
            events.append(event)
            if event["type"] in ("pipeline_complete", "error"):
                break
    types = [e["type"] for e in events]
    assert "error" not in types
    assert types.count("agent_response") == 2 and "synthesis_complete" in types
    assert "agent_token" in types and "synthesis_token" in types


def test_websocket_rejects_missing_api_key_and_foreign_origin(client):
    with client.websocket_connect("/ws/c") as ws:
        ws.receive_json()
        ws.send_json({"action": "start_pipeline", "message": "hola", "agents": ["fullstack_developer"]})
        event = ws.receive_json()
        assert event["type"] == "error" and "API key" in event["message"]

    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/c", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_sse_stream(client):
    with client.stream("POST", "/api/chat-stream", json={
            "message": "Plan de marketing", "agents": ["seo_specialist"], "apiConfig": API_CONFIG}) as r:
        body = "".join(r.iter_text())
    assert '"type": "agent_response"' in body and '"type": "stream_complete"' in body


def test_suggest_agents_without_llm(client):
    r = client.post("/api/agents/suggest", json={"message": "auditoría de seguridad y pentesting web"})
    agents = r.json()["agents"]
    assert agents and all("id" in a and "name" in a for a in agents)


def test_agent_detail_includes_backstory_but_not_prompt(client):
    data = client.get("/api/agents/fullstack_developer").json()
    assert data["backstory"] and data["category_name"]
    assert "system_prompt" not in data


def test_document_upload_use_and_delete(client):
    r = client.post("/api/documents", files={"file": ("politica.txt", "Las devoluciones se aceptan por 45 días.".encode(), "text/plain")})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["name"] == "politica.txt" and doc["chunks"] == 1
    assert client.get(f"/api/documents/{doc['id']}").status_code == 200
    assert client.get("/api/documents/no-es-uuid").status_code == 404

    with client.websocket_connect("/ws/doc-client") as ws:
        ws.receive_json()
        ws.send_json({"action": "start_pipeline", "message": "¿Cuántos días hay para devolver?",
                      "apiConfig": API_CONFIG, "agents": ["fullstack_developer"], "documents": [doc["id"]]})
        events = []
        while (e := ws.receive_json())["type"] != "pipeline_complete":
            events.append(e)
    ctx = next(e for e in events if e["type"] == "context_ready")
    assert ctx["sources"][0]["title"] == "politica.txt"

    assert client.delete(f"/api/documents/{doc['id']}").json() == {"deleted": True}
    assert client.get(f"/api/documents/{doc['id']}").status_code == 404


def test_document_upload_rejects_bad_type(client):
    r = client.post("/api/documents", files={"file": ("virus.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 400


def test_teams_require_auth_and_validate(client):
    assert client.get("/api/teams").status_code == 401
    from app.routes.team_routes import TeamIn
    team = TeamIn(name="Lanzamiento", agents=["seo_specialist", "nope", "seo_specialist"],
                  mode="raro", instructions={"seo_specialist": "foco LATAM", "nope": "x"})
    assert team.agents == ["seo_specialist"] and team.mode == "parallel"
    assert team.instructions == {"seo_specialist": "foco LATAM"}
    with pytest.raises(Exception):
        TeamIn(name="x", agents=["nope"])


def test_web_search_test_endpoint(client, monkeypatch):
    from app.services import web_search
    assert client.post("/api/web-search/test", json={"webSearch": {"provider": "nope"}}).json()["success"] is False

    async def fake(cfg, queries):
        return [{"label": "W1", "title": "t", "url": "https://x.com", "content": ""}]
    monkeypatch.setattr(web_search, "search", fake)
    r = client.post("/api/web-search/test", json={"webSearch": {"provider": "tavily", "apiKey": "tvly-x"}})
    assert r.json() == {"success": True, "results": 1}


def test_upload_image_with_ocr_config(client, monkeypatch):
    from app.routes import document_routes
    from tests.test_documents_web import VisionLLM, _png
    monkeypatch.setattr(document_routes, "LLMClient", lambda cfg, model: VisionLLM())
    import json as _json
    ocr = _json.dumps({**API_CONFIG, "model": "meta-llama/llama-4-scout-17b-16e-instruct"})
    r = client.post("/api/documents", files={"file": ("ticket.png", _png(), "image/png")}, data={"ocr": ocr})
    assert r.status_code == 200, r.text
    assert r.json()["ocr"] is True


def test_chat_accepts_embeddings_and_tool_mode(client):
    with client.websocket_connect("/ws/opts") as ws:
        ws.receive_json()
        ws.send_json({"action": "start_pipeline", "message": "hola", "apiConfig": API_CONFIG,
                      "agents": ["fullstack_developer"], "toolMode": "native",
                      "embeddings": {**API_CONFIG, "model": "text-embedding-3-small"}})
        start = ws.receive_json()
        while start["type"] != "pipeline_start":
            start = ws.receive_json()
        assert start["tool_mode"] == "prefetch"  # sin documentos ni web no hay herramientas que ofrecer
        while ws.receive_json()["type"] not in ("pipeline_complete", "error"):
            pass


def test_share_create_read_and_revoke(client):
    body = {"title": "Plan SaaS", "turns": [{
        "question": "¿Cómo lanzo?", "answers": [{"name": "Coordinador", "content": "Así **lanzas**", "is_synthesis": True}],
        "sources": [{"label": "W1", "kind": "web", "title": "Guía", "url": "javascript:alert(1)"}]}]}
    created = client.post("/api/shares", json=body).json()
    share_id, key = created["id"], created["owner_key"]

    shared = client.get(f"/api/shares/{share_id}").json()
    assert shared["title"] == "Plan SaaS" and shared["views"] == 1
    assert shared["turns"][0]["sources"][0]["url"] is None  # se descartan esquemas peligrosos

    assert client.delete(f"/api/shares/{share_id}").status_code == 403
    assert client.delete(f"/api/shares/{share_id}", headers={"X-Share-Key": "otra"}).status_code == 403
    assert client.delete(f"/api/shares/{share_id}", headers={"X-Share-Key": key}).json() == {"revoked": True}
    assert client.get(f"/api/shares/{share_id}").status_code == 404


def test_share_validation(client):
    assert client.post("/api/shares", json={"title": "x", "turns": []}).status_code == 422
    assert client.get("/api/shares/" + "a" * 40).status_code == 404
