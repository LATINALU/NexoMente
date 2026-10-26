import re
from pathlib import Path

import pytest

from app.agents.catalog import (
    AGENT_DEFINITIONS, AGENTS, CATEGORIES, RESPONSE_FORMATS, CatalogError, list_agents, load_catalog,
)

FRONTEND_PRESETS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "presets.ts"


def test_catalog_has_500_agents_in_50_categories():
    assert len(AGENTS) == 500
    assert len(CATEGORIES) == 50
    assert all(c["agents_count"] == 10 for c in CATEGORIES.values())


def test_every_agent_is_complete():
    for spec in AGENTS.values():
        assert spec.name and spec.emoji and spec.category in CATEGORIES
        assert len(spec.system_prompt) > 200, spec.id
        assert spec.response_format in RESPONSE_FORMATS


def test_public_view_hides_prompts():
    assert all("system_prompt" not in d and "backstory" not in d for d in AGENT_DEFINITIONS.values())


def test_list_agents_keeps_order_and_drops_unknown_or_duplicates():
    ids = ["seo_specialist", "nope", "fullstack_developer", "seo_specialist"]
    known = [i for i in dict.fromkeys(ids) if i in AGENTS]
    assert [a.id for a in list_agents(ids)] == known


def test_marketplace_id_mismatch_is_fixed():
    assert "marketplace_manager_ecom" in AGENTS


@pytest.mark.skipif(not FRONTEND_PRESETS.exists(), reason="frontend no disponible")
def test_frontend_presets_reference_existing_agents():
    text = FRONTEND_PRESETS.read_text(encoding="utf-8")
    missing = set()
    for group in re.findall(r"agents:\s*\[([^\]]*)\]", text):
        for agent_id in re.findall(r'"([a-z0-9_]+)"', group):
            if agent_id not in AGENTS:
                missing.add(agent_id)
    assert not missing, f"presets.ts usa agentes inexistentes: {sorted(missing)}"


def test_loader_rejects_duplicates(tmp_path):
    body = ("category: {id: x, name: X}\nagents:\n"
            "- {id: a, name: A, system_prompt: p}\n- {id: a, name: B, system_prompt: q}\n")
    (tmp_path / "x.yaml").write_text(body, encoding="utf-8")
    with pytest.raises(CatalogError):
        load_catalog(tmp_path)


def test_loader_rejects_bad_format(tmp_path):
    (tmp_path / "x.yaml").write_text("category: {id: x, response_format: nope}\nagents: []\n", encoding="utf-8")
    with pytest.raises(CatalogError):
        load_catalog(tmp_path)


def test_shared_prompt_is_appended_to_every_agent_of_the_category(tmp_path):
    body = ("category: {id: x, name: X, shared_prompt: 'Regla común'}\nagents:\n"
            "- {id: a, name: A, system_prompt: 'Propio A'}\n- {id: b, name: B, system_prompt: 'Propio B'}\n")
    (tmp_path / "x.yaml").write_text(body, encoding="utf-8")
    agents, _ = load_catalog(tmp_path)
    assert agents["a"].system_prompt == "Propio A\n\nRegla común"
    assert agents["b"].system_prompt.endswith("Regla común")


def test_mercadolibre_agents_share_country_and_reference_rules():
    ml = [a for a in AGENTS.values() if a.category == "mercadolibre"]
    assert len(ml) == 10
    assert all("País primero" in a.system_prompt and "Datos de referencia" in a.system_prompt for a in ml)
