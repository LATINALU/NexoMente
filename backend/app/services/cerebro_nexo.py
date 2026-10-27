"""
NexoMente - El cerebro de Nexo
==============================
Neuromapa dibuja un cerebro a partir de notas Markdown. Para que sea el cerebro de Nexo (y no la memoria
de Claude Code), acá se arma su contenido desde el catálogo de agentes:

- una neurona por experto: datos-mente/agentes/<categoría>/<agente>.md (descripción y capacidades);
- un centro por categoría (su MEMORY.md, que enlaza a sus expertos);
- conexiones entre expertos afines de otras categorías (capacidades parecidas), que cruzan lóbulos;
- la configuración de Neuromapa (datos-mente/config.json): cada categoría es un grupo con su color en un
  lóbulo temático, más las notas que guarda NexoMente («Memoria», en el tronco).

Se rearma solo cuando cambia el catálogo; solo escribe en datos-mente/, que es de NexoMente.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Dict, List, Set

from app.agents.catalog import AGENTS, CATEGORY_SPECS, AgentSpec

VERSION = 1
MARCA = "_nexomente"
AFINES_POR_EXPERTO = 2
INDICE = "MEMORY.md"

# Cada categoría en un lóbulo, por tema
LOBULO_DE: Dict[str, str] = {
    **dict.fromkeys(["consulting", "entrepreneurship", "project_management", "business_intelligence", "finance",
                     "legal", "human_resources", "operations", "coaching"], "prefrontal"),
    **dict.fromkeys(["software_development", "mobile_apps", "data_science", "ai_prompt_engineering", "cybersecurity",
                     "qa_testing", "blockchain_web3", "iot_embedded", "automation_scripting", "automation_rpa"], "frontal"),
    **dict.fromkeys(["mathematics", "science_chemistry", "civil_engineering", "energy_utilities", "manufacturing",
                     "automotive", "sustainability_esg", "health_wellness"], "parietal"),
    **dict.fromkeys(["ui_ux_design", "creative", "video_production", "game_development", "gamedev_xr", "architecture",
                     "streaming_media", "youtube"], "occipital"),
    **dict.fromkeys(["marketing", "seo_performance", "personal_brand", "professional_writing", "writing_editorial",
                     "education", "child_education", "internationalization", "music_audio"], "temporal"),
    **dict.fromkeys(["sales", "ecommerce", "mercadolibre", "supply_chain", "real_estate", "tourism_hospitality"],
                    "cerebelo"),
}
ROTULOS = {"prefrontal": "Estrategia y negocio", "frontal": "Tecnología", "parietal": "Ciencia e ingeniería",
           "occipital": "Visual y creativo", "temporal": "Comunicación y educación", "cerebelo": "Comercio",
           "tronco": "Memoria"}

_PALABRA = re.compile(r"[a-záéíóúñü0-9]{4,}")
_VACIAS = {"para", "como", "con", "del", "los", "las", "una", "uno", "por", "más", "sus", "este", "esta", "entre",
           "desde", "sobre", "cada", "todo", "todos", "with", "and", "the", "for", "from", "into", "your"}


def _palabras(agente: AgentSpec) -> Set[str]:
    texto = " ".join([*agente.capabilities, agente.specialization]).lower()
    return {p for p in _PALABRA.findall(texto) if p not in _VACIAS}


def _afines(agentes: List[AgentSpec]) -> Dict[str, List[AgentSpec]]:
    """Para cada experto, los más parecidos de otras categorías (Jaccard de sus capacidades)."""
    palabras = {a.id: _palabras(a) for a in agentes}
    salida: Dict[str, List[AgentSpec]] = {}
    for a in agentes:
        mias = palabras[a.id]
        if not mias:
            salida[a.id] = []
            continue
        puntajes = []
        for b in agentes:
            if b.category == a.category or not palabras[b.id]:
                continue
            comunes = len(mias & palabras[b.id])
            if comunes >= 2:
                puntajes.append((comunes / len(mias | palabras[b.id]), b.id, b))
        puntajes.sort(key=lambda x: (-x[0], x[1]))
        salida[a.id] = [b for _, _, b in puntajes[:AFINES_POR_EXPERTO]]
    return salida


def _yaml(texto: str) -> str:
    return json.dumps(texto, ensure_ascii=False)


def _una_linea(texto: str) -> str:
    return re.sub(r"\s+", " ", texto or "").strip()


def _neurona(agente: AgentSpec, afines: List[AgentSpec]) -> str:
    categoria = CATEGORY_SPECS.get(agente.category)
    descripcion = _una_linea(agente.short_description or agente.description)
    partes = ["---", f"name: {_yaml(agente.id)}", f"description: {_yaml(descripcion[:300])}", "metadata:",
              "  type: agente", "---", "", f"# {agente.emoji} {agente.name}", ""]
    if agente.specialization:
        partes += [f"**{_una_linea(agente.specialization)}**", ""]
    if agente.description:
        partes += [_una_linea(agente.description), ""]
    if agente.capabilities:
        partes += ["## Capacidades", "", *[f"- {_una_linea(c).replace('_', ' ')}" for c in agente.capabilities], ""]
    if categoria:
        partes += [f"Categoría: [{categoria.emoji} {categoria.name}]({INDICE})", ""]
    if afines:
        partes += ["## Afines", "", *[f"- [{b.emoji} {b.name}](../{b.category}/{b.id}.md)" for b in afines], ""]
    return "\n".join(partes)


def _centro(cat_id: str, agentes: List[AgentSpec]) -> str:
    categoria = CATEGORY_SPECS[cat_id]
    partes = [f"# {categoria.emoji} {categoria.name}", "", _una_linea(categoria.description), "",
              *[f"- [{a.emoji} {a.name}]({a.id}.md) — {_una_linea(a.short_description or a.specialization)[:120]}"
                for a in agentes], ""]
    return "\n".join(partes)


def _config(carpeta: Path, notas: Path) -> Dict:
    fuentes = []
    for cat_id, cat in sorted(CATEGORY_SPECS.items()):
        fuentes.append({"id": cat_id, "nombre": f"{cat.emoji} {cat.name}", "color": cat.color or "#868E96",
                        "raices": [[str(carpeta / cat_id), False, ""]], "lobulo": LOBULO_DE.get(cat_id, "temporal")})
    fuentes.append({"id": "nexo", "nombre": "🧠 Memoria de NexoMente", "color": "#7950F2",
                    "raices": [[str(notas), False, ""]], "lobulo": "tronco", "foco": True})
    return {MARCA: VERSION, "usuario": "", "lobulos": ROTULOS, "fuentes": fuentes, "dormir_con_claude": False}


def _escribir_si_cambia(ruta: Path, texto: str) -> bool:
    try:
        if ruta.read_text(encoding="utf-8") == texto:
            return False
    except OSError:
        pass
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = ruta.with_name(f".{ruta.name}.tmp")
    temporal.write_text(texto, encoding="utf-8", newline="\n")
    temporal.replace(ruta)
    return True


def armar(datos: Path, notas: Path) -> bool:
    """Arma (o pone al día) las neuronas y la configuración. Devuelve True si cambió algo que el mapa lee."""
    carpeta = datos / "agentes"
    agentes = sorted(AGENTS.values(), key=lambda a: (a.category, a.id))
    huella = hashlib.sha1(json.dumps([VERSION, str(notas), [(a.id, a.category, a.name, a.emoji, a.description,
                                      a.short_description, a.specialization, list(a.capabilities)) for a in agentes]],
                                     ensure_ascii=False).encode("utf-8")).hexdigest()
    marca = carpeta / ".huella"
    config = datos / "config.json"
    try:
        actual = json.loads(config.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        actual = None
    # Una configuración escrita a mano (sin la marca) se respeta: ese cerebro lo eligió el usuario
    if actual is not None and not (isinstance(actual, dict) and actual.get(MARCA)):
        return False
    try:
        if marca.read_text(encoding="utf-8").strip() == huella and actual is not None:
            return False
    except OSError:
        pass

    notas.mkdir(parents=True, exist_ok=True)
    afines = _afines(agentes)
    validos = set()
    por_categoria: Dict[str, List[AgentSpec]] = {}
    for a in agentes:
        por_categoria.setdefault(a.category, []).append(a)
    for cat_id, lista in por_categoria.items():
        if cat_id not in CATEGORY_SPECS:
            continue
        for a in lista:
            ruta = carpeta / cat_id / f"{a.id}.md"
            _escribir_si_cambia(ruta, _neurona(a, afines[a.id]))
            validos.add(ruta.resolve())
        indice = carpeta / cat_id / INDICE
        _escribir_si_cambia(indice, _centro(cat_id, lista))
        validos.add(indice.resolve())
    # Expertos que ya no están en el catálogo: sus neuronas se van
    for vieja in carpeta.glob("*/*.md"):
        if vieja.resolve() not in validos:
            vieja.unlink(missing_ok=True)
    _escribir_si_cambia(config, json.dumps(_config(carpeta, notas), ensure_ascii=False, indent=2) + "\n")
    _escribir_si_cambia(marca, huella + "\n")
    return True
