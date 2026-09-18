"""Research desk server. The API key stays here and never reaches the browser."""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from typesafe_sdk import AsyncTypeSafeClient

from desk import questions as Q
from desk.fixtures import MECHANISMS
from desk.market import UNIVERSE, load_news, load_watchlist
from desk.pipeline import DEFAULT_WEIGHTS, USD_PER_INPUT_TOKEN, Desk, compose

HERE = Path(__file__).parent
app = FastAPI(title="Jev research desk")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(HERE / "static" / "index.html")


@app.get("/api/inputs")
async def inputs() -> dict[str, Any]:
    watchlist = await asyncio.to_thread(load_watchlist)
    articles = await asyncio.to_thread(load_news)
    return {
        "articles": articles,
        "watchlist": watchlist,
        "universe": list(UNIVERSE),
        "mechanisms": MECHANISMS,
        "weights": DEFAULT_WEIGHTS,
        "thresholds": {
            "market_moving_floor": Q.MARKET_MOVING_FLOOR,
            "rumor_ceiling": Q.RUMOR_CEILING,
            "injection_floor": Q.INJECTION_FLOOR,
            "exposure_floor": Q.EXPOSURE_FLOOR,
            "grounding_yes": Q.GROUNDING_YES,
            "grounding_no": Q.GROUNDING_NO,
            "routing_confidence_floor": Q.ROUTING_CONFIDENCE_FLOOR,
        },
        "key_present": bool(os.environ.get("TYPESAFE_API_KEY")),
    }


async def run_pipeline(payload: dict[str, Any]):
    """Drive the five stages, streaming one SSE frame per completed unit.

    `pace_ms` inserts a pause between stages so a screen recording can follow the
    funnel. It never changes how the work is done: request latency is untouched and
    the reported wall clock has the injected pauses subtracted back out.
    """
    try:
        pace = max(0.0, min(3000.0, float(payload.get("pace_ms") or 0))) / 1000
    except (TypeError, ValueError):
        pace = 0.0
    paused = 0.0
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()

    async def emit(event: str, data: dict[str, Any]) -> None:
        await queue.put((event, data))

    async def beat() -> None:
        nonlocal paused
        if pace:
            await asyncio.sleep(pace)
            paused += pace

    async def drive() -> None:
        nonlocal paused
        started = time.perf_counter()
        try:
            await emit("stage", {"stage": "data", "units": 0})
            watchlist = await asyncio.to_thread(load_watchlist)
            articles = await asyncio.to_thread(load_news)
            if not watchlist or not articles:
                raise RuntimeError(
                    "yfinance returned no watchlist or no stories. Yahoo may be rate-limiting; "
                    "try again in a minute."
                )
            await emit("data", {"articles": articles, "watchlist": watchlist})

            async with AsyncTypeSafeClient() as client:
                desk = Desk(client)

                await emit("stage", {"stage": "triage", "units": len(articles)})
                triaged = await asyncio.gather(
                    *(desk.triage(article, emit) for article in articles)
                )
                survivors = [t for t in triaged if t.get("passed")]
                await emit("stage_done", {
                    "stage": "triage", "kept": len(survivors), "of": len(articles)})
                await beat()

                if not survivors:
                    await emit("done", {"ideas": [], "calls": desk.calls})
                    return

                await emit("stage", {"stage": "exposure", "units": len(survivors)})
                exposures = await asyncio.gather(*(
                    desk.exposure(t["article"], watchlist, emit) for t in survivors
                ))
                by_article = {t["article"]["id"]: t for t in survivors}
                company_by_ticker = {c["ticker"]: c for c in watchlist}

                pairs = [
                    (by_article[exposure["article_id"]]["article"],
                     company_by_ticker[name["ticker"]], name)
                    for exposure in exposures
                    for name in exposure["names"]
                    if name["above_floor"]
                ]
                await emit("stage_done", {
                    "stage": "exposure", "kept": len(pairs),
                    "of": len(survivors) * len(watchlist)})
                await beat()

                if not pairs:
                    await emit("done", {"ideas": [], "calls": desk.calls})
                    return

                await emit("stage", {"stage": "mechanism", "units": len(pairs)})
                ideas = await asyncio.gather(*(
                    desk.mechanism(article, company, name, emit)
                    for article, company, name in pairs
                ))
                ideas = [idea for idea in ideas if not idea.get("error")]
                await emit("stage_done", {"stage": "mechanism", "kept": len(ideas),
                                          "of": len(pairs)})
                await beat()

                await emit("stage", {"stage": "grounding", "units": len(ideas)})
                grounded = await asyncio.gather(*(
                    desk.grounding(by_article[idea["article_id"]]["article"],
                                   company_by_ticker[idea["ticker"]], idea, emit)
                    for idea in ideas
                ))
                passed = sum(1 for review in grounded if review.get("verdict") == "PASS")
                await emit("stage_done", {
                    "stage": "grounding", "kept": passed, "of": len(grounded)})
                await beat()

                merged = []
                for idea, review in zip(ideas, grounded, strict=True):
                    merged.append({
                        **idea,
                        "grounding": review,
                        "composite": compose(idea, review),
                        "headline": by_article[idea["article_id"]]["article"]["headline"],
                    })
                merged.sort(key=lambda item: item["composite"]["score"], reverse=True)

                tokens = sum(call["input_tokens"] for call in desk.calls)
                await emit("done", {
                    "ideas": merged,
                    "triage": triaged,
                    "exposures": exposures,
                    "calls": desk.calls,
                    "totals": {
                        "requests": len(desk.calls),
                        "questions": sum(call["question_count"] for call in desk.calls),
                        "input_tokens": tokens,
                        "output_tokens": sum(call["output_tokens"] for call in desk.calls),
                        "usd": round(tokens * USD_PER_INPUT_TOKEN, 6),
                        "wall_clock_s": round(time.perf_counter() - started - paused, 2),
                        "paced": bool(pace),
                        "errors": sum(1 for call in desk.calls if call["error"]),
                    },
                })
        except Exception as exc:  # noqa: BLE001 - always reaches the UI
            await emit("fatal", {"error": f"{type(exc).__name__}: {exc}"})
        finally:
            await queue.put(None)

    task = asyncio.create_task(drive())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            event, data = item
            yield f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
    finally:
        await task


@app.post("/api/run")
async def run(payload: dict[str, Any] | None = None) -> StreamingResponse:
    return StreamingResponse(
        run_pipeline(payload or {}),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
