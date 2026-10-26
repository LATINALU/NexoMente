"""
Nexo - Equipos de agentes IA · FastAPI server
=======================================
Punto de entrada: catálogo de agentes, WebSocket de chat con streaming,
SSE como alternativa y routers de auth / historial / memoria / admin.
"""
import asyncio
import json
import logging
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from slowapi.errors import RateLimitExceeded

from app.config import (
    CORS_ALLOW_CREDENTIALS, CORS_ALLOW_HEADERS, CORS_ALLOW_METHODS, CORS_MAX_AGE,
    CORS_ORIGINS, DEBUG, HOST, MODELS, PORT, REDIS_URL,
)
from app.api_models import ModelFetchError, fetch_available_models
from app.auth import get_optional_user, require_admin, user_from_token
from app.middleware.rate_limiter import init_redis, limiter
from app.validators import SecurityValidator

from app.agents.catalog import (
    AGENT_DEFINITIONS, CATEGORIES, AgentSpec, get_agent, get_agent_count, get_agents_by_category, list_agents,
)
from app.websocket_manager import manager
from app.services.agent_router import suggest_agents
from app.services.llm_client import REASONING_LEVELS, LLMClient
from app.services.documents import Embedder, load_documents
from app.services.orchestrator import Orchestrator, sanitize_history
from app.services.web_search import validate_search_config
from app.services.online_users_tracker import get_tracker

import sys  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:  # la consola de Windows (cp1252) no soporta los emojis de los logs
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
logging.basicConfig(
    level=logging.DEBUG if DEBUG else logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("nexo")

APP_VERSION = "1.0.0"
MAX_MESSAGE_LENGTH = 10000
MAX_AGENTS_PER_RUN = 10
PIPELINES_PER_MINUTE = 10


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Nexo %s iniciando: %d agentes en %d categorías", APP_VERSION, get_agent_count(), len(CATEGORIES))
    from app.pg_database import pg_db

    async def init_postgres():
        try:
            await pg_db.initialize()
        except Exception as e:
            logger.error("PostgreSQL no disponible (%s). Historial y cuentas deshabilitados.", e)

    # Los servicios son independientes: se conectan en paralelo
    await asyncio.gather(init_postgres(), init_redis(), get_tracker(REDIS_URL).connect())
    yield
    await pg_db.close()


app = FastAPI(title="Nexo - Equipos de agentes IA", version=APP_VERSION, lifespan=lifespan)
app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=CORS_ALLOW_METHODS,
    allow_headers=CORS_ALLOW_HEADERS,
    max_age=CORS_MAX_AGE,
)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exception_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"error": "Rate limit exceeded", "message": "Demasiadas solicitudes. Intenta en un minuto."},
        headers={"Retry-After": "60"},
    )


# ============================================================================
# Catálogo
# ============================================================================

def _agent_payload(agent_id: str, info: Dict[str, Any], include_category: bool = True) -> Dict[str, Any]:
    data = {
        "id": agent_id,
        "name": info["name"],
        "description": info["description"],
        "emoji": info.get("emoji", "🤖"),
        "capabilities": info.get("capabilities", []),
        "specialization": info.get("specialization", ""),
        "complexity": info.get("complexity", "intermediate"),
    }
    if include_category:
        data["category"] = info.get("category", "general")
    return data


@app.get("/api/health")
@limiter.limit("100/minute")
async def health_check(request: Request):
    from app.pg_database import pg_db
    return {
        "status": "healthy",
        "version": APP_VERSION,
        "agents_count": len(AGENT_DEFINITIONS),
        "database": pg_db._pool is not None,
    }


@app.get("/api/agents")
@limiter.limit("60/minute")
async def get_agents(request: Request, category: Optional[str] = None):
    defs = get_agents_by_category(category) if category else AGENT_DEFINITIONS
    agents = [_agent_payload(agent_id, info) for agent_id, info in defs.items()]
    return {"agents": agents, "total": len(agents)}


@app.get("/api/agents/{agent_id}")
async def get_agent_detail(agent_id: str):
    spec = get_agent(agent_id)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Agente {agent_id} no encontrado")
    cat = CATEGORIES.get(spec.category, {})
    return {**spec.to_public_dict(), "full_description": spec.description, "backstory": spec.backstory,
            "category_name": cat.get("name", spec.category), "response_format": spec.response_format}


@app.get("/api/categories")
@limiter.limit("60/minute")
async def get_categories(request: Request):
    categories = [
        {"id": cat_id, "name": c["name"], "emoji": c["emoji"], "description": c["description"],
         "color": c["color"], "agents_count": c["agents_count"]}
        for cat_id, c in CATEGORIES.items()
    ]
    categories.sort(key=lambda c: c["name"].lower())
    return {"categories": categories, "total": len(categories)}


