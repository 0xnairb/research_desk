"use strict";
/* Autonomous end-to-end demo. Drives the real UI — every click below is a real
   click on a real element, and the run it narrates is a real run. Nothing is faked
   or pre-recorded; the tour only decides what to look at and when. */

(() => {
  const Q = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const T = { on: false, abort: false, step: 0, total: 0 };

  /* ── narration + synthetic cursor ─────────────────────────── */
  function say(text, sub) {
    const cap = $("cap");
    cap.hidden = false;
    $("cap-text").textContent = text;
    $("cap-sub").textContent = sub || "";
    $("cap-sub").hidden = !sub;
    $("cap-step").textContent = T.total ? `${T.step}/${T.total}` : "";
    const bar = $("cap-bar");
    bar.style.width = T.total ? `${(T.step / T.total) * 100}%` : "0%";
  }

  function hideCap() { $("cap").hidden = true; }

  function cursorTo(node, { edge = "center" } = {}) {
    const c = $("cursor");
    const r = node.getBoundingClientRect();
    const x = edge === "left" ? r.left + Math.min(60, r.width * 0.25) : r.left + r.width / 2;
    const y = r.top + r.height / 2;
    c.hidden = false;
    c.style.transform = `translate(${x}px, ${y}px)`;
  }

  async function point(node, hold = 620) {
    if (!node) return;
    cursorTo(node);
    await sleep(hold);
  }

  async function tap(node, hold = 430) {
    if (!node) return;
    cursorTo(node);
    await sleep(hold);
    const c = $("cursor");
    c.classList.add("tap");
    await sleep(180);
    c.classList.remove("tap");
    node.click();
    await sleep(340);
  }

  async function bring(node, block = "center") {
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block });
    await sleep(560);
  }

  /* ── stage narration while the pipeline runs ──────────────── */
  const STAGE_COPY = {
    data: ["Pulling live data", "Company profiles and headlines from yfinance"],
    triage: ["Stage 1 · Triage", "Six questions per story, all in one request"],
    exposure: ["Stage 2 · Exposure", "One Score per watchlist name — six names, one call"],
    mechanism: ["Stage 3 · Mechanism", "Selected from a catalogue code owns, never written freehand"],
    grounding: ["Stage 4 · Grounding", "Checking the desk's own read against the story"],
  };

  function narrateRun(e) {
    if (!T.on) return;
    const { event, data } = e.detail;
    if (event === "stage" && STAGE_COPY[data.stage]) say(...STAGE_COPY[data.stage]);
    if (event === "data") say(...STAGE_COPY.data);
    if (event === "done") say("Stage 5 · Composition", "Ranked and routed in code — zero further requests");
  }

  /* ── the choreography ─────────────────────────────────────── */
  async function script() {
    const steps = [
      async () => {
        say("A research desk built from typed judgments",
            "Live market news in, ranked and grounded trade ideas out");
        await sleep(2600);
      },

      async () => {
        say("Starting a real run", "Roughly 35 requests, about a fifth of a cent");
        // Tap the real button and wait for the run it started. Never also call
        // Desk.run() here -- that would fire a second, concurrent run.
        const finished = new Promise((resolve) => {
          const onEvent = (e) => {
            if (e.detail.event === "done" || e.detail.event === "fatal") {
              document.removeEventListener("desk:event", onEvent);
              resolve();
            }
          };
          document.addEventListener("desk:event", onEvent);
        });
        document.addEventListener("desk:event", narrateRun);
        await tap($("run"), 700);
        await finished;
        document.removeEventListener("desk:event", narrateRun);
        await sleep(900);
      },

      async () => {
        await bring($("flow"), "start");
        say("The funnel, end to end",
            "Stories surfaced → kept by triage → exposed names → mechanisms → grounded → published");
        const nodes = document.querySelectorAll("#flow .node");
        for (const n of nodes) { if (T.abort) return; await point(n, 520); }
      },

      async () => {
        say("Publish, review, drop", "Routing is a code decision. Dropped ideas sort last and dim out");
        await point($("tallies"), 1500);
      },

      async () => {
        const first = document.querySelector("#ideas .idea .head");
        await bring(first, "start");
        say("One idea, opened up", "The quoted fact, the desk's read, and the judgments behind both");
        await tap(first, 600);
        const detail = document.querySelector("#ideas .idea .detail");
        await bring(detail, "center");
        await sleep(1700);
      },

      async () => {
        const sub = document.querySelector("#ideas .idea .meters.sub");
        if (sub) { await bring(sub, "center"); }
        say("Uncertainty the code owns",
            "Grounding probabilities land in a YES / UNCLEAR / NO band drawn in code, not a token the model picks");
        await sleep(2400);
      },

      async () => {
        await bring($("toggle-weights"), "start");
        say("Re-ranking is free", "Watch the request counter in the header while the weights move");
        await tap($("toggle-weights"), 600);
        const slider = document.querySelector("#weights .weight input");
        if (slider) {
          cursorTo(slider);
          await sleep(500);
          for (const v of [0.8, 0.95, 0.15, 0.05, 0.25]) {
            if (T.abort) return;
            slider.value = String(v);
            slider.dispatchEvent(new Event("input"));
            await sleep(430);
          }
        }
        say("Nothing was asked again", "The evidence and the question meanings did not change");
        await point($("stats"), 2000);
        await tap($("toggle-weights"), 350);
      },

      async () => {
        say("Stage 1 · what triage dropped", "And the exact probability behind each gate");
        await tap(document.querySelector('.seg button[data-tab="pipeline"]'), 600);
        await bring($("triage"), "start");
        await sleep(2600);
      },

      async () => {
        const guard = document.querySelector("#triage tr th:nth-child(7)");
        if (guard) await point(guard, 700);
        say("A prompt-injection guard, for free",
            "Every story is scored for whether its text tries to instruct the reader — same request, no extra cost");
        await sleep(2300);
      },

      async () => {
        const expo = document.querySelector("#exposure .expo");
        await bring(expo, "start");
        say("Stage 2 · seven questions, one request", "One Score per name plus a summary Choice");
        await tap(expo.querySelector("summary"), 620);
        await sleep(2300);
      },

      async () => {
        await bring($("wl"), "start");
        say("The universe is code's", "Profiles and prices are live from yfinance");
        await sleep(2100);
      },

      async () => {
        say("Every request, in full", "State in, typed answers out — nothing is parsed from prose");
        await tap(document.querySelector('.seg button[data-tab="requests"]'), 600);
        const call = document.querySelector("#calls details summary");
        await bring(call, "start");
        await tap(call, 600);
        await sleep(2700);
      },

      async () => {
        say("How it fits together", "Five stages, four of them judgments");
        await tap(document.querySelector('.seg button[data-tab="method"]'), 600);
        await sleep(3000);
      },

      async () => {
        await tap(document.querySelector('.seg button[data-tab="ideas"]'), 600);
        const t = window.Desk.state;
        const pub = t.ideas.filter((x) => x.composite.route === "publish").length;
        say("One pass, end to end",
            `${t.calls.length} requests · ${t.calls.reduce((a, c) => a + c.question_count, 0)} questions · ${t.ideas.length} ideas ranked · ${pub} cleared for publish`);
        $("cursor").hidden = true;
        await sleep(4200);
      },
    ];

    T.total = steps.length;
    for (const step of steps) {
      if (T.abort) break;
      T.step++;
      await step();
    }
    if (!T.abort) { say("Demo complete", "Press Demo to run it again"); await sleep(2600); }
    stop();
  }

  /* ── control ──────────────────────────────────────────────── */
  async function start() {
    if (T.on) return stop();
    T.on = true; T.abort = false; T.step = 0;
    document.body.classList.add("touring");
    $("demo").classList.add("active");
    $("demo-label").textContent = "Stop";
    try { await script(); } catch (err) { console.error(err); stop(); }
  }

  function stop() {
    T.abort = true; T.on = false;
    document.body.classList.remove("touring");
    $("demo").classList.remove("active");
    $("demo-label").textContent = "Demo";
    $("cursor").hidden = true;
    hideCap();
  }

  $("demo").addEventListener("click", start);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && T.on) stop(); });

  document.addEventListener("desk:ready", () => {
    if (Q.get("demo") === "1") setTimeout(start, 900);
  }, { once: true });
})();
