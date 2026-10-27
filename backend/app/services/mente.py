"""
NexoMente - Puente con Neuromapa
================================
Neuromapa (carpeta neuromapa/, Python estándar) es la memoria de NexoMente:
- buscar_notas(): el buscador BM25 de Neuromapa sobre tus notas (memoria de Claude Code,
  CLAUDE.md y las fuentes de su config.json) para darles contexto citable [N#] a los agentes.
- registrar_*(): anota en el registro en vivo de Neuromapa qué notas lee cada agente, así el
  cerebro 3D muestra la actividad de Nexo igual que la de Claude Code.
- salud(): el resumen del médico (datos viejos, enlaces rotos…).
- abrir_mapa(): levanta el servidor del mapa (si no está) y devuelve una dirección de un solo uso
  para incrustarlo en la app.

Todo es local: Neuromapa nunca sale de la computadora y no escribe en tus notas.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("nexo.mente")

RAIZ = Path(__file__).resolve().parents[3]
NEUROMAPA = Path(os.environ.get("NEXOMENTE_NEUROMAPA") or RAIZ / "neuromapa").resolve()
DATOS = Path(os.environ.get("NEXOMENTE_DATOS") or RAIZ / "datos-mente").resolve()
# Orígenes que pueden incrustar el mapa (la app web). Solo direcciones locales.
ORIGENES_APP = os.environ.get("NEXOMENTE_ORIGENES", "http://localhost:3000 http://127.0.0.1:3000")

MAX_NOTAS = 5
CARACTERES_POR_NOTA = 1400
RENGLONES_POR_PASAJE = 30
ESPERA_SERVIDOR_S = 20

_lock = threading.Lock()
_importado = False


class MenteNoDisponible(RuntimeError):
    pass


def _preparar() -> None:
    """Configura el entorno de Neuromapa (antes de importarlo: sus módulos leen la carpeta al cargar)."""
    global _importado
    if _importado:
        return
    with _lock:
        if _importado:
            return
        if not (NEUROMAPA / "buscador.py").is_file():
            raise MenteNoDisponible(f"No se encontró Neuromapa en {NEUROMAPA}")
        DATOS.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("CLAUDE_PLUGIN_OPTION_CARPETA_DATOS", str(DATOS))
        if str(NEUROMAPA) not in sys.path:
            sys.path.insert(0, str(NEUROMAPA))
        _importado = True


def disponible() -> bool:
    try:
        _preparar()
        return True
    except MenteNoDisponible:
        return False


def _en_vivo() -> Path:
    return DATOS / "en-vivo"


# ---------------------------------------------------------------- búsqueda

def _pasaje(ruta: str, linea: int) -> str:
    """El tramo de la nota desde la sección encontrada (lo que lee el agente)."""
    try:
        renglones = Path(ruta).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    inicio = max(0, linea - 1)
    texto = "\n".join(renglones[inicio:inicio + RENGLONES_POR_PASAJE]).strip()
    return texto[:CARACTERES_POR_NOTA] + ("…" if len(texto) > CARACTERES_POR_NOTA else "")


def buscar_notas(consulta: str, maximo: int = MAX_NOTAS) -> List[Dict[str, Any]]:
    """Notas relevantes para la consulta: [{ruta, titulo, linea, contenido, puntaje}]. Bloqueante."""
    _preparar()
    import buscador  # noqa: E402 (Neuromapa, cargado tras _preparar)
    indice = buscador.desde_disco(guardado=True, esperar=True)
    resultado = indice.buscar(consulta, maximo)
    notas = []
    for r in resultado.get("resultados") or []:
        secciones = r.get("secciones") or []
        linea = int(secciones[0].get("linea") or 1) if secciones else 1
        contenido = _pasaje(r["ruta"], linea) or (secciones[0].get("fragmento", "") if secciones else "")
        if not contenido:
            continue
        notas.append({"ruta": r["ruta"], "titulo": r.get("titulo") or Path(r["ruta"]).stem, "linea": linea,
                      "contenido": contenido, "puntaje": r.get("puntaje", 0), "descripcion": r.get("descripcion", "")})
    return notas


# ---------------------------------------------------------- registro en vivo

def sesion_de(conversacion: str) -> str:
    """Neuromapa identifica cada chat con 8 caracteres hexadecimales."""
    return hashlib.sha1(f"nexo:{conversacion}".encode("utf-8")).hexdigest()[:8]


_NOMBRE = re.compile(r"[^\w.:\-]")


def _evento(sesion: str, fase: str, tipo: str, **extra: Any) -> Dict[str, Any]:
    evento = {"t": round(time.time(), 3), "s": sesion, "e": fase, "h": "", "k": tipo, "c": str(RAIZ)}
    evento.update({k: v for k, v in extra.items() if v not in (None, "")})
    return evento


def _escribir(eventos: List[Dict[str, Any]]) -> None:
    _preparar()
    import hook_evento  # noqa: E402
    for evento in eventos:
        hook_evento.escribir_evento(evento)


def registrar_pedido(conversacion: str, largo: int) -> None:
    """La consulta del usuario (solo su largo: nunca el texto, como hace Neuromapa)."""
    _seguro(lambda: _escribir([_evento(sesion_de(conversacion), "usuario", "usuario", n=largo)]))


def registrar_lecturas(conversacion: str, agente: str, rutas: List[str]) -> None:
    """Un agente de Nexo leyó estas notas: en el cerebro se iluminan con su nombre."""
    nombre = _NOMBRE.sub("_", agente)[:40] or "nexo"
    sesion = sesion_de(conversacion)
    _seguro(lambda: _escribir([_evento(sesion, "post", "leer", h="Read", f=ruta[:300], a=nombre, at="nexo")
                               for ruta in rutas]))


def registrar_fin(conversacion: str) -> None:
    _seguro(lambda: _escribir([_evento(sesion_de(conversacion), "fin", "fin")]))


def _seguro(accion) -> None:
    """El registro es un extra: si falla, la consulta sigue."""
    try:
        accion()
    except Exception as e:  # pragma: no cover - depende del disco
        logger.info("No se pudo anotar en Neuromapa: %s", e)


# --------------------------------------------------------------------- salud

def salud() -> Dict[str, Any]:
    """Resumen del médico: notas y hallazgos por tono (peligro, aviso, revisar, info). Bloqueante."""
    _preparar()
    import cerebro as nucleo  # noqa: E402
    import medico  # noqa: E402
    cerebro = nucleo.desde_disco()
    hallazgos = medico.revisar(cerebro)
    por_tono = {tono: 0 for tono in medico.TONOS}
    for h in hallazgos:
        if isinstance(h, dict) and h.get("tono") in por_tono:
            por_tono[h["tono"]] += 1
    destacados = [{"tono": h["tono"], "texto": h.get("texto", ""), "nota": h.get("nota", ""), "linea": h.get("linea")}
                  for h in hallazgos if isinstance(h, dict) and h.get("tono") in ("peligro", "aviso")][:8]
    return {"notas": len(cerebro.nodos), "hallazgos": por_tono, "destacados": destacados}


# ---------------------------------------------------------------------- mapa

def _leer_json(ruta: Path) -> Dict[str, Any]:
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        return datos if isinstance(datos, dict) else {}
    except (OSError, ValueError):
        return {}


def _servidor_vivo() -> Optional[int]:
    _preparar()
    import donde  # noqa: E402
    anotado = _leer_json(_en_vivo() / "servidor.json")
    if anotado.get("puerto") and donde.proceso_vivo(anotado.get("pid")):
        return int(anotado["puerto"])
    return None


def _arrancar_servidor() -> int:
    entorno = dict(os.environ, NEUROMAPA_MARCOS=ORIGENES_APP, PYTHONIOENCODING="utf-8")
    banderas = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    subprocess.Popen([sys.executable, str(NEUROMAPA / "servidor.py"), "--sin-navegador"], cwd=str(NEUROMAPA),
                     env=entorno, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=banderas)
    hasta = time.monotonic() + ESPERA_SERVIDOR_S
    while time.monotonic() < hasta:
        puerto = _servidor_vivo()
        if puerto:
            return puerto
        time.sleep(0.3)
    raise MenteNoDisponible("El servidor del mapa no arrancó a tiempo")


def _clave() -> str:
    """La clave del mapa. El servidor la crea recién con el primer pedido; si todavía no existe, la creamos
    con sus mismas reglas (carpeta cerrada, escritura atómica) y él la lee la primera vez que la necesita."""
    import secrets
    import permisos  # noqa: E402
    from archivos import escribir_atomico  # noqa: E402
    archivo = _en_vivo() / "clave.txt"
    try:
        guardada = archivo.read_text(encoding="utf-8").strip()
    except OSError:
        guardada = ""
    if len(guardada) < 20:
        guardada = secrets.token_urlsafe(24)
        permisos.crear(_en_vivo())
        escribir_atomico(archivo, guardada)
    return guardada


def _pedir_entrada(puerto: int) -> Optional[str]:
    import firmas  # noqa: E402
    clave = _clave()
    camino = "/entrada"
    conexion = http.client.HTTPConnection("127.0.0.1", puerto, timeout=3)
    try:
        conexion.request("GET", camino, headers={"Host": f"127.0.0.1:{puerto}",
                                                 "X-Cerebro-Firma": firmas.del_pedido(clave, camino)})
        respuesta = conexion.getresponse()
        datos = json.loads(respuesta.read().decode("utf-8")) if respuesta.status == 200 else {}
    except (OSError, ValueError, http.client.HTTPException):
        return None
    finally:
        conexion.close()
    numero = datos.get("entrada") if isinstance(datos, dict) else None
    return numero if isinstance(numero, str) else None


def abrir_mapa() -> str:
    """Dirección de un solo uso del mapa en vivo. `localhost` (no 127.0.0.1): mismo sitio que la app,
    así la galleta de sesión del mapa funciona adentro del marco."""
    _preparar()
    with _lock:
        puerto = _servidor_vivo() or _arrancar_servidor()
    numero = _pedir_entrada(puerto)
    if not numero:
        raise MenteNoDisponible("El servidor del mapa no entregó una entrada")
    return f"http://localhost:{puerto}/cerebro.html?entrada={numero}"


# ------------------------------------------------- memoria de una consulta

class Memoria:
    """La memoria para una consulta de Nexo: busca notas y anota lo que leen los agentes."""

    def __init__(self, conversacion: str):
        self.conversacion = conversacion or "sin-conversacion"

    async def search(self, consulta: str) -> List[Dict[str, Any]]:
        import asyncio
        try:
            return await asyncio.to_thread(buscar_notas, consulta)
        except Exception as e:  # la memoria es un extra: sin ella la consulta sigue
            logger.warning("Búsqueda en la memoria falló: %s", e)
            return []

    async def read(self, agente: str, rutas: List[str]) -> None:
        import asyncio
        await asyncio.to_thread(registrar_lecturas, self.conversacion, agente, rutas)

    async def start(self, largo: int) -> None:
        import asyncio
        await asyncio.to_thread(registrar_pedido, self.conversacion, largo)

    async def end(self) -> None:
        import asyncio
        await asyncio.to_thread(registrar_fin, self.conversacion)