@app.get("/api/categories/{category_id}")
async def get_category(category_id: str):
    cat = CATEGORIES.get(category_id)
    if not cat:
        raise HTTPException(status_code=404, detail=f"Categoría {category_id} no encontrada")
    agents = [_agent_payload(a, info, include_category=False) for a, info in get_agents_by_category(category_id).items()]
    return {"id": category_id, "name": cat["name"], "emoji": cat["emoji"], "description": cat["description"],
            "color": cat["color"], "agents": agents, "agents_count": len(agents)}


@app.get("/api/models")
async def get_models():
    return {"models": [{"id": mid, "provider": c["provider"], "model": c["model"]} for mid, c in MODELS.items()]}


class FetchModelsRequest(BaseModel):
    api_type: str = Field(..., max_length=30)
    api_key: str = Field("", max_length=300)
    base_url: Optional[str] = Field(None, max_length=500)


@app.post("/api/fetch-models")
@limiter.limit("20/minute")
async def fetch_models(request: Request, body: FetchModelsRequest):
    """Lista los modelos disponibles para la API key del usuario."""
    try:
        models = await fetch_available_models(body.api_type, body.api_key, body.base_url)
    except ModelFetchError as e:
        return {"success": False, "models": [], "error": str(e)}
    if not models:
        return {"success": False, "models": [], "error": "No se encontraron modelos disponibles"}
    return {"success": True, "models": models, "count": len(models)}


# ============================================================================
# Chat: preparación común WebSocket / SSE
# ============================================================================

class ChatInputError(ValueError):
    """Error de validación presentable al usuario."""


@dataclass
class ChatRun:
    """Parámetros normalizados de una ejecución de chat."""
    message: str
    agents: List[AgentSpec]
    model: str
    llm: LLMClient
    language: str
    mode: str
    synthesize: bool
    history: List[Dict[str, str]]
    agent_instructions: Dict[str, str]
    document_ids: List[str]
    web_search: Optional[Dict[str, str]]
    embedder: Optional[Embedder]
    tool_mode: str
    review: bool
    followups: bool


def _build_llm(api_config: Optional[Dict], model: str, reasoning: Any = None) -> LLMClient:
    parsed = SecurityValidator.validate_api_config(api_config) if api_config else {}
    if not parsed:
        raise ChatInputError("Configura una API key válida en Ajustes antes de chatear")
    # "auto" (o ausente) deja el razonamiento a criterio del proveedor
    return LLMClient(parsed, SecurityValidator.validate_model_name(model),
                     reasoning=reasoning if reasoning in REASONING_LEVELS else None)


def _build_embedder(cfg: Any) -> Optional[Embedder]:
    """`embeddings`: {type, apiKey, baseUrl, model} — búsqueda semántica opcional sobre documentos."""
    if not isinstance(cfg, dict) or not cfg.get("model"):
        return None
    parsed = SecurityValidator.validate_api_config(cfg)
    if not parsed:
        return None
    model = SecurityValidator.validate_model_name(cfg["model"])
    return Embedder(LLMClient(parsed, model), model)


def _prepare_chat(data: Dict[str, Any]) -> ChatRun:
    message = SecurityValidator.sanitize_text(str(data.get("message") or ""), max_length=MAX_MESSAGE_LENGTH)
    if not message:
        raise ChatInputError("El mensaje no puede estar vacío")
    agent_ids = data.get("agents") if isinstance(data.get("agents"), list) else []
    agents = list_agents([a for a in agent_ids if isinstance(a, str)])[:MAX_AGENTS_PER_RUN]
    if not agents:
        raise ChatInputError("Selecciona al menos un agente válido")
    model = str(data.get("model") or "")
    instructions = data.get("agentInstructions") if isinstance(data.get("agentInstructions"), dict) else {}
    return ChatRun(
        message=message,
        agents=agents,
        model=model,
        llm=_build_llm(data.get("apiConfig"), model, data.get("reasoning")),
        language=data.get("language") if data.get("language") in ("es", "en") else "es",
        mode=data.get("mode") if data.get("mode") in ("parallel", "sequential") else "parallel",
        synthesize=data.get("synthesize", True) is not False,
        history=sanitize_history(data.get("history")),
        agent_instructions={k: str(v) for k, v in instructions.items() if isinstance(k, str) and v},
        document_ids=[d for d in (data.get("documents") or []) if isinstance(d, str)][:10],
        web_search=validate_search_config(data.get("webSearch")) if data.get("webSearch") else None,
        embedder=_build_embedder(data.get("embeddings")) if data.get("documents") else None,
        tool_mode="native" if data.get("toolMode") == "native" else "prefetch",
        review=data.get("review") is True,
        followups=data.get("followups", True) is not False,
    )


