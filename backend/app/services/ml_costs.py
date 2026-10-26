"""
Nexo - Calculadora de costos de Mercado Libre
============================================
Cálculo determinístico del costo real de una venta: comisión (+IVA), cargo fijo por tramo,
envío según el umbral de envío gratis, retenciones, contribución, ROAS de equilibrio y
precio de equilibrio, con escenarios (Clásica/Premium, cruzar el umbral de envío gratis).

Los modelos chicos se equivocan con estas cuentas; los agentes reciben el resultado ya
calculado y solo lo interpretan. Las tarifas viven en RULES: actualizarlas acá.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, replace
from typing import Any, Dict, List, Optional, Tuple

from app.services.llm_client import LLMClient, LLMError, Usage

# Tarifas de referencia (fuentes de terceros, oct-2026; ver backend/app/agents/catalog/mercadolibre.yaml)
RULES: Dict[str, Dict[str, Any]] = {
    "MX": {
        "currency": "MXN",
        "as_of": "octubre 2026",
        # (precio menor a, cargo fijo por unidad) — solo publicación Clásica
        "fixed_fee_tiers": ((99.0, 25.0), (149.0, 30.0), (299.0, 37.0)),
        "fixed_fee_listing": ("clasica",),
        # Supuestos cuando el usuario no da la comisión de su categoría (rangos reales: 8–17 % / 12–21 %)
        "default_commission": {"clasica": 15.0, "premium": 19.5},
        "iva_on_commission": 16.0,
        "free_shipping_threshold": 299.0,
        "min_price": 35.0,
    },
}

LISTING_NAMES = {"clasica": "Clásica", "premium": "Premium"}


@dataclass(frozen=True)
class SaleInput:
    """Datos de una venta. `None` = el usuario no lo dijo (se usa un supuesto o se avisa)."""
    country: str
    price: float
    cost: float
    listing: str = "clasica"
    commission_pct: Optional[float] = None
    seller_shipping: Optional[float] = None  # lo que paga el vendedor por envío cuando le toca
    offers_free_shipping: bool = False       # envío gratis voluntario por debajo del umbral
    other_costs: float = 0.0                 # empaque, etc., por unidad
    withholding_pct: float = 0.0             # retenciones de impuestos sobre el precio
    roas_target: Optional[float] = None


@dataclass
class SaleResult:
    label: str
    sale: SaleInput
    commission_pct: float
    commission: float
    commission_iva: float
    fixed_fee: float
    shipping: Optional[float]  # None = el vendedor paga el envío pero no se conoce el monto
    withholding: float
    contribution: Optional[float]
    margin_pct: Optional[float]
    breakeven_roas: Optional[float]
    ad_cost: Optional[float] = None
    profit_after_ads: Optional[float] = None
    assumptions: List[str] = field(default_factory=list)


def fixed_fee(rules: Dict[str, Any], price: float, listing: str) -> float:
    if listing not in rules["fixed_fee_listing"]:
        return 0.0
    for upper, fee in rules["fixed_fee_tiers"]:
        if price < upper:
            return fee
    return 0.0


def seller_pays_shipping(rules: Dict[str, Any], sale: SaleInput) -> bool:
    return sale.price >= rules["free_shipping_threshold"] or sale.offers_free_shipping


def calculate(sale: SaleInput, label: str = "") -> SaleResult:
    rules = RULES[sale.country]
    assumptions: List[str] = []
    pct = sale.commission_pct
    if pct is None:
        pct = rules["default_commission"][sale.listing]
        assumptions.append(f"Comisión {LISTING_NAMES[sale.listing]} supuesta en {pct:g} % "
                           "(la real depende de la categoría: ver simulador de costos).")
    commission = sale.price * pct / 100
    commission_iva = commission * rules["iva_on_commission"] / 100
    fee = fixed_fee(rules, sale.price, sale.listing)
    if seller_pays_shipping(rules, sale):
        shipping = sale.seller_shipping
        if shipping is None:
            assumptions.append(f"A {money(sale.price, rules)} el envío lo paga el vendedor y no se indicó "
                               "cuánto cuesta (cotízalo en la calculadora de envíos).")
    else:
        shipping = 0.0
    withholding = sale.price * sale.withholding_pct / 100

    contribution = margin = breakeven = None
    if shipping is not None:
        contribution = (sale.price - sale.cost - commission - commission_iva - fee - shipping
                        - sale.other_costs - withholding)
        margin = contribution / sale.price * 100
        breakeven = sale.price / contribution if contribution > 0 else None
    result = SaleResult(label or f"{LISTING_NAMES[sale.listing]} a {money(sale.price, rules)}", sale, pct,
                        commission, commission_iva, fee, shipping, withholding, contribution, margin, breakeven,
                        assumptions=assumptions)
    if sale.roas_target and contribution is not None:
        result.ad_cost = sale.price / sale.roas_target
        result.profit_after_ads = contribution - result.ad_cost
    return result


def breakeven_price(sale: SaleInput) -> Optional[float]:
    """Precio mínimo con contribución ≥ 0. Resuelve la ecuación lineal en cada tramo de cargo fijo."""
    rules = RULES[sale.country]
    pct = sale.commission_pct if sale.commission_pct is not None else rules["default_commission"][sale.listing]
    variable = pct / 100 * (1 + rules["iva_on_commission"] / 100) + sale.withholding_pct / 100
    if variable >= 1:
        return None
    bounds = [rules["min_price"]] + [u for u, _ in rules["fixed_fee_tiers"]] + [float("inf")]
    for low, high in zip(bounds, bounds[1:]):
        probe = replace(sale, price=low)
        ship = 0.0
        if seller_pays_shipping(rules, probe):
            if sale.seller_shipping is None:
                return None
            ship = sale.seller_shipping
        price = (sale.cost + fixed_fee(rules, low, sale.listing) + ship + sale.other_costs) / (1 - variable)
        price = max(price, low)
        if price < high:
            return round(price + 0.005, 2)
    return None


def scenarios(sale: SaleInput) -> List[SaleResult]:
    """Escenario del usuario + alternativas que cambian la decisión."""
    rules = RULES[sale.country]
    results = [calculate(sale, "Tu escenario")]
    other = "premium" if sale.listing == "clasica" else "clasica"
    # La comisión del usuario es de su tipo de publicación; para el otro se usa el supuesto
    results.append(calculate(replace(sale, listing=other, commission_pct=None),
                             f"{LISTING_NAMES[other]} al mismo precio"))
    threshold = rules["free_shipping_threshold"]
    if sale.price < threshold:
        results.append(calculate(replace(sale, price=threshold), f"Subir a {money(threshold, rules)} (envío gratis)"))
    return results


# ---------------------------------------------------------------- presentación

def money(value: Optional[float], rules: Dict[str, Any]) -> str:
    if value is None:
        return "?"
    sign = "−" if value < 0 else ""
    return f"{sign}${abs(value):,.2f}"


def render_markdown(sale: SaleInput) -> str:
    rules = RULES[sale.country]
    results = scenarios(sale)
    base = results[0]
    cur = rules["currency"]
    lines = [f"**País:** México · moneda {cur} · tarifas de referencia de {rules['as_of']} (verificar en el "
             "simulador de costos de tu cuenta).", ""]
    header = "| Concepto | " + " | ".join(r.label for r in results) + " |"
    lines += [header, "|---" * (len(results) + 1) + "|"]

    def row(name: str, values: List[str]) -> None:
        lines.append(f"| {name} | " + " | ".join(values) + " |")

    row("Precio", [money(r.sale.price, rules) for r in results])
    row("Tipo de publicación", [LISTING_NAMES[r.sale.listing] for r in results])
    row("Costo del producto", [money(-r.sale.cost, rules) for r in results])
    row("Comisión", [f"{money(-r.commission, rules)} ({r.commission_pct:g} %)" for r in results])
    row("IVA de la comisión", [money(-r.commission_iva, rules) for r in results])
    row("Cargo fijo", [money(-r.fixed_fee, rules) for r in results])
    row("Envío a cargo del vendedor", [money(-r.shipping if r.shipping is not None else None, rules)
                                       for r in results])
    if sale.other_costs:
        row("Otros costos", [money(-r.sale.other_costs, rules) for r in results])
    if sale.withholding_pct:
        row(f"Retenciones ({sale.withholding_pct:g} %)", [money(-r.withholding, rules) for r in results])
    row("**Contribución por unidad**", [f"**{money(r.contribution, rules)}**" for r in results])
    row("Margen sobre precio", [f"{r.margin_pct:.1f} %" if r.margin_pct is not None else "?" for r in results])
    row("ROAS de equilibrio", [f"{r.breakeven_roas:.2f}" if r.breakeven_roas else "—" for r in results])
    if sale.roas_target:
        row(f"Publicidad con ROAS {sale.roas_target:g}", [money(-r.ad_cost if r.ad_cost is not None else None, rules)
                                                         for r in results])
        row("Ganancia después de publicidad", [money(r.profit_after_ads, rules) for r in results])

    lines.append("")
    be = breakeven_price(sale)
    if be is not None:
        lines.append(f"- **Precio de equilibrio** ({LISTING_NAMES[sale.listing]}, contribución $0): {money(be, rules)}.")
    if base.contribution is not None and base.contribution <= 0:
        lines.append("- ⚠️ Con estos datos **cada venta pierde dinero** antes de publicidad.")
    if base.breakeven_roas:
        lines.append(f"- Con publicidad, un ROAS menor a {base.breakeven_roas:.2f} hace perder dinero en cada venta.")
    alt = results[1]
    if base.contribution is not None and alt.contribution is not None:
        diff = alt.contribution - base.contribution
        better = "más" if diff > 0 else "menos"
        lines.append(f"- {alt.label}: deja **{money(abs(diff), rules)} {better}** por unidad que tu escenario "
                     f"(con la comisión supuesta; confírmala en el simulador). Un ROAS de equilibrio más bajo "
                     "significa más margen para pagar publicidad, no menos.")
    crossing = next((r for r in results[2:] if r.shipping is None), None)
    if crossing and base.contribution is not None:
        # Envío máximo que se puede pagar desde el umbral sin ganar menos que hoy
        without_shipping = calculate(replace(crossing.sale, seller_shipping=0.0))
        tolerable = without_shipping.contribution - base.contribution
        lines.append(f"- Al subir a {money(crossing.sale.price, rules)} desaparece el cargo fijo pero el envío gratis "
                     f"lo pagas tú: conviene solo si ese envío te cuesta menos de **{money(tolerable, rules)}** "
                     "por unidad (y si las ventas no caen por el precio).")
    seen = set()
    for r in results:
        for a in r.assumptions:
            if a not in seen:
                seen.add(a)
                lines.append(f"- Supuesto: {a}")
    if sale.price < rules["min_price"]:
        lines.append(f"- ⚠️ El precio está por debajo del mínimo de publicación (≈ {money(rules['min_price'], rules)}).")
    return "\n".join(lines)


# ---------------------------------------------------------------- extracción

_EXTRACT_SYSTEM = (
    "Extraes datos de una consulta sobre vender en Mercado Libre. Responde SOLO un JSON con estas claves "
    "(null si el usuario no lo dice; no inventes ni estimes):\n"
    '{"aplica": bool (true si pregunta por costos, precio, margen, ganancia, comisión o publicidad de un '
    'producto con precio), "pais": código ISO de 2 letras o null, "precio": número, "costo": número '
    '(costo unitario del producto), "tipo": "clasica" | "premium" | null, "comision_pct": número o null, '
    '"envio_vendedor": número o null (lo que paga el vendedor por envío), "envio_gratis": bool (si el '
    'vendedor ofrece envío gratis), "otros_costos": número o null, "retenciones_pct": número o null, '
    '"roas_objetivo": número o null}'
)

_PRICE_HINT = re.compile(r"\d")


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace("$", "").replace(",", "").strip())
    except ValueError:
        return None


def parse_extraction(raw: str, default_country: str = "MX") -> Tuple[Optional[SaleInput], str]:
    """(venta, motivo). venta=None si no aplica o falta precio/costo; el motivo explica por qué."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    try:
        data = json.loads(match.group(0)) if match else {}
    except ValueError:
        data = {}
    if not isinstance(data, dict) or not data.get("aplica"):
        return None, "no_aplica"
    country = str(data.get("pais") or default_country).upper()
    if country not in RULES:
        return None, f"pais:{country}"
    price, cost = _number(data.get("precio")), _number(data.get("costo"))
    if not price or price <= 0 or cost is None or cost < 0:
        return None, "faltan_datos"
    listing = data.get("tipo") if data.get("tipo") in LISTING_NAMES else "clasica"
    roas = _number(data.get("roas_objetivo"))
    return SaleInput(
        country=country, price=price, cost=cost, listing=listing,
        commission_pct=_number(data.get("comision_pct")),
        seller_shipping=_number(data.get("envio_vendedor")),
        offers_free_shipping=data.get("envio_gratis") is True,
        other_costs=_number(data.get("otros_costos")) or 0.0,
        withholding_pct=_number(data.get("retenciones_pct")) or 0.0,
        roas_target=roas if roas and roas > 0 else None,
    ), "ok"


async def extract_sale(task: str, llm: LLMClient, usage: Optional[Usage] = None) -> Tuple[Optional[SaleInput], str]:
    if not _PRICE_HINT.search(task):
        return None, "no_aplica"
    messages = [{"role": "system", "content": _EXTRACT_SYSTEM}, {"role": "user", "content": task[:3000]}]
    try:
        raw = await llm.complete(messages, max_tokens=300, temperature=0.0, usage=usage)
    except LLMError:
        return None, "error"
    return parse_extraction(raw)
