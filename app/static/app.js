"use strict";

const $ = (id) => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const pct = (x) => `${Math.max(0, Math.min(100, x * 100)).toFixed(1)}%`;
const f2 = (x) => x.toFixed(2);

const FLOW = [
  ["data", "Stories", "from yfinance"],
  ["triage", "Triage", "market-moving?"],
  ["exposure", "Exposure", "which names"],
  ["mechanism", "Mechanism", "how it transmits"],
  ["grounding", "Grounding", "is it supported"],
  ["compose", "Publish", "after routing"],
];
const ROUTE = {
  publish: ["good", "●", "Publish"],
  review:  ["warn", "◑", "Review"],
  drop:    ["bad",  "○", "Drop"],
};
const VERDICT = { PASS: "good", REVIEW: "warn", FAIL: "bad" };

const Q = new URLSearchParams(location.search);
const PACE = Math.max(0, Math.min(3000, Number(Q.get("pace") || 0)));

const S = {
  inputs: null, watchlist: [], articles: [],
  triage: [], exposures: [], ideas: [], calls: [],
  weights: {}, flow: {}, expanded: new Set(), allOpen: false, running: false,
};

/* ── animated number ─────────────────────────────────────────── */
function tween(node, to, fmt = (v) => String(Math.round(v))) {
  const from = Number(node.dataset.v || 0);
  if (from === to) { node.textContent = fmt(to); return; }
  node.dataset.v = String(to);
  const t0 = performance.now(), dur = 420;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ── components ──────────────────────────────────────────────── */
function meter(label, value, marks = [], showBand) {
  const box = el("div", "meter");
  box.append(el("div", "lab", label));
  const val = el("div", "val");
  if (showBand) {
    const w = value >= 0.7 ? "yes" : value <= 0.3 ? "no" : "unclear";
    val.append(el("span", "band band-" + w, w));
  }
  val.append(el("span", null, f2(value)));
  box.append(val);
  const track = el("div", "track");
  const fill = el("i");
  fill.style.width = pct(value);
  track.append(fill);
  for (const m of marks) { const u = el("u"); u.style.left = pct(m); track.append(u); }
  box.append(track);
  return box;
}

function chip(text, tone, icon) {
  const c = el("span", `chip ${tone || ""}`.trim());
  if (icon) c.append(el("span", null, icon));
  c.append(el("span", null, text));
  return c;
}

/* ── funnel ──────────────────────────────────────────────────── */
function drawFlow() {
  const box = $("flow");
  const first = box.children.length === 0;
  if (first) {
    for (const [key, title] of FLOW) {
      const n = el("div", "node idle");
      n.dataset.key = key;
      n.append(el("div", "k", title));
      n.append(el("div", "v num", "—"));
      n.append(el("div", "s", ""));
      const u = el("div", "u"); u.append(el("i")); n.append(u);
      box.append(n);
    }
  }
  const base = S.flow.data?.value || 0;
  for (const node of box.children) {
    const f = S.flow[node.dataset.key];
    node.className = "node" + (!f ? " idle" : f.live ? " live" : f.terminal ? " terminal" : "");
    if (!f) continue;
    tween(node.querySelector(".v"), f.value);
    node.querySelector(".s").textContent = f.note || "";
    const share = f.share != null ? f.share : base ? Math.min(1, f.value / base) : 0;
    node.querySelector(".u i").style.width = pct(share);
  }
}

function flow(key, patch) { S.flow[key] = { ...(S.flow[key] || { value: 0 }), ...patch }; drawFlow(); }

/* ── live request stream ────────────────────────────────────── */
function streamReset() {
  $("stream-body").replaceChildren();
  $("stream-count").textContent = "0";
  S.streamed = 0;
}

function streamPush(call) {
  const body = $("stream-body");
  const row = el("div", "ev" + (call.error ? " err" : ""));
  row.append(el("div", "i", String(call.index).padStart(2, "0")));
  const l = el("div", "l");
  l.append(el("b", null, call.stage), document.createTextNode(" " + call.label));
  row.append(l);
  row.append(el("div", "t", call.elapsed_s ? `${call.elapsed_s.toFixed(2)}s` : "·"));
  body.append(row);
  body.scrollTop = body.scrollHeight;
  S.streamed = (S.streamed || 0) + 1;
  $("stream-count").textContent = String(S.streamed);
}

/* ── stats ───────────────────────────────────────────────────── */
function setStats(t) {
  const box = $("stats");
  box.hidden = false;
  box.replaceChildren();
  const cells = [
    [t.requests, "req"], [t.questions, "questions"],
    [t.input_tokens.toLocaleString(), "tokens"],
    [`$${t.usd.toFixed(5)}`, "cost"], [`${t.wall_clock_s}s`, "wall"],
  ];
  if (t.paced) cells.push(["paced", "ui only"]);
  if (t.errors) cells.push([t.errors, "errors"]);
  for (const [v, k] of cells) {
    const s = el("span");
    s.append(el("b", null, String(v)), document.createTextNode(" " + k));
    box.append(s);
  }
}

/* ── ideas ───────────────────────────────────────────────────── */
function score(idea) {
  const p = idea.composite.parts;
  let tot = 0, sum = 0;
  for (const [k, w] of Object.entries(S.weights)) { tot += w; sum += (p[k] ?? 0) * w; }
  return tot ? sum / tot : 0;
}

function routeOf(idea, s) {
  const g = idea.grounding || {};
  const floor = S.inputs.thresholds.routing_confidence_floor;
  if (g.verdict === "FAIL") return ["drop", `grounding failed — ${g.defect_class}`];
  if (g.verdict === "REVIEW") return ["review", "a grounding answer landed in the uncertain band"];
  if (idea.mechanism === "no_clear_mechanism") return ["drop", "no catalogued mechanism fits"];
  if (idea.composite.weakest_confidence < floor)
    return ["review", `weakest judgment confidence ${f2(idea.composite.weakest_confidence)} is under the floor`];
  if (idea.direction === "ambiguous") return ["review", "the direction of the effect is ambiguous"];
  if (s >= 0.6) return ["publish", "grounded, confident and above the rank threshold"];
  return ["review", `composite ${f2(s)} is under the publish threshold`];
}

const ORDER = { publish: 0, review: 1, drop: 2 };

function drawIdeas() {
  if (!S.ideas.length) return;
  $("ideas-wrap").hidden = false;
  $("hero").hidden = true;

  const rows = S.ideas
    .map((idea) => { const s = score(idea); const [r, why] = routeOf(idea, s); return { idea, s, r, why }; })
    .sort((a, b) => ORDER[a.r] - ORDER[b.r] || b.s - a.s);

  const n = { publish: 0, review: 0, drop: 0 };
  for (const r of rows) n[r.r]++;
  const tal = $("tallies");
  tal.replaceChildren();
  for (const k of ["publish", "review", "drop"]) {
    const s = el("span");
    const sw = el("i", "sw");
    sw.style.background = `var(--${k === "publish" ? "good" : k === "review" ? "warning" : "critical"})`;
    s.append(sw, el("b", null, String(n[k])), document.createTextNode(" " + k));
    tal.append(s);
  }

  const wrap = $("ideas");
  wrap.replaceChildren();
  rows.forEach((row, i) => {
    const { idea, s } = row;
    const g = idea.grounding || {};
    const key = `${idea.article_id}/${idea.ticker}`;
    const open = S.allOpen || S.expanded.has(key);

    const card = el("div", `idea r-${row.r}`);
    card.style.animationDelay = `${Math.min(i, 10) * 22}ms`;

    const head = el("div", "head");
    head.append(el("div", "rk", String(i + 1).padStart(2, "0")));

    const mid = el("div");
    const who = el("div", "who");
    who.append(el("span", "ticker", idea.ticker), el("span", "co", idea.company));
    mid.append(who, el("div", "hl", idea.headline));
    const facts = el("div", "facts");
    facts.append(el("span", "tag", idea.mechanism));
    facts.append(chip(idea.direction,
      idea.direction === "negative" ? "bad" : idea.direction === "positive" ? "good" : "warn",
      idea.direction === "negative" ? "↓" : idea.direction === "positive" ? "↑" : "↔"));
    if (g.verdict) facts.append(chip(`grounding ${g.verdict.toLowerCase()}`, VERDICT[g.verdict]));
    mid.append(facts);
    head.append(mid);

    const right = el("div", "right");
    const [tone, icon, label] = ROUTE[row.r];
    right.append(chip(label, tone, icon));
    const sb = el("div", "scorebox");
    const spark = el("div", "spark");
    const bar = el("i", row.r === "drop" ? "c" : row.r === "review" ? "w" : "");
    bar.style.width = pct(s);
    spark.append(bar);
    sb.append(spark, el("b", null, f2(s)));
    right.append(sb);
    head.append(right);

    head.addEventListener("click", () => {
      S.expanded.has(key) ? S.expanded.delete(key) : S.expanded.add(key);
      S.allOpen = false;
      drawIdeas();
    });
    card.append(head);

    if (open) {
      const d = el("div", "detail");
      if (g.thesis) {
        const t = el("div", "thesis");
        t.append(el("q", null, g.thesis.reported_fact));
        const read = el("div", "read");
        read.append(document.createTextNode(g.thesis.desk_read + " Mechanism assigned from the catalogue: "));
        read.append(el("span", "tag", g.thesis.assigned_mechanism));
        read.append(document.createTextNode("."));
        t.append(read);
        d.append(t);
      }
      const m1 = el("div", "meters");
      m1.append(meter("evidence supports the link", idea.evidence_supports_link, [0.3, 0.7]));
      m1.append(meter("mechanism is direct", idea.mechanism_is_direct, [0.3, 0.7]));
      m1.append(meter("already priced in", idea.already_priced_in, [0.3, 0.7]));
      m1.append(meter("near-term catalyst", idea.near_term_catalyst, [0.3, 0.7]));
      d.append(m1);
      if (g.read_supported != null) {
        const m2 = el("div", "meters sub");
        m2.append(meter("quoted fact is faithful", g.reported_fact_faithful, [0.3, 0.7], true));
        m2.append(meter("desk read is supported", g.read_supported, [0.3, 0.7], true));
        m2.append(meter("acting subject preserved", g.subject_preserved, [0.3, 0.7], true));
        m2.append(meter("does not overstate", g.no_overstatement, [0.3, 0.7], true));
        d.append(m2);
      }
      d.append(el("div", "why",
        `${row.why}  ·  exposure ${f2(idea.exposure)}  ·  conviction ${f2(idea.conviction)}  ·  req #${idea.call}, #${g.call ?? "—"}`));
      card.append(d);
    }
    wrap.append(card);
  });
}

function drawWeights() {
  const box = $("weights");
  box.replaceChildren();
  for (const [k, v] of Object.entries(S.weights)) {
    const w = el("div", "weight");
    const lab = el("label");
    const out = el("span", null, f2(v));
    lab.append(el("span", null, k), out);
    const input = el("input");
    Object.assign(input, { type: "range", min: "0", max: "1", step: "0.05", value: String(v) });
    input.addEventListener("input", () => {
      S.weights[k] = +input.value;
      out.textContent = f2(+input.value);
      drawIdeas();
    });
    w.append(lab, input);
    box.append(w);
  }
}

/* ── pipeline tab ────────────────────────────────────────────── */
function drawTriage() {
  const t = $("triage");
  t.replaceChildren();
  const head = el("tr");
  for (const h of ["Story", "Feed", "Market-moving", "Event", "Impact", "Rumour", "Guard", "Gate"])
    head.append(el("th", null, h));
  t.append(head);
  for (const row of S.triage) {
    const tr = el("tr", row.passed ? "" : "gone");
    const first = el("td");
    first.append(el("div", null, row.article.headline));
    first.append(el("div", "dim", row.article.source));
    tr.append(first);
    tr.append(el("td", "n dim", row.article.surfaced_under || "—"));
    if (row.error) {
      const e = el("td", "dim"); e.colSpan = 6; e.textContent = row.error;
      tr.append(e); t.append(tr); continue;
    }
    const mm = el("td");
    mm.style.minWidth = "104px";
    mm.append(meter("", row.market_moving, [S.inputs.thresholds.market_moving_floor]));
    tr.append(mm);
    const et = el("td"); et.append(el("span", "tag", row.event_type)); tr.append(et);
    tr.append(el("td", "n", f2(row.impact_magnitude)));
    tr.append(el("td", "n", f2(row.is_unconfirmed_rumor)));
    tr.append(el("td", "n" + (row.contains_injected_instruction >= S.inputs.thresholds.injection_floor ? "" : " dim"),
      f2(row.contains_injected_instruction)));
    const gate = el("td");
    if (row.passed) gate.append(chip("kept", "good", "✓"));
    else {
      for (const reason of row.reasons) {
        const bad = reason.startsWith("quarantined");
        gate.append(chip(reason.split(":")[0], bad ? "bad" : "warn", bad ? "⚠" : "○"));
      }
      gate.append(el("div", "dim", row.reasons.map((r) => r.split(": ")[1]).join("; ")));
    }
    tr.append(gate);
    t.append(tr);
  }
}

function drawExposure() {
  const wrap = $("exposure");
  wrap.replaceChildren();
  for (const ex of S.exposures) {
    if (ex.error) continue;
    const art = S.triage.find((t) => t.article.id === ex.article_id);
    const d = el("details", "expo sheet flush");
    const sum = el("summary");
    sum.append(el("span", "grow", art ? art.article.headline : ex.article_id));
    sum.append(el("span", "ticker", ex.most_exposed));
    sum.append(el("span", "tag", `${ex.questions_in_one_call} questions · 1 request · conf ${f2(ex.most_exposed_confidence)}`));
    d.append(sum);
    const body = el("div", "body2");
    const grid = el("div", "meters");
    for (const n of ex.names) {
      const box = el("div", "meter");
      const lab = el("div", "lab");
      lab.append(el("span", "ticker", n.ticker));
      lab.append(document.createTextNode(" " + n.label.split(".")[0].toLowerCase()));
      box.append(lab, el("div", "val", f2(n.score)));
      const track = el("div", "track");
      const fill = el("i");
      fill.style.width = pct(n.score / 4);
      if (!n.above_floor) fill.style.opacity = "0.28";
      track.append(fill);
      const u = el("u"); u.style.left = pct(S.inputs.thresholds.exposure_floor / 4); track.append(u);
      box.append(track);
      grid.append(box);
    }
    body.append(grid);
    d.append(body);
    wrap.append(d);
  }
}

function drawWatchlist() {
  const t = $("wl");
  t.replaceChildren();
  const head = el("tr");
  for (const h of ["Ticker", "Company", "Sector", "Industry", "Last", "Profile"]) head.append(el("th", null, h));
  t.append(head);
  for (const c of S.watchlist) {
    const tr = el("tr");
    const td = el("td"); td.append(el("span", "ticker", c.ticker));
    tr.append(td, el("td", null, c.name), el("td", "dim", c.sector), el("td", "dim", c.industry));
    tr.append(el("td", "n", c.price == null ? "—" : `${c.price}`));
    tr.append(el("td", "dim", c.business));
    t.append(tr);
  }
}

/* ── request log ─────────────────────────────────────────────── */
function drawCalls() {
  const wrap = $("calls");
  wrap.replaceChildren();
  for (const call of S.calls) {
    const d = el("details", "call");
    const s = el("summary");
    s.append(el("span", "dim", String(call.index).padStart(2, "0")));
    s.append(el("span", "st", call.stage));
    s.append(el("span", "grow", call.label));
    s.append(el("span", "dim", `${call.question_count}q`));
    s.append(el("span", "dim", `${call.input_tokens}tok`));
    s.append(el("span", "dim", `${call.elapsed_s.toFixed(2)}s`));
    if (call.error) s.append(chip("error", "bad", "⚠"));
    d.append(s);
    const body = el("div", "call-body");
    const left = el("div");
    left.append(el("h4", null, "state"), Object.assign(el("pre"), { textContent: JSON.stringify(call.state, null, 2) }));
    const right = el("div");
    right.append(el("h4", null, "questions"), Object.assign(el("pre"), { textContent: JSON.stringify(call.questions, null, 2) }));
    const ans = el("div");
    ans.style.gridColumn = "1 / -1";
    ans.append(el("h4", null, call.error ? "error" : `answers · ${call.model} · ${call.request_id || ""}`));
    ans.append(Object.assign(el("pre"), { textContent: call.error || JSON.stringify(call.answers, null, 2) }));
    body.append(left, right, ans);
    d.append(body);
    wrap.append(d);
  }
}

/* ── run ─────────────────────────────────────────────────────── */
function fail(message) {
  const h = $("hero");
  h.hidden = false;
  h.replaceChildren();
  const p = el("div", "sheet fail");
  p.append(el("h3", null, "Run failed"), el("p", "body", message));
  h.append(p);
  S.running = false;
  $("run").disabled = false;
  $("run").classList.remove("busy");
  $("run-label").textContent = "Run";
}

async function run() {
  const b = $("run");
  S.running = true;
  b.disabled = true;
  b.classList.add("busy");
  $("run-label").textContent = "Running";
  Object.assign(S, { triage: [], exposures: [], ideas: [], calls: [], flow: {}, expanded: new Set(), allOpen: false });
  $("ideas-wrap").hidden = true;
  $("hero").hidden = true;
  $("flow").replaceChildren();
  streamReset();
  drawFlow();

  let res;
  try {
    res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pace_ms: PACE }) });
  } catch (e) { fail(String(e)); return; }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop();
    for (const f of frames) {
      const e = /^event: (.+)$/m.exec(f);
      const d = /^data: (.+)$/m.exec(f);
      if (e && d) handle(e[1], JSON.parse(d[1]));
    }
  }
  S.running = false;
  b.disabled = false;
  b.classList.remove("busy");
  $("run-label").textContent = "Run again";
}