async def _orchestrator(run: ChatRun, emit, user: Optional[Dict[str, Any]]) -> Orchestrator:
    user_id = str(user["user_id"]) if user else None
    documents = await load_documents(run.document_ids, user_id) if run.document_ids else []
    if run.document_ids and len(documents) < len(set(run.document_ids)):
        await emit({"type": "warning", "message": "Algunos documentos adjuntos ya no están disponibles"})
    return Orchestrator(run.agents, run.llm, emit, language=run.language, mode=run.mode,
                        synthesize=run.synthesize, memory_context=await _load_memory(user), history=run.history,
                        agent_instructions=run.agent_instructions, documents=documents,
                        web_search_config=run.web_search, embedder=run.embedder, tool_mode=run.tool_mode,
                        review=run.review, followups=run.followups)


async def _load_memory(user: Optional[Dict[str, Any]]) -> str:
    if not user:
        return ""
    try:
        from app.pg_database import pg_db
        if pg_db._pool:
            return await pg_db.get_memory_context(str(user["user_id"]))
    except Exception as e:
        logger.warning("No se pudo cargar memoria: %s", e)
    return ""


# ============================================================================
# WebSocket
# ============================================================================

def _detect_device_type(user_agent: str) -> str:
    ua = user_agent.lower()
    if any(k in ua for k in ("mobile", "android", "iphone", "ipod", "blackberry", "windows phone")):
        return "mobile"
    if any(k in ua for k in ("ipad", "tablet", "kindle")):
        return "tablet"
    return "desktop"


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    """
    Chat en tiempo real. Invitados pueden chatear (historial solo local);
    con token de acceso válido en el mensaje se carga memoria y se persiste.
    El token nunca viaja en la URL.
    """
    if not CORS_ORIGINS or websocket.headers.get("origin") not in CORS_ORIGINS + [None]:
        # Los navegadores siempre mandan Origin: bloquea sitios de terceros
        await websocket.close(code=1008)
        return

    session_id = f"ws_{uuid.uuid4().hex}"
    user: Optional[Dict[str, Any]] = None
    recent_runs: deque = deque()
    running_task: Optional[asyncio.Task] = None

    user_agent = websocket.headers.get("user-agent", "")
    await manager.connect(websocket, session_id, {"device_type": _detect_device_type(user_agent)})
    tracker = get_tracker()
    await tracker.add_user(
        user_id=f"guest_{session_id[3:11]}", session_id=session_id, client_id=client_id[:64],
        ip_address=websocket.client.host if websocket.client else None,
        user_agent=user_agent, device_type=_detect_device_type(user_agent),
    )
    await manager.send_json(session_id, {"type": "connected", "timestamp": datetime.now(timezone.utc).isoformat()})

    async def emit(event: Dict[str, Any]) -> None:
        await manager.send_json(session_id, event)

    async def run_pipeline(data: Dict[str, Any]):
        try:
            run = _prepare_chat(data)
        except ChatInputError as e:
            await emit({"type": "error", "message": str(e)})
            return
        except Exception:
            # Sin este aviso el cliente quedaría esperando una consulta que nunca empezó
            logger.exception("Error preparando la consulta")
            await emit({"type": "error", "message": "Error interno preparando la consulta"})
            return
        if len(str(data.get("message") or "")) > MAX_MESSAGE_LENGTH:
            await emit({"type": "warning", "message": f"Mensaje truncado a {MAX_MESSAGE_LENGTH} caracteres"})

        orchestrator = await _orchestrator(run, emit, user)
        try:
            await orchestrator.run(run.message)
        except asyncio.CancelledError:
            await emit({"type": "pipeline_cancelled"})
            raise
        except Exception:
            logger.exception("Error ejecutando agentes")
            await emit({"type": "error", "message": "Error interno ejecutando los agentes"})
            return
        # El historial lo persiste el cliente (POST /api/history) para conservar las ramas

    try:
        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue
            action = data.get("action")

            # Autenticación opcional: el token viaja en el cuerpo del mensaje
            if "token" in data:
                user = user_from_token(data.get("token"))

            if action == "start_pipeline":
                if running_task and not running_task.done():
                    await manager.send_json(session_id, {"type": "error", "message": "Ya hay una consulta en curso"})
                    continue
                now = time.monotonic()
                while recent_runs and now - recent_runs[0] > 60:
                    recent_runs.popleft()
                if len(recent_runs) >= PIPELINES_PER_MINUTE:
                    await manager.send_json(session_id, {"type": "error",
                                                         "message": "Demasiadas consultas. Espera un minuto."})
                    continue
                recent_runs.append(now)
                running_task = asyncio.create_task(run_pipeline(data))

            elif action == "cancel":
                if running_task and not running_task.done():
                    running_task.cancel()

            elif action == "auth":
                await manager.send_json(session_id, {"type": "auth", "authenticated": user is not None})

            elif action == "ping":
                await manager.send_json(session_id, {"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()})

            else:
                await manager.send_json(session_id, {"type": "error", "message": "Acción desconocida"})

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Error en WebSocket %s", session_id)
    finally:
        if running_task and not running_task.done():
            running_task.cancel()
        manager.disconnect(session_id)
        await tracker.remove_user(session_id)


# ============================================================================
# SSE (alternativa a WebSocket)
# ============================================================================

class StreamingChatRequest(BaseModel):
    message: str = Field(..., max_length=MAX_MESSAGE_LENGTH * 2)
    agents: List[str] = Field(..., max_length=20)
    model: str = Field("", max_length=100)
    apiConfig: Optional[Dict[str, Any]] = None
    language: str = "es"
    mode: str = "parallel"
    synthesize: bool = True
    history: List[Dict[str, Any]] = Field(default_factory=list, max_length=50)
    agentInstructions: Dict[str, str] = Field(default_factory=dict)
    documents: List[str] = Field(default_factory=list, max_length=10)
    webSearch: Optional[Dict[str, Any]] = None
    embeddings: Optional[Dict[str, Any]] = None
    toolMode: str = "prefetch"
    review: bool = False
    followups: bool = True
    reasoning: str = "auto"


@app.post("/api/chat-stream")
@limiter.limit(f"{PIPELINES_PER_MINUTE}/minute")
async def chat_stream(request: Request, body: StreamingChatRequest,
                      user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    """Mismo flujo que el WebSocket, como Server-Sent Events."""
    try:
        run = _prepare_chat(body.model_dump())
    except ChatInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: Dict[str, Any]) -> None:
        await queue.put(event)

    async def produce():
        try:
            await (await _orchestrator(run, emit, user)).run(run.message)
        except Exception:
            logger.exception("Error en SSE")
            await queue.put({"type": "error", "message": "Error interno ejecutando los agentes"})
        finally:
            await queue.put(None)

    async def event_stream():
        task = asyncio.create_task(produce())
        try:
            while (event := await queue.get()) is not None:
                yield f"data: {json.dumps(event, default=str)}\n\n"
            yield f"data: {json.dumps({'type': 'stream_complete'})}\n\n"
        finally:
            task.cancel()  # el cliente cerró la conexión

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class SuggestAgentsRequest(BaseModel):
    message: str = Field(..., min_length=3, max_length=MAX_MESSAGE_LENGTH)
    apiConfig: Optional[Dict[str, Any]] = None
    model: str = Field("", max_length=100)
    language: str = "es"
    max_agents: int = Field(4, ge=1, le=MAX_AGENTS_PER_RUN)


@app.post("/api/agents/suggest")
@limiter.limit("20/minute")
async def suggest_agents_endpoint(request: Request, body: SuggestAgentsRequest):
    """Propone un equipo de agentes para la consulta (usa el LLM del usuario si está configurado)."""
    try:
        llm = _build_llm(body.apiConfig, body.model) if body.apiConfig else None
    except ChatInputError:
        llm = None
    result = await suggest_agents(body.message, llm, body.max_agents, body.language)
    result["agents"] = [AGENT_DEFINITIONS[a] for a in result["agents"]]
    return result


class WebSearchTestRequest(BaseModel):
    webSearch: Dict[str, Any]


@app.post("/api/web-search/test")
@limiter.limit("10/minute")
async def test_web_search(request: Request, body: WebSearchTestRequest):
    """Verifica la configuración del buscador con una consulta de prueba."""
    from app.services import web_search
    cfg = validate_search_config(body.webSearch)
    if not cfg:
        return {"success": False, "error": "Configuración incompleta o URL no permitida"}
    try:
        results = await web_search.search(cfg, ["Nexo multi-agent AI"])
    except web_search.WebSearchError as e:
        return {"success": False, "error": str(e)}
    return {"success": True, "results": len(results)}


@app.get("/api/ws-stats")
async def get_websocket_stats(_admin: Dict[str, Any] = Depends(require_admin)):
    return manager.get_stats()


# ============================================================================
# Routers
# ============================================================================
from app.routes.auth_routes import router as auth_router  # noqa: E402
from app.routes.history_routes import router as history_router  # noqa: E402
from app.routes.memory_routes import router as memory_router  # noqa: E402
from app.routes.admin_routes import router as admin_router  # noqa: E402
from app.routes.document_routes import router as document_router  # noqa: E402
from app.routes.team_routes import router as team_router  # noqa: E402
from app.routes.share_routes import router as share_router  # noqa: E402

app.include_router(auth_router)
app.include_router(history_router)
app.include_router(memory_router)
app.include_router(admin_router)
app.include_router(document_router)
app.include_router(team_router)
app.include_router(share_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
