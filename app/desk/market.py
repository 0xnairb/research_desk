"""Live market data from yfinance, normalised into the shapes the pipeline expects.

Yahoo's feed is genuinely noisy -- a ticker's news list routinely carries stories about
other companies, video segments and market round-ups. That is the point: stage 1 has
real work to do, rather than a curated set that was always going to pass.
"""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from pathlib import Path
from typing import Any

import yfinance as yf

CACHE = Path(__file__).parent.parent / ".cache"
CACHE_TTL_S = 15 * 60
BUSINESS_CHARS = 520
BODY_CHARS = 700
SKIP_CONTENT_TYPES = {"VIDEO", "SLIDESHOW"}

# The investable universe is code's, not a model's. Edit here to change the desk.
UNIVERSE: tuple[str, ...] = ("NVDA", "TSM", "FCX", "XOM", "JPM", "CAT")

_TAGS = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def _clean(text: str | None) -> str:
    if not text:
        return ""
    return _SPACE.sub(" ", unescape(_TAGS.sub(" ", text))).strip()


def _cached(key: str, build, ttl: int = CACHE_TTL_S) -> Any:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{key}.json"
    if path.exists() and time.time() - path.stat().st_mtime < ttl:
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            pass
    value = build()
    path.write_text(json.dumps(value, indent=2, default=str))
    return value


def _profile(ticker: str) -> dict[str, Any] | None:
    try:
        info = yf.Ticker(ticker).info or {}
    except Exception:  # noqa: BLE001 - one bad ticker must not sink the run
        return None
    name = info.get("longName") or info.get("shortName")
    if not name:
        return None
    business = _clean(info.get("longBusinessSummary"))
    if len(business) > BUSINESS_CHARS:
        business = business[:BUSINESS_CHARS].rsplit(" ", 1)[0] + "…"
    return {
        "ticker": ticker,
        "name": name,
        "sector": info.get("sector") or "Unknown",
        "industry": info.get("industry") or "Unknown",
        "business": business or f"{name} is a listed company; no profile summary was served.",
        "market_cap": info.get("marketCap"),
        "price": info.get("currentPrice") or info.get("regularMarketPrice"),
        "currency": info.get("currency") or "USD",
    }


def load_watchlist(tickers: tuple[str, ...] = UNIVERSE) -> list[dict[str, Any]]:
    """Company profiles for the universe, in the order code declared them."""
    def build() -> list[dict[str, Any]]:
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(_profile, tickers))
        return [row for row in rows if row]

    return _cached(f"watchlist-{'-'.join(tickers)}", build)


def _news_for(ticker: str) -> list[dict[str, Any]]:
    try:
        raw = yf.Ticker(ticker).news or []
    except Exception:  # noqa: BLE001
        return []
    items = []
    for entry in raw:
        content = entry.get("content") or {}
        if content.get("contentType") in SKIP_CONTENT_TYPES:
            continue
        headline = _clean(content.get("title"))
        body = _clean(content.get("summary")) or _clean(content.get("description"))
        if not headline or len(body) < 40:
            continue
        if len(body) > BODY_CHARS:
            body = body[:BODY_CHARS].rsplit(" ", 1)[0] + "…"
        provider = (content.get("provider") or {}).get("displayName") or "Unknown"
        url = ((content.get("canonicalUrl") or content.get("clickThroughUrl")) or {}).get("url")
        items.append({
            "id": entry.get("id") or content.get("id"),
            "headline": headline,
            "body": body,
            "source": provider,
            "published_at": content.get("pubDate") or "",
            "url": url,
            "surfaced_under": ticker,
        })
    return items


def load_news(
    tickers: tuple[str, ...] = UNIVERSE, limit: int = 8
) -> list[dict[str, Any]]:
    """Recent stories surfaced under the universe, deduplicated and newest first.

    Yahoo surfaces a story under a ticker's feed without promising it is about that
    company, so `surfaced_under` is retained as provenance and is never treated as a
    judgment. Deciding what a story actually touches is stages 1 and 2.
    """
    def build() -> list[dict[str, Any]]:
        with ThreadPoolExecutor(max_workers=8) as pool:
            batches = list(pool.map(_news_for, tickers))
        for batch in batches:
            batch.sort(key=lambda x: x["published_at"], reverse=True)
        # Round-robin rather than a global recency sort: one busy feed would otherwise
        # crowd out every other name in the universe.
        seen: set[str] = set()
        rows: list[dict[str, Any]] = []
        for rank in range(max((len(b) for b in batches), default=0)):
            for batch in batches:
                if rank >= len(batch):
                    continue
                item = batch[rank]
                if item["id"] and item["id"] not in seen:
                    seen.add(item["id"])
                    rows.append(item)
        return rows

    rows = _cached(f"news-{'-'.join(tickers)}", build)
    return rows[:limit]


def article_state(article: dict[str, Any]) -> dict[str, Any]:
    """The view of one story the model is allowed to see.

    `surfaced_under` and `url` are dropped. Yahoo files a story under a ticker's feed
    without promising it is about that company, so passing it in would hand the model
    a conclusion it is being asked to reach.
    """
    return {
        key: article[key]
        for key in ("id", "source", "published_at", "headline", "body")
        if key in article
    }
