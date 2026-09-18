# Research Desk

A TypeSafe **Jev** demonstration: live company profiles and headlines from yfinance, read by a
System One model into ranked, grounded, routed trade ideas — fast analysis of news and tickers.

Every number the UI shows is a typed answer from one request, and the **Requests** tab shows the
exact state and questions behind any of them.

```bash
cp .env.example .env     # add your TYPESAFE_API_KEY
cd app && ./run.sh       # serves on http://127.0.0.1:8765
```

See [`app/README.md`](app/README.md) for the five stages, the autonomous demo tour, the data
sources, and what the demo is meant to show.

## Layout

```
app/desk/market.py      yfinance loaders, cache, and the state projection
app/desk/questions.py   every question, and every threshold code decides on
app/desk/pipeline.py    the five stages, call recording, composition and routing
app/desk/fixtures.py    the mechanism catalogue
app/server.py           FastAPI; holds the API key, streams stage events over SSE
app/static/             the UI
```

Nothing here is investment advice. Profiles, prices and headlines are live and shown as
retrieved; thresholds are starting guesses, not values fitted to real outcomes.
