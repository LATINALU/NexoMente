"""
Nexo - Catálogo de agentes
=========================
Fuente única de verdad de los agentes: un YAML por categoría en
app/agents/catalog/. Agregar un agente = agregar una entrada al YAML.

Cada archivo:
    category: {id, name, emoji, description, color, response_format, shared_prompt?}
    agents:   [{id, name, emoji, description, short_description, specialization,
                complexity, capabilities, backstory, system_prompt}]

`shared_prompt` (opcional) se agrega al final del prompt de cada agente de la categoría:
reglas y datos comunes (p. ej. país, vigencia de tarifas) escritos una sola vez.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

CATALOG_DIR = Path(__file__).parent / "catalog"

# Parser en C (libyaml) cuando está disponible: ~10x más rápido para los 500 agentes
_YamlLoader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)

RESPONSE_FORMATS = ("code", "document", "analysis", "creative", "strategic", "educational",
                    "marketplace", "operational", "hr", "sales")

# Estructura sugerida por tipo de respuesta (se agrega al prompt del agente)
FORMAT_HINTS: Dict[str, Dict[str, str]] = {
    "code": {"es": "Análisis → Solución → Código (con comentarios) → Testing → Próximos pasos",
             "en": "Analysis → Solution → Code (commented) → Testing → Next steps"},
    "document": {"es": "Antecedentes → Análisis → Riesgos → Recomendaciones → Conclusión",
                 "en": "Background → Analysis → Risks → Recommendations → Conclusion"},
    "analysis": {"es": "Resumen ejecutivo → Análisis → Hallazgos → Recomendaciones → Riesgos",
                 "en": "Executive summary → Analysis → Findings → Recommendations → Risks"},
    "creative": {"es": "Concepto → Estrategia → Plan de ejecución → Contenido → KPIs",
                 "en": "Concept → Strategy → Execution plan → Content → KPIs"},
    "strategic": {"es": "Visión → Objetivos SMART → Plan de acción → Recursos → Cronograma → Riesgos",
                  "en": "Vision → SMART goals → Action plan → Resources → Timeline → Risks"},
    "educational": {"es": "Introducción → Objetivos → Contenido → Ejemplos → Ejercicios → Resumen",
                    "en": "Introduction → Goals → Content → Examples → Exercises → Summary"},
    "marketplace": {"es": "Diagnóstico → Ficha de producto → Optimización SEO → Estrategia → Plan 30 días",
                    "en": "Diagnosis → Product listing → SEO optimization → Strategy → 30-day plan"},
    "operational": {"es": "Situación actual → Análisis → Proceso propuesto → Mejoras → Implementación",
                    "en": "Current state → Analysis → Proposed process → Improvements → Rollout"},
    "hr": {"es": "Visión general → Análisis → Recomendaciones → Plan de acción → Métricas",
           "en": "Overview → Analysis → Recommendations → Action plan → Metrics"},
    "sales": {"es": "Oportunidad → Propuesta de valor → Solución → ROI → Próximos pasos",
              "en": "Opportunity → Value proposition → Solution → ROI → Next steps"},
}


@dataclass(frozen=True)
class CategorySpec:
    id: str
    name: str
    emoji: str
    description: str
    color: str
    response_format: str


@dataclass(frozen=True)
class AgentSpec:
    id: str
    name: str
    emoji: str
    category: str
    description: str
    short_description: str
    specialization: str
    complexity: str
    system_prompt: str
    backstory: str = ""
    response_format: str = "analysis"
    capabilities: Tuple[str, ...] = field(default_factory=tuple)

    def to_public_dict(self) -> Dict[str, Any]:
        """Representación expuesta por la API (sin prompts)."""
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.short_description or self.description,
            "emoji": self.emoji,
            "capabilities": list(self.capabilities),
            "specialization": self.specialization,
            "complexity": self.complexity,
        }


class CatalogError(ValueError):
    pass


_REQUIRED_AGENT_FIELDS = ("id", "name", "system_prompt")


def load_catalog(directory: Path = CATALOG_DIR) -> Tuple[Dict[str, AgentSpec], Dict[str, CategorySpec]]:
    agents: Dict[str, AgentSpec] = {}
    categories: Dict[str, CategorySpec] = {}
    files = sorted(directory.glob("*.yaml"))
    if not files:
        raise CatalogError(f"No hay archivos de catálogo en {directory}")

    for path in files:
        doc = yaml.load(path.read_text(encoding="utf-8"), Loader=_YamlLoader) or {}
        cat = doc.get("category") or {}
        cat_id = cat.get("id") or path.stem
        if cat_id in categories:
            raise CatalogError(f"{path.name}: categoría duplicada '{cat_id}'")
        response_format = cat.get("response_format", "analysis")
        if response_format not in RESPONSE_FORMATS:
            raise CatalogError(f"{path.name}: response_format inválido '{response_format}'")
        categories[cat_id] = CategorySpec(
            id=cat_id, name=cat.get("name", cat_id), emoji=cat.get("emoji", "📁"),
            description=cat.get("description", ""), color=cat.get("color", "#6366F1"),
            response_format=response_format,
        )
        shared = (cat.get("shared_prompt") or "").strip()
        for raw in doc.get("agents") or []:
            missing = [f for f in _REQUIRED_AGENT_FIELDS if not raw.get(f)]
            if missing:
                raise CatalogError(f"{path.name}: agente sin {missing}: {raw.get('id', '?')}")
            if raw["id"] in agents:
                raise CatalogError(f"{path.name}: id de agente duplicado '{raw['id']}'")
            agents[raw["id"]] = AgentSpec(
                id=raw["id"], name=raw["name"], emoji=raw.get("emoji", "🤖"), category=cat_id,
                description=raw.get("description", ""), short_description=raw.get("short_description", ""),
                specialization=raw.get("specialization", ""), complexity=raw.get("complexity", "intermediate"),
                system_prompt="\n\n".join(p for p in (raw["system_prompt"].strip(), shared) if p),
                backstory=(raw.get("backstory") or "").strip(),
                response_format=raw.get("response_format", response_format),
                capabilities=tuple(raw.get("capabilities") or ()),
            )
    return agents, categories


AGENTS, CATEGORY_SPECS = load_catalog()


def get_agent(agent_id: str) -> Optional[AgentSpec]:
    return AGENTS.get(agent_id)


def get_agent_count() -> int:
    return len(AGENTS)


# --- Vistas de compatibilidad usadas por las rutas de catálogo ---------------

AGENT_DEFINITIONS: Dict[str, Dict[str, Any]] = {a.id: a.to_public_dict() for a in AGENTS.values()}

CATEGORIES: Dict[str, Dict[str, Any]] = {
    c.id: {
        "name": c.name, "emoji": c.emoji, "description": c.description, "color": c.color,
        "response_format": c.response_format,
        "agents_count": sum(1 for a in AGENTS.values() if a.category == c.id),
    }
    for c in CATEGORY_SPECS.values()
}


def get_agents_by_category(category: str) -> Dict[str, Dict[str, Any]]:
    return {aid: d for aid, d in AGENT_DEFINITIONS.items() if d["category"] == category}


def list_agents(ids: List[str]) -> List[AgentSpec]:
    """Specs de los ids válidos, en el orden recibido y sin duplicados."""
    seen, result = set(), []
    for agent_id in ids:
        spec = AGENTS.get(agent_id)
        if spec and agent_id not in seen:
            seen.add(agent_id)
            result.append(spec)
    return result