function handle(event, data) {
  document.dispatchEvent(new CustomEvent("desk:event", { detail: { event, data } }));
  switch (event) {
    case "stage":
      if (data.stage !== "data") flow(data.stage, { value: 0, live: true, note: `0 of ${data.units}` , share: 0 });
      break;
    case "stage_done": {
      const f = S.flow[data.stage] || { value: 0 };
      flow(data.stage, {
        live: false,
        value: data.kept != null ? data.kept : f.value,
        note: data.kept != null ? (data.stage === "grounding" ? `${data.kept} passed of ${data.of}` : `of ${data.of}`) : f.note,
      });
      break;
    }
    case "data":
      S.watchlist = data.watchlist;
      S.articles = data.articles;
      flow("data", { value: data.articles.length, share: 1, note: `${data.watchlist.length} names` });
      drawWatchlist();
      break;
    case "triage":
      S.triage.push(data);
      if (data.call) streamPush({ index: data.call, stage: "triage", label: data.article.headline.slice(0, 54), elapsed_s: 0, error: data.error });
      flow("triage", { value: S.triage.filter((t) => t.passed).length, note: `of ${S.articles.length}` });
      drawTriage();
      break;
    case "exposure":
      S.exposures.push(data);
      if (data.call) streamPush({ index: data.call, stage: "exposure", label: `${data.names?.length || 0} names scored`, elapsed_s: 0, error: data.error });
      flow("exposure", { value: S.exposures.reduce((a, e) => a + (e.names || []).filter((n) => n.above_floor).length, 0) });
      drawExposure();
      break;
    case "mechanism":
      flow("mechanism", { value: (S.flow.mechanism?.value || 0) + 1 });
      if (data.call) streamPush({ index: data.call, stage: "mechanism", label: `${data.ticker} · ${data.mechanism || "—"}`, elapsed_s: 0, error: data.error });
      break;
    case "grounding":
      flow("grounding", { value: (S.flow.grounding?.value || 0) + 1 });
      if (data.call) streamPush({ index: data.call, stage: "grounding", label: `${data.ticker} · ${data.verdict || "—"}`, elapsed_s: 0, error: data.error });
      break;
    case "done": {
      S.ideas = data.ideas || [];
      S.calls = data.calls || [];
      const pub = S.ideas.filter((x) => x.composite.route === "publish").length;
      flow("compose", {
        value: pub, live: false, terminal: true,
        note: `of ${S.ideas.length} ranked · 0 requests`,
        share: S.ideas.length ? pub / S.ideas.length : 0,
      });
      if (data.totals) setStats(data.totals);
      drawIdeas();
      drawCalls();
      streamReset();
      for (const c of S.calls) streamPush(c);
      if (!S.ideas.length) {
        $("hero").hidden = false;
        $("hero").replaceChildren(
          el("h2", null, "No story cleared the gates this run."),
          el("p", null, "Yahoo's feed is genuinely noisy and the filter is doing its job."),
          el("p", "dim", "Open Pipeline to see exactly what triage dropped and why.")
        );
      }
      break;
    }
    case "fatal": fail(data.error); break;
  }
}

