"""Material catalogue and indicative costs.

Argon must pick from this list; it can't invent material properties. Opacity is the share of
DIRECT sunlight blocked (what our geometry engine models). Costs are INDICATIVE planning
assumptions for a hackathon prototype, not quotes: edit them here. For scale, the London
Assembly reported TfL's expected cost for a new bus shelter as about £12,500-£24,500 (Nov 2024).
"""
from __future__ import annotations

import math

CATALOGUE = {
    "opaque_metal_roof": {
        "label": "Reflective opaque metal roof panel",
        "opacity": 1.0, "cost_fixed_gbp": 2500, "cost_per_m2_gbp": 320, "life_years": 25,
        "notes": "Blocks direct sun completely; durable. Needs posts/foundations and a structural check.",
    },
    "solar_polycarbonate": {
        "label": "Solar-control (tinted) polycarbonate",
        "opacity": 0.6, "cost_fixed_gbp": 2000, "cost_per_m2_gbp": 220, "life_years": 15,
        "notes": "Keeps some daylight; blocks only part of the direct sun. Check the product's solar transmittance.",
    },
    "shade_fabric": {
        "label": "Tensioned shade-sail fabric",
        "opacity": 0.85, "cost_fixed_gbp": 1200, "cost_per_m2_gbp": 90, "life_years": 8,
        "notes": "Cheap and light; wind loading, vandalism and replacement cycles matter. No rain protection.",
    },
    "clear_polycarbonate": {
        "label": "Clear polycarbonate (typical existing shelter roof)",
        "opacity": 0.1, "cost_fixed_gbp": 1500, "cost_per_m2_gbp": 150, "life_years": 15,
        "notes": "Rain cover, but lets almost all direct sun through.",
    },
    "street_tree": {
        "label": "Street tree (semi-mature, with tree pit)",
        "opacity": 0.7, "cost_fixed_gbp": 3500, "cost_per_m2_gbp": 0, "life_years": 40,
        "notes": "Shade grows over years; needs root space clear of utilities and ongoing care.",
    },
}

DEFAULT_CANOPY = "opaque_metal_roof"


def plan_area(proposal: dict) -> float:
    if proposal.get("shape") == "sphere":
        return math.pi * proposal.get("radius", 0) ** 2
    w, d = proposal.get("size", [0, 0])
    return float(w) * float(d)


def apply_material(proposal: dict) -> dict:
    """Fix opacity from the catalogue (never from the model) and attach the indicative cost."""
    mat = proposal.get("material")
    if mat not in CATALOGUE:
        mat = "street_tree" if proposal.get("kind") == "tree" else DEFAULT_CANOPY
    m = CATALOGUE[mat]
    p = dict(proposal, material=mat, opacity=m["opacity"])
    area = plan_area(p)
    p["cost_gbp"] = round(m["cost_fixed_gbp"] + m["cost_per_m2_gbp"] * area, -1)
    p["life_years"] = m["life_years"]
    return p


def shade_value(score_gain: float, cost_gbp: float, life_years: int, passengers_per_day: int = 300,
                wait_min: float = 5, hot_days: int = 60) -> dict:
    """Extra shaded passenger-hours per year, and capital cost per extra shaded passenger-hour (illustrative)."""
    hours = passengers_per_day * (wait_min / 60) * hot_days * max(score_gain, 0)
    per_hour = cost_gbp / (hours * life_years) if hours > 0 else None
    return {"extra_shaded_passenger_hours_per_year": round(hours),
            "gbp_per_shaded_passenger_hour": round(per_hour, 2) if per_hour else None,
            "assumptions": {"passengers_per_day": passengers_per_day, "wait_min": wait_min,
                            "hot_days_per_year": hot_days, "life_years": life_years}}
