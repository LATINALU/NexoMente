"""
NexoMente - Rutas de la memoria (Neuromapa)
==========================================
Leen tus notas personales del disco, así que solo existen en una instalación local:
apagadas en producción salvo NEXOMENTE_MENTE=on explícito.
"""

import asyncio
import os

from fastapi import APIRouter, HTTPException, Query, Request

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