/* ── tabs ────────────────────────────────────────────────────── */
for (const tab of document.querySelectorAll(".seg button")) {
  tab.addEventListener("click", () => {
    for (const o of document.querySelectorAll(".seg button")) {
      const on = o === tab;
      o.setAttribute("aria-selected", String(on));
      $("tab-" + o.dataset.tab).hidden = !on;
    }
  });
}

$("toggle-weights").addEventListener("click", (e) => {
  const p = $("weights-panel");
  p.hidden = !p.hidden;
  e.currentTarget.setAttribute("aria-expanded", String(!p.hidden));
});
$("toggle-all").addEventListener("click", (e) => {
  S.allOpen = !S.allOpen;
  S.expanded.clear();
  e.currentTarget.textContent = S.allOpen ? "Collapse all" : "Expand all";
  drawIdeas();
});

function setTheme(mode) {
  document.documentElement.dataset.theme = mode;
  try { localStorage.setItem("desk-theme", mode); } catch {}
}

/* ── public hooks (used by tour.js) ──────────────────────────── */
window.Desk = {
  run,
  state: S,
  tab(name) { document.querySelector(`.seg button[data-tab="${name}"]`).click(); },
  setTheme: (m) => setTheme(m),
};

/* ── theme ──────────────────────────────────────────────────── */
$("theme").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

/* ── boot ────────────────────────────────────────────────────── */
(async () => {
  let saved = null;
  try { saved = localStorage.getItem("desk-theme"); } catch {}
  setTheme(Q.get("theme") || saved || "dark");
  if (PACE) $("stats").classList.add("paced");
  try {
    S.inputs = await (await fetch("/api/inputs")).json();
  } catch (e) { fail(`could not load inputs: ${e}`); return; }
  S.weights = { ...S.inputs.weights };
  S.watchlist = S.inputs.watchlist || [];
  drawWeights();
  drawWatchlist();
  if (!S.inputs.key_present) { fail("TYPESAFE_API_KEY is not set in the server environment. Start with ./run.sh"); return; }
  $("run").addEventListener("click", run);
  if (Q.get("autorun") === "1" && Q.get("demo") !== "1") setTimeout(run, 650);
  document.dispatchEvent(new CustomEvent("desk:ready"));
})();
