"""
NexoMente - Rutas de la memoria (Neuromapa)
==========================================
Leen tus notas personales del disco, así que solo existen en una instalación local:
apagadas en producción salvo NEXOMENTE_MENTE=on explícito.
"""

import asyncio
import os
from typing import List

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.config import IS_PRODUCTION
from app.services import mente

router = APIRouter(prefix="/api/mente", tags=["Mente"])

HABILITADA = os.getenv("NEXOMENTE_MENTE", "off" if IS_PRODUCTION else "on").lower() == "on"
LOCALES = {"127.0.0.1", "::1", "localhost", "testclient"}


def _exigir_local(request: Request) -> None:
    if not HABILITADA:
        raise HTTPException(status_code=404, detail="La memoria no está habilitada en esta instalación")
    host = request.client.host if request.client else ""
    if host not in LOCALES:
        raise HTTPException(status_code=403, detail="La memoria solo se usa desde esta computadora")


@router.get("/estado")
async def estado(request: Request):
    """Si la memoria está disponible (sin leer notas: responde al instante)."""
    if not HABILITADA:
        return {"habilitada": False, "disponible": False}
    _exigir_local(request)
    return {"habilitada": True, "disponible": mente.disponible(), "neuromapa": str(mente.NEUROMAPA),
            "datos": str(mente.DATOS)}


@router.get("/salud")
async def salud(request: Request):
    _exigir_local(request)
    try:
        return await asyncio.to_thread(mente.salud)
    except mente.MenteNoDisponible as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/buscar")
async def buscar(request: Request, q: str = Query(..., min_length=2, max_length=500), maximo: int = Query(5, ge=1, le=20)):
    _exigir_local(request)
    try:
        notas = await asyncio.to_thread(mente.buscar_notas, q, maximo)
    except mente.MenteNoDisponible as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"notas": notas}


@router.post("/mapa")
async def mapa(request: Request):
    """Levanta el mapa en vivo (si hace falta) y devuelve una dirección de un solo uso para incrustarlo."""
    _exigir_local(request)
    try:
        return {"url": await asyncio.to_thread(mente.abrir_mapa)}
    except (mente.MenteNoDisponible, OSError) as e:
        raise HTTPException(status_code=503, detail=f"No se pudo abrir el mapa: {e}")


class NotaNueva(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=500)
    contenido: str = Field(..., min_length=1, max_length=200_000)
    fuentes: List[str] = Field(default_factory=list, max_length=50)
    pregunta: str = Field("", max_length=20_000)
    conversacion: str = Field("", max_length=200)


@router.get("/notas")
async def notas(request: Request, maximo: int = Query(50, ge=1, le=200)):
    """Las notas que guardó NexoMente (las tuyas solo se leen)."""
    _exigir_local(request)
    return {"notas": await asyncio.to_thread(mente.notas_propias, maximo)}


@router.post("/notas")
async def guardar(request: Request, nota: NotaNueva):
    """Guarda una respuesta en la memoria: nota nueva en datos-mente/notas, enlazada a las notas que citó."""
    _exigir_local(request)
    try:
        return await asyncio.to_thread(mente.guardar_nota, nota.titulo, nota.contenido, nota.fuentes, nota.pregunta,
                                       nota.conversacion)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except (mente.MenteNoDisponible, OSError) as e:
        raise HTTPException(status_code=503, detail=f"No se pudo guardar la nota: {e}")
