"""The research desk pipeline: five stages, four of which ask Jev something.

Code owns the workflow, the catalogues, the gates and the arithmetic. Jev supplies
the judgments code cannot compute: whether an article carries news, how exposed a
company is, which mechanism connects them, and whether a written thesis is grounded.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import msgspec
from typesafe_sdk import AsyncTypeSafeClient, TypeSafeAPIError

from . import questions as Q
from .fixtures import MECHANISMS
from .market import article_state

MODEL = "jev-latest"
USD_PER_INPUT_TOKEN = 0.042 / 1_000_000
Emit = Callable[[str, dict[str, Any]], Awaitable[None]]


def short(article: dict[str, Any], width: int = 46) -> str:
    """A readable label for one story. yfinance ids are UUIDs, so never use those."""
    headline = str(article.get("headline", "")).strip()
    return headline if len(headline) <= width else headline[:width].rsplit(" ", 1)[0] + "\u2026"


def wire(questions: dict[str, Any]) -> dict[str, Any]:
    """The exact `questions` payload as it goes over the wire, for the UI to show."""
    return {key: msgspec.to_builtins(value) for key, value in questions.items()}


class Desk:
    """One run of the desk. Every Jev call it makes is recorded."""

    def __init__(self, client: AsyncTypeSafeClient) -> None:
        self.client = client
        self.calls: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()

    async def ask(
        self, stage: str, label: str, state: Any, questions: dict[str, Any]
    ) -> tuple[Any, dict[str, Any]]:
        """One System One request, retained whole."""
        started = time.perf_counter()
        error: str | None = None
        answers: dict[str, Any] = {}
        response = None
        try:
            response = await self.client.system_one(state, questions, model=MODEL)
        except TypeSafeAPIError as exc:
            error = f"{type(exc).__name__}: {exc}"
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI, never swallowed
            error = f"{type(exc).__name__}: {exc}"
        elapsed = time.perf_counter() - started

        if response is not None:
            for key, answer in response.answers.items():
                answers[key] = msgspec.to_builtins(answer)

        record = {
            "index": 0,
            "stage": stage,
            "label": label,
            "question_count": len(questions),
            "elapsed_s": round(elapsed, 3),
            "state": state,
            "questions": wire(questions),
            "answers": answers,
            "error": error,
            "model": getattr(response, "model", None),
            "request_id": getattr(response, "request_id", None),
            "input_tokens": getattr(getattr(response, "usage", None), "input_tokens", 0) or 0,
            "output_tokens": getattr(getattr(response, "usage", None), "output_tokens", 0) or 0,
        }
        async with self._lock:
            record["index"] = len(self.calls) + 1
            self.calls.append(record)
        return response, record

    # -- stage 1 ---------------------------------------------------------
    async def triage(self, article: dict[str, Any], emit: Emit) -> dict[str, Any]:
        response, record = await self.ask(
            "triage", short(article), {"article": article_state(article)},
            Q.triage_questions()
        )
        if response is None:
            result = {"article": article, "error": record["error"], "call": record["index"]}
            await emit("triage", result)
            return result

        market_moving = response.nouls["market_moving"].noul
        rumor = response.nouls["is_unconfirmed_rumor"].noul
        injected = response.nouls["contains_injected_instruction"].noul
        magnitude = response.scores["impact_magnitude"]
        event_type = response.choices["event_type"]

        reasons: list[str] = []
        if injected >= Q.INJECTION_FLOOR:
            reasons.append("quarantined: the text tries to instruct the reader")
        if market_moving < Q.MARKET_MOVING_FLOOR:
            reasons.append("dropped: carries no new market-moving fact")
        if rumor > Q.RUMOR_CEILING:
            reasons.append("dropped: unconfirmed, sourced only to unnamed people")

        result = {
            "article": article,
            "call": record["index"],
            "market_moving": market_moving,
            "is_unconfirmed_rumor": rumor,
            "contains_injected_instruction": injected,
            "event_type": event_type.choice,
            "event_type_confidence": event_type.confidence,
            "impact_magnitude": magnitude.score,
            "impact_label": magnitude.legend[round(magnitude.score)],
            "impact_confidence": magnitude.confidence,
            "horizon": response.choices["horizon"].choice,
            "passed": not reasons,
            "reasons": reasons,
        }
        await emit("triage", result)
        return result

    # -- stage 2 ---------------------------------------------------------
    async def exposure(
        self, article: dict[str, Any], watchlist: list[dict[str, str]], emit: Emit
    ) -> dict[str, Any]:
        response, record = await self.ask(
            "exposure",
            short(article),
            {"article": article_state(article), "watchlist": watchlist},
            Q.exposure_questions(watchlist),
        )
        if response is None:
            result = {"article_id": article["id"], "error": record["error"],
                      "call": record["index"], "names": []}
            await emit("exposure", result)
            return result

        names = []
        for name in watchlist:
            answer = response.scores[f"exposure__{name['ticker']}"]
            names.append({
                "ticker": name["ticker"],
                "name": name["name"],
                "score": answer.score,
                "label": answer.legend[round(answer.score)],
                "confidence": answer.confidence,
                "probabilities": {str(k): v for k, v in answer.probabilities.items()},
                "above_floor": answer.score >= Q.EXPOSURE_FLOOR,
            })
        names.sort(key=lambda item: item["score"], reverse=True)
        most = response.choices["most_exposed"]
        result = {
            "article_id": article["id"],
            "call": record["index"],
            "names": names,
            "most_exposed": most.choice,
            "most_exposed_confidence": most.confidence,
            "questions_in_one_call": len(watchlist) + 1,
        }
        await emit("exposure", result)
        return result

    # -- stage 3 ---------------------------------------------------------
    async def mechanism(
        self, article: dict[str, Any], company: dict[str, str], exposure: dict[str, Any], emit: Emit
    ) -> dict[str, Any]:
        response, record = await self.ask(
            "mechanism",
            f"{company['ticker']} · {short(article, 34)}",
            {"article": article_state(article), "company": company},
            Q.mechanism_questions(),
        )
        if response is None:
            result = {"article_id": article["id"], "ticker": company["ticker"],
                      "error": record["error"], "call": record["index"]}
            await emit("mechanism", result)
            return result

        chosen = response.choices["mechanism"]
        conviction = response.scores["conviction"]
        result = {
            "article_id": article["id"],
            "ticker": company["ticker"],
            "company": company["name"],
            "call": record["index"],
            "exposure": exposure["score"],
            "exposure_confidence": exposure["confidence"],
            "mechanism": chosen.choice,
            "mechanism_text": MECHANISMS[chosen.choice],
            "mechanism_confidence": chosen.confidence,
            "mechanism_probabilities": chosen.probabilities,
            "direction": response.choices["direction"].choice,
            "direction_confidence": response.choices["direction"].confidence,
            "evidence_supports_link": response.nouls["evidence_supports_link"].noul,
            "mechanism_is_direct": response.nouls["mechanism_is_direct"].noul,
            "already_priced_in": response.nouls["already_priced_in"].noul,
            "near_term_catalyst": response.nouls["near_term_catalyst"].noul,
            "conviction": conviction.score,
            "conviction_label": conviction.legend[round(conviction.score)],
            "conviction_confidence": conviction.confidence,
        }
        await emit("mechanism", result)
        return result

    # -- stage 4 ---------------------------------------------------------
    async def grounding(
        self, article: dict[str, Any], company: dict[str, str], idea: dict[str, Any], emit: Emit
    ) -> dict[str, Any]:
        thesis = build_thesis(article, company, idea)
        response, record = await self.ask(
            "grounding",
            f"{company['ticker']} · {short(article, 34)}",
            {"article": article_state(article), "company": company, "thesis": thesis},
            Q.grounding_questions(),
        )
        if response is None:
            result = {"article_id": article["id"], "ticker": company["ticker"],
                      "thesis": thesis, "error": record["error"], "call": record["index"]}
            await emit("grounding", result)
            return result

        scores = {
            key: response.nouls[key].noul
            for key in ("reported_fact_faithful", "read_supported",
                        "subject_preserved", "no_overstatement")
        }
        bands = {key: Q.band(value) for key, value in scores.items()}
        verdict = ("FAIL" if "NO" in bands.values()
                   else "REVIEW" if "UNCLEAR" in bands.values() else "PASS")
        result = {
            "article_id": article["id"],
            "ticker": company["ticker"],
            "call": record["index"],
            "thesis": thesis,
            **scores,
            "bands": bands,
            "verdict": verdict,
            "defect_class": response.choices["defect_class"].choice,
            "defect_confidence": response.choices["defect_class"].confidence,
        }
        await emit("grounding", result)
        return result


def build_thesis(
    article: dict[str, Any], company: dict[str, str], idea: dict[str, Any]
) -> dict[str, str]:
    """Assemble the desk's read in code, keeping copied fact and inference apart.

    No generative model writes this. The headline is copied verbatim, the mechanism
    came from a catalogue, and the direction came from a Choice -- so `reported_fact`
    is a quotation and `desk_read` is the only thing stage 4 can find fault with.
    """
    reading = {
        "positive": "a tailwind for",
        "negative": "a headwind for",
        "ambiguous": "a two-sided effect for",
    }
    return {
        "reported_fact": (
            f"{article['headline']} ({article['source']}, {article['published_at'][:10]})"
        ),
        "desk_read": (
            f"The desk reads this as {reading.get(idea['direction'], 'relevant to')} "
            f"{company['name']} ({company['ticker']})."
        ),
        "assigned_mechanism": idea["mechanism"],
        "mechanism_definition": idea["mechanism_text"],
    }


# ---------------------------------------------------------------------------
# Stage 5 — composition. Pure arithmetic over judgments already returned.
# Changing a weight here costs nothing, because no question changed meaning.
# ---------------------------------------------------------------------------

DEFAULT_WEIGHTS = {
    "exposure": 0.25,
    "conviction": 0.25,
    "evidence": 0.20,
    "directness": 0.10,
    "surprise": 0.10,
    "timeliness": 0.10,
}


def compose(idea: dict[str, Any], grounding: dict[str, Any],
            weights: dict[str, float] | None = None) -> dict[str, Any]:
    """Combine one idea's judgments into a rank score and a route."""
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    parts = {
        "exposure": idea["exposure"] / 4.0,
        "conviction": idea["conviction"] / 4.0,
        "evidence": idea["evidence_supports_link"],
        "directness": idea["mechanism_is_direct"],
        "surprise": 1.0 - idea["already_priced_in"],
        "timeliness": idea["near_term_catalyst"],
    }
    total_weight = sum(w.values()) or 1.0
    score = sum(parts[k] * w.get(k, 0.0) for k in parts) / total_weight

    confidences = [idea["mechanism_confidence"], idea["direction_confidence"],
                   idea["conviction_confidence"], idea["exposure_confidence"]]
    weakest = min(confidences)

    if grounding.get("verdict") == "FAIL":
        route, why = "drop", f"grounding failed: {grounding.get('defect_class')}"
    elif grounding.get("verdict") == "REVIEW":
        route, why = "review", "a grounding answer landed in the uncertain band"
    elif idea["mechanism"] == "no_clear_mechanism":
        route, why = "drop", "no catalogued mechanism connects the event to this company"
    elif weakest < Q.ROUTING_CONFIDENCE_FLOOR:
        route, why = "review", f"lowest judgment confidence {weakest:.2f} is under the floor"
    elif idea["direction"] == "ambiguous":
        route, why = "review", "the direction of the effect is ambiguous"
    elif score >= 0.60:
        route, why = "publish", "grounded, confident, and above the rank threshold"
    else:
        route, why = "review", f"composite {score:.2f} is under the publish threshold"

    return {
        "score": round(score, 4),
        "parts": {k: round(v, 4) for k, v in parts.items()},
        "weakest_confidence": round(weakest, 4),
        "route": route,
        "route_reason": why,
    }
