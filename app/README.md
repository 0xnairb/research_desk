# Research Desk

Live company profiles and headlines from **yfinance**, read by a TypeSafe System One model
into ranked, grounded, routed trade ideas. Built as a showcase of what the model is for.

Every number the UI shows is a typed answer from one request, and the **Requests** tab shows
the exact state and questions behind any of them.

```bash
./run.sh              # reads ../.env, serves on http://127.0.0.1:8765
PORT=9000 ./run.sh    # somewhere else
```

The UI is a full-height app shell: header, funnel, then a results pane beside a live request
stream. Dark by default; the header toggle switches to light and the choice is remembered.
Below 1080px the stream is dropped; below 760px the shell becomes an ordinary scrolling page.

## Autonomous demo

```
http://127.0.0.1:8765/?demo=1&pace=600
```

Loads, starts a real run, and then drives itself through the whole product in about a minute
— no cursor needed. A synthetic pointer moves to each control and clicks it, and a caption bar
narrates the fourteen beats with a progress bar and step counter. **Esc** stops it at any
point, as does the **Demo** button in the header.

The tour clicks the real UI. Every click is a real click on a real element, and the run it
narrates is a real run against the live API — the tour only decides what to look at and when.
Nothing is pre-recorded or replayed.

What it covers, in order:

1. Opening frame.
2. Taps **Run**; captions follow the funnel filling stage by stage.
3. Walks the six funnel nodes, stories through publish.
4. The publish / review / drop tallies.
5. Expands the top idea — quoted fact, desk read, the judgments behind both.
6. The grounding band: YES / UNCLEAR / NO drawn in code.
7. Opens **Weights**, drags a slider, points at the unchanged request counter.
8. **Pipeline** tab — what triage dropped and why.
9. The injection-guard column.
10. Expands an exposure card — seven questions, one request.
11. The universe table, live from yfinance.
12. **Requests** tab — expands one call to show state and typed answers.
13. **Method** tab.
14. Back to **Ideas** with the run's totals.

## Recording a run

| Param | Effect |
|---|---|
| `demo=1` | the autonomous tour above |
| `autorun=1` | just starts the run on load, no tour |
| `pace=<ms>` | pauses between stages (0–3000) so the funnel is followable on camera |
| `theme=dark` / `theme=light` | forces a theme for the take |

**Pacing does not change how the work is done.** It inserts a sleep *between* stages only;
request concurrency and latency are untouched, and the reported wall clock has the injected
pauses subtracted back out. The header shows **paced · ui only** whenever it is on, so a
recording never implies the run was slower than it was.

Warm the yfinance cache with one throwaway run first (`curl -s -X POST
localhost:8765/api/run -d "{}" -H "Content-Type: application/json" > /dev/null`); the cache
holds 15 minutes, so the take will not stall on a slow Yahoo fetch. For a clean frame, record
at 1440×900 or wider — below 1080px the live request stream is dropped.

## Data

`desk/market.py` pulls from yfinance and caches for 15 minutes under `.cache/`:

- **Watchlist** — `Ticker.info` for the universe in `UNIVERSE`: name, sector, industry, the
  business summary (truncated), last price. Edit `UNIVERSE` to change the desk.
- **Stories** — `Ticker.news` across the universe, HTML stripped, deduplicated, then taken
  **round-robin** rather than by global recency so one busy feed cannot crowd out every other
  name.

Yahoo's feed is genuinely noisy: a ticker's news list routinely carries stories about other
companies, market round-ups and listicles. That is the point — stage 1 has real work to do
rather than a curated set that was always going to pass.

**Provenance is not a judgment.** Yahoo files a story under a ticker's feed without promising
it is about that company, so `surfaced_under` is shown in the UI and deliberately stripped from
the state the model sees (`market.article_state`). Passing it in would hand the model a
conclusion it is being asked to reach.

## The five stages

| # | Stage | Requests | What the model decides |
|---|---|---|---|
| 1 | **Triage** | 1 per story | market-moving (Noul) · event type (Choice) · magnitude (Score) · horizon (Choice) · unconfirmed rumour (Noul) · injected instruction (Noul) |
| 2 | **Exposure** | 1 per surviving story | one Score per watchlist name **plus** a summary Choice, all in the same request |
| 3 | **Mechanism** | 1 per story×name pair | mechanism (Choice over a code-owned catalogue) · direction (Choice) · four Nouls probing the link |
| 4 | **Grounding** | 1 per idea | quoted fact faithful · desk read supported · subject preserved · no overstatement · defect class |
| 5 | **Composition** | **none** | pure arithmetic in code |

## What the demo is showing

- **Fan-out.** Stage 2 asks seven questions — one per watchlist name plus a summary Choice —
  in a single call. Six names cost one request, not six.
- **Select, don't generate.** The mechanism comes from a nine-entry catalogue in
  `desk/fixtures.py`, so it is always one of nine known values. Nothing parses prose.
- **Guardrails are ordinary questions.** Every story is scored for whether its text tries to
  instruct the reader, in the same request as the rest of triage and at no extra cost. Real
  headlines score ~0.03–0.10; anything over the floor is quarantined before a later stage sees
  it. The Pipeline tab shows the score per story under **Guard**.
- **Uncertainty code owns.** Grounding probabilities land in a YES / UNCLEAR / NO band drawn
  in `desk/questions.py`, not an "unclear" token the model elects. Choice and Score answers
  carry confidence, and an idea whose weakest judgment confidence falls under the floor is
  routed to review however good its score.
- **Re-weighting is free.** The sliders behind **Weights** re-rank in the browser and the
  request counter does not move.
- **Second-order links score lower, correctly.** A story that never names the company scores
  well below one that does, and exposure *through* another company lower still.

## Layout

```
desk/market.py      yfinance loaders, cache, and the state projection
desk/questions.py   every question, and every threshold code decides on
desk/pipeline.py    the five stages, call recording, composition and routing
desk/fixtures.py    the mechanism catalogue
server.py           FastAPI; holds the API key, streams stage events over SSE
static/             the UI
```

## Honesty notes

Profiles, prices and headlines are live and shown as retrieved; the desk does not clean up
what Yahoo returns. Nothing here is investment advice. There is no synthetic data anywhere in
the app. Thresholds in `desk/questions.py` are
starting guesses, not values fitted to real outcomes — on a real desk you would tune them on
your own data and the cost of being wrong. With a noisy live feed, plenty of runs produce one
publishable idea or none; that is the filter working, not a failure.

The grounding stage is carried over from an earlier set of coverage-card experiments,
where it was measured against a labelled fixture set. An earlier thesis template welded a
generic mechanism definition onto a specific headline, and stage 4 flagged every idea as
`unsupported_relationship` — correctly, because the template really was asserting a causal link
no story stated. The fix was splitting `reported_fact` (copied verbatim) from `desk_read` (the
desk's inference) so the two are held to different standards.
