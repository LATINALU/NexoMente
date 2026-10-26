import asyncio

import pytest

from app.agents.catalog import list_agents
from app.services.ml_costs import SaleInput, breakeven_price, calculate, fixed_fee, parse_extraction, render_markdown, RULES
from app.services.orchestrator import Orchestrator
from tests.conftest import FakeLLM

MX = RULES["MX"]


@pytest.mark.parametrize("price,fee", [(50, 25), (98.99, 25), (99, 30), (148.99, 30), (149, 37), (249, 37),
                                       (298.99, 37), (299, 0), (1000, 0)])
def test_fixed_fee_tiers_mexico(price, fee):
    assert fixed_fee(MX, price, "clasica") == fee
    assert fixed_fee(MX, price, "premium") == 0


def test_contribution_below_free_shipping_threshold():
    r = calculate(SaleInput(country="MX", price=249, cost=95, commission_pct=15))
    assert r.commission == pytest.approx(37.35)
    assert r.commission_iva == pytest.approx(5.976)
    assert r.fixed_fee == 37 and r.shipping == 0
    assert r.contribution == pytest.approx(249 - 95 - 37.35 - 5.976 - 37)
    assert r.breakeven_roas == pytest.approx(249 / r.contribution)


def test_seller_pays_shipping_from_threshold():
    unknown = calculate(SaleInput(country="MX", price=350, cost=100, commission_pct=15))
    assert unknown.shipping is None and unknown.contribution is None
    known = calculate(SaleInput(country="MX", price=350, cost=100, commission_pct=15, seller_shipping=80))
    assert known.fixed_fee == 0 and known.shipping == 80
    assert known.contribution == pytest.approx(350 - 100 - 52.5 - 8.4 - 80)


def test_ads_and_assumed_commission():
    r = calculate(SaleInput(country="MX", price=200, cost=50, roas_target=5))
    assert r.commission_pct == MX["default_commission"]["clasica"] and r.assumptions
    assert r.ad_cost == pytest.approx(40)
    assert r.profit_after_ads == pytest.approx(r.contribution - 40)


def test_breakeven_price_jumps_tiers():
    sale = SaleInput(country="MX", price=249, cost=95, commission_pct=15)
    be = breakeven_price(sale)
    assert be == pytest.approx((95 + 37) / (1 - 0.15 * 1.16), abs=0.01)
    assert calculate(SaleInput(country="MX", price=be, cost=95, commission_pct=15)).contribution >= 0


def test_render_includes_scenarios_and_threshold_advice():
    md = render_markdown(SaleInput(country="MX", price=249, cost=95, commission_pct=15))
    assert "Premium al mismo precio" in md and "$299.00" in md
    assert "Precio de equilibrio" in md and "$73.67" in md


def test_parse_extraction():
    sale, reason = parse_extraction('{"aplica": true, "pais": "MX", "precio": "$1,249", "costo": 400, '
                                    '"tipo": "premium", "comision_pct": null, "roas_objetivo": 6}')
    assert reason == "ok" and sale.price == 1249 and sale.listing == "premium" and sale.roas_target == 6
    assert parse_extraction('{"aplica": false}') == (None, "no_aplica")
    assert parse_extraction('{"aplica": true, "pais": "AR", "precio": 10, "costo": 5}') == (None, "pais:AR")
    assert parse_extraction('{"aplica": true, "precio": 100}') == (None, "faltan_datos")
    assert parse_extraction("no es json") == (None, "no_aplica")


class Recorder:
    def __init__(self):
        self.events = []

    async def __call__(self, event):
        self.events.append(event)


def test_orchestrator_injects_calculation_for_mercadolibre_agents():
    extraction = '{"aplica": true, "pais": "MX", "precio": 249, "costo": 95, "comision_pct": 15}'
    llm = FakeLLM(replies={"Extraes datos": extraction})
    rec = Recorder()
    agents = list_agents(["ml_pricing_strategist", "ml_ads_specialist"])
    asyncio.run(Orchestrator(agents, llm, rec, followups=False).run("Vendo a $249 y me cuesta $95, ¿gano?"))
    calc = next(e for e in rec.events if e["type"] == "calculation")
    assert "$73.67" in calc["content"]
    agent_calls = [c for c in llm.calls if "Estratega de Precios" in c[0]["content"]]
    assert "$73.67" in agent_calls[0][-1]["content"]  # el agente recibe el cálculo
    synthesis = [c for c in llm.calls if "$73.67" in c[-1]["content"] and "Estratega" not in c[0]["content"]
                 and "Especialista en Mercado Ads" not in c[0]["content"]]
    assert synthesis  # el coordinador también


def test_no_calculation_for_other_categories():
    llm = FakeLLM()
    rec = Recorder()
    asyncio.run(Orchestrator(list_agents(["fullstack_developer"]), llm, rec, followups=False).run("Precio $249"))
    assert not any(e["type"] == "calculation" for e in rec.events)
    assert not any("Extraes datos" in c[0]["content"] for c in llm.calls)
