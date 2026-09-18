"""The transmission-mechanism catalogue.

Code owns this list. Stage 3 selects from it rather than writing a mechanism freehand,
so the answer is always one of these keys. Company profiles and news come from
yfinance; see `market.py`.
"""

from __future__ import annotations

MECHANISMS: dict[str, str] = {
    "policy_rate_path": "A change in the expected policy rate path moves the company's funding "
    "costs, net interest income, or the discount rate applied to its cash flows.",
    "input_cost": "A change in the cost or availability of a physical input the company buys "
    "moves its margins.",
    "output_price": "A change in the price of the commodity or product the company sells moves "
    "its revenue and cash flow.",
    "supply_disruption": "A physical interruption to the company's own production or to a "
    "facility it depends on reduces the volume it can sell.",
    "regulatory_access": "A rule change alters which markets, customers, or projects the "
    "company is permitted to serve.",
    "capex_cycle": "A change in customers' capital budgets moves the company's order book.",
    "competitive_position": "A change affecting a competitor shifts share, pricing power, or "
    "customer allocation toward or away from the company.",
    "demand_shift": "A change in end demand for the company's products moves its volumes.",
    "no_clear_mechanism": "No mechanism in this catalogue connects the event to this company "
    "through the evidence supplied.",
}
