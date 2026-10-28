/* Replay timing gate (TY, Oct 28): the Replay library flips exactly like
   This Week — a cycle appears only once its briefing datetime has passed,
   newest briefing first. Loads after js/seed.js and js/store.js; needs no
   DOM (writes CASE lines to the DOM when present, otherwise console). */
(function () {
  var lines = [];
  function ok(n, c) { lines.push((c ? "CASE-OK: " : "CASE-FAIL: ") + n); }
  function ids(list) {
    return list.map(function (c) { return c.id; }).join(",");
  }
  function freshState() {
    return JSON.parse(JSON.stringify(PODIUM_SEED));
  }
  /* Local wall-clock instants: replayCycles compares datetimes built with
     the same local constructor, so these are TZ-independent. */
  function at(y, mo, d, h, mi) { return new Date(y, mo, d, h, mi); }

  var s = freshState();

  ok("R1 Oct 28 12:59 lists ONLY Oct 21 (Week of Oct 5)",
    ids(PodiumStore.replayCycles(s, at(2026, 9, 28, 12, 59))) === "w1");
  ok("R2 Oct 28 1:00 PM flips to Oct 21 + Oct 28, newest first",
    ids(PodiumStore.replayCycles(s, at(2026, 9, 28, 13, 0))) === "w2,w1");
  ok("R3 Nov 3 lists Oct 21 + Oct 28, no Nov 4 yet",
    ids(PodiumStore.replayCycles(s, at(2026, 10, 3, 12, 0))) === "w2,w1");
  ok("R4 Nov 4 after 1:00 PM lists Oct 21 + Oct 28 + Nov 4, newest first",
    ids(PodiumStore.replayCycles(s, at(2026, 10, 4, 13, 1))) === "w3,w2,w1");
  ok("R5 future voting cycle with no selections never lists",
    ids(PodiumStore.replayCycles(s, at(2026, 10, 12, 12, 0))).indexOf("w4") === -1);

  /* Placeholder probe: a briefed cycle with no replay video attached is
     not ready, while the other past briefings still list correctly. */
  var p = freshState();
  var w2 = null, i;
  for (i = 0; i < p.cycles.length; i++) {
    if (p.cycles[i].id === "w2") w2 = p.cycles[i];
  }
  w2.replayReady = false;
  ok("R6 briefed cycle with no replay video is not ready",
    PodiumStore.replayReady(w2) === false);
  ok("R7 other briefed cycles stay ready (demo slate path)",
    PodiumStore.replayReady(p.cycles[0]) === true);
  ok("R8 replaySrc null also means processing",
    PodiumStore.replayReady({ id: "wx", replaySrc: null }) === false);
  ok("R9 unready cycle still lists (placeholder, not silence)",
    ids(PodiumStore.replayCycles(p, at(2026, 10, 4, 13, 1))) === "w3,w2,w1");

  /* The flip matches the This Week rule: same datetimes, same boundary. */
  ok("R10 briefing datetimes parse to the 1:00 PM airings",
    PodiumStore.cycleDateTime("Wed Oct 28, 1:00 PM ET", 2026).getHours() === 13 &&
    PodiumStore.cycleDateTime("Wed Nov 4, 1:00 PM ET", 2026).getHours() === 13);

  /* Seed-guard: this fix changes no selection, vote, or draw record. */
  var w2seed = null;
  for (i = 0; i < s.cycles.length; i++) {
    if (s.cycles[i].id === "w2") w2seed = s.cycles[i];
  }
  ok("R11 seed selections intact (w2 top + random)",
    w2seed.topPostId === "p-w2-01" && w2seed.randomPostId === "p-w2-06");
  ok("R12 seed draw record intact (pool 12, beacon 4839, pos 4)",
    w2seed.poolSize === 12 && w2seed.beaconNum === 4839 && w2seed.position === 4);
  ok("R13 replay query does not reorder seed cycles",
    s.cycles.map(function (c) { return c.id; }).join(",") === "w1,w2,w3,w4,w5");

  /* Year rollover: in January the old briefings list with their 2026 dates
     (the year anchors to each cycle's votingStart, never the clock year),
     newest first. w4/w5 stay out: no selections drawn yet (the R5 rule),
     not because of the year. */
  ok("R14 Jan 2027 lists aired 2026 briefings newest-first",
    ids(PodiumStore.replayCycles(s, at(2027, 0, 5, 12, 0))) === "w3,w2,w1");
  ok("R15 Jan 2027 feed falls back to the latest-started cycle",
    PodiumStore.currentCycleId(s, at(2027, 0, 5, 12, 0)) === "w5");

  /* Permanent regression cases for three behaviors proven before only by
     temporary probes (deleted after use). They drive the live app DOM with
     the runner's clock control, so they need that context: without the
     runner (no app tabs, no __setAt/__realNowIso) they record CASE-SKIP
     lines, which count as neither pass nor fail. */
  function hasLiveDom() {
    return typeof document !== "undefined" && !!document.querySelector &&
      !!document.querySelector('.tab[data-view="watch"]') &&
      typeof window.__setAt === "function" && typeof window.__realNowIso === "string";
  }
  function tSkip(n, why) { lines.push("CASE-SKIP: " + n + " (" + why + ")"); }
  function tClick(el) {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }
  function showTab(name) {
    tClick(document.querySelector('.tab[data-view="' + name + '"]'));
  }
  function resetWatchAuto() {
    tClick(document.querySelector('#watchDemoBar [data-watch-state="auto"]'));
  }
  function watchMainText() {
    return document.querySelector("#watchMain").textContent.replace(/\s+/g, " ");
  }
  function nowReadingRefs() {
    var out = [];
    var nodes = document.querySelectorAll("#nowReading .ref-code");
    for (var i = 0; i < nodes.length; i++) {
      out.push(nodes[i].textContent.trim().split(/\s+/)[0]);
    }
    return out.join(",");
  }
  /* One DOM case: freeze the clock (explicit ET offset, so the case is
     TZ-independent), run, restore the real clock even on throw, and record
     exactly one CASE line — a throwing case fails by name instead of
     killing the rest of the file before emit(). */
  function tcase(name, iso, fn) {
    window.__setAt(iso);
    try { fn(); } catch (e) { ok(name, false); }
    window.__setAt(window.__realNowIso);
  }
  function priorValues() {
    var sel = document.querySelector("#priorSelect");
    var out = [];
    for (var i = 0; i < sel.options.length; i++) out.push(sel.options[i].value);
    return out.join(",");
  }
  function statusValues() {
    var sel = document.querySelector("#statusSelect");
    var out = [];
    for (var i = 0; i < sel.options.length; i++) out.push(sel.options[i].value);
    return out.join(",");
  }

  /* Watch-agenda rollover (clock prompt, item 1): agendaCycle derives the
     Watch cycle from briefing datetimes and the clock, never from the
     frozen seed status flags. Method: frozen clock via the runner shim,
     click the Watch tab (auto state), assert the rendered view. */
  if (!hasLiveDom()) {
    tSkip("R16-R22 agenda rollover", "needs runner clock + app DOM");
  } else {
    tcase("R16 Oct 28 12:59 Upcoming shows Oct 28 cycle", "2026-10-28T12:59:00-04:00", function () {
      showTab("watch");
      resetWatchAuto();
      var h = document.querySelector("#watchMain h3").textContent;
      var t = watchMainText();
      ok("R16 Oct 28 12:59 Upcoming shows Oct 28 cycle",
        /Oct 28/.test(h) && /On the air bill/.test(t) &&
        t.indexOf("B-0014") !== -1 && t.indexOf("A-0015") !== -1);
    });
    tcase("R17 Oct 28 13:15 Live shows Oct 28 cycle, single item", "2026-10-28T13:15:00-04:00", function () {
      showTab("watch");
      resetWatchAuto();
      var h = document.querySelector("#watchMain #nowReading h3").textContent;
      var bar = document.querySelector("#watchMain .live-badge");
      ok("R17 Oct 28 13:15 Live shows Oct 28 cycle, single item",
        !!bar && bar.textContent === "LIVE" && h === "Now reading (2 of 2)" &&
        nowReadingRefs() === "A-0015" &&
        document.querySelectorAll("#nowReading .zone-post").length === 1 &&
        document.querySelectorAll("#nowReading .zone-answer").length === 0);
    });
    /* Live minute rotation, same method: idx flips at :15 within the window. */
    tcase("R18 live Now reading rotates by minute, still single-item", "2026-11-04T13:05:00-05:00", function () {
      showTab("watch");
      resetWatchAuto();
      var first = document.querySelector("#watchMain #nowReading h3").textContent;
      var refs1 = nowReadingRefs();
      window.__setAt("2026-11-04T13:16:00-05:00");
      showTab("watch");
      var second = document.querySelector("#watchMain #nowReading h3").textContent;
      ok("R18 live Now reading rotates by minute, still single-item",
        first === "Now reading (1 of 2)" && refs1 === "D-0026" &&
        second === "Now reading (2 of 2)" && nowReadingRefs() === "K-0032" &&
        document.querySelectorAll("#nowReading .zone-post").length === 1);
    });
    tcase("R19 Oct 28 14:00 Upcoming shows Nov 4 cycle", "2026-10-28T14:00:00-04:00", function () {
      showTab("watch");
      resetWatchAuto();
      var h = document.querySelector("#watchMain h3").textContent;
      var t = watchMainText();
      ok("R19 Oct 28 14:00 Upcoming shows Nov 4 cycle",
        /Nov 4/.test(h) && t.indexOf("D-0026") !== -1 && t.indexOf("K-0032") !== -1);
    });
    tcase("R20 Nov 4 13:15 Live shows Nov 4 cycle", "2026-11-04T13:15:00-05:00", function () {
      showTab("watch");
      resetWatchAuto();
      var h = document.querySelector("#watchMain #nowReading h3").textContent;
      var bar = document.querySelector("#watchMain .live-badge");
      ok("R20 Nov 4 13:15 Live shows Nov 4 cycle",
        !!bar && bar.textContent === "LIVE" && h === "Now reading (2 of 2)" && nowReadingRefs() === "K-0032");
    });
    tcase("R21 Nov 5 Upcoming names the wait, no empty bill", "2026-11-05T12:00:00-05:00", function () {
      showTab("watch");
      resetWatchAuto();
      var h = document.querySelector("#watchMain h3").textContent;
      var t = watchMainText();
      ok("R21 Nov 5 Upcoming names the wait, no empty bill",
        /Nov 11/.test(h) && !/On the air bill/.test(t) &&
        /Selections for this briefing have not been drawn yet\./.test(t));
    });
    /* No-future-briefing fallback (already in app): agendaCycle returns
       null past the last briefing, and the view says the agenda is to be
       announced — never a stale cycle, never a blank. */
    tcase("R22 Jan 2027 no future briefing announces the agenda wait", "2027-01-05T12:00:00-05:00", function () {
      showTab("watch");
      resetWatchAuto();
      ok("R22 Jan 2027 no future briefing announces the agenda wait",
        /Agenda to be announced after the next draw\./.test(watchMainText()));
    });
  }

  /* Prior/Status dropdown refill (clock prompt, item 3): threadSelect
     options are rebuilt on every render, preserving the current selection
     when it still exists. Method: open Prior pre-flip, hold the session
     past the flip with the runner clock, re-render, assert. */
  if (!hasLiveDom()) {
    tSkip("R23-R25 Prior/Status refill", "needs runner clock + app DOM");
  } else {
    tcase("R23 refill across flip 2 to 4, Jeff record lands on B-0014", "2026-10-28T12:59:00-04:00", function () {
      showTab("prior");
      var before = priorValues();
      window.__setAt("2026-10-28T13:01:00-04:00");
      showTab("briefing");
      /* Jeff's new This Week card: the li.card containing his ref. */
      var cards = document.querySelectorAll("#pipelineList li.card");
      var jeffBtn = null, i;
      for (i = 0; i < cards.length; i++) {
        if (cards[i].textContent.indexOf("B-0014") !== -1) {
          var btns = cards[i].querySelectorAll("button");
          var j;
          for (j = 0; j < btns.length; j++) {
            if (btns[j].textContent === "See full record") { jeffBtn = btns[j]; break; }
          }
          break;
        }
      }
      var landed = false;
      if (jeffBtn) {
        tClick(jeffBtn);
        landed = document.querySelector("#view-prior").hidden === false &&
          document.querySelector("#priorCard").textContent.indexOf("B-0014") !== -1;
      }
      ok("R23 refill across flip 2 to 4, Jeff record lands on B-0014",
        before === "p-w1-16,p-w1-05" && !!jeffBtn && landed &&
        priorValues() === "p-w1-16,p-w1-05,p-w2-01,p-w2-06" &&
        document.querySelector("#priorSelect").value === "p-w2-01");
    });
    tcase("R24 surviving selection preserved across re-render", "2026-10-28T13:01:00-04:00", function () {
      showTab("prior");
      var sel = document.querySelector("#priorSelect");
      sel.value = "p-w1-16";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      showTab("briefing");
      showTab("prior");
      ok("R24 surviving selection preserved across re-render",
        document.querySelector("#priorSelect").value === "p-w1-16" &&
        document.querySelector("#priorCard").textContent.indexOf("C-0046") !== -1);
    });
    /* Status shares the same threadSelect helper; one case pins it too. */
    tcase("R25 Status refills and preserves like Prior", "2026-10-28T13:01:00-04:00", function () {
      showTab("status");
      var vals = statusValues();
      var sel = document.querySelector("#statusSelect");
      sel.value = "p-w1-05";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      showTab("briefing");
      showTab("status");
      ok("R25 Status refills and preserves like Prior",
        vals === "p-w1-16,p-w1-05,p-w2-01,p-w2-06" &&
        document.querySelector("#statusSelect").value === "p-w1-05" &&
        document.querySelector("#statusCard").textContent.indexOf("B-0005") !== -1);
    });
  }

  /* Replay Screening stacking (Watch-completeness prompt): the replay
     branch stacks every item (top-voted first), each with its selection
     badge, Citizen Post block, Committee Answer block, and Full record
     button — on both the video and slate paths. */
  if (!hasLiveDom()) {
    tSkip("R26-R27 Screening stacking", "needs runner clock + app DOM");
  } else {
    tcase("R26 Week of Oct 5 stacks both posts on the video path", "2026-10-28T15:00:00-04:00", function () {
      showTab("watch");
      resetWatchAuto();
      var lib = document.querySelectorAll("#watchLibrary li.card");
      var w1Btn = null, i;
      for (i = 0; i < lib.length; i++) {
        if (lib[i].textContent.indexOf("C-0046") !== -1) { w1Btn = lib[i].querySelector("button"); break; }
      }
      var w1ok = false;
      if (w1Btn) {
        tClick(w1Btn);
        var v = document.querySelector("#watchMain video");
        var h1 = document.querySelector("#watchMain #nowReading h3").textContent;
        var t1 = document.querySelector("#nowReading").textContent;
        var src = v ? String(v.src).split("/").pop() : "";
        w1ok = !!v && src === "podium-replay-final-v5.mp4" &&
          h1 === "Screening" && nowReadingRefs() === "C-0046,C-0046-A,B-0005,B-0005-A" &&
          /TOP-VOTED/.test(t1) && /RANDOM DRAW/.test(t1) &&
          /allocate the funds across the twelve counties/.test(t1) &&
          document.querySelectorAll("#nowReading .zone-post").length === 2 &&
          document.querySelectorAll("#nowReading .zone-answer").length === 2 &&
          document.querySelectorAll("#nowReading button").length === 2;
        showTab("watch");
      }
      ok("R26 Week of Oct 5 stacks both posts on the video path", w1ok);
    });
    tcase("R27 Week of Oct 12 stacks both posts on the slate path", "2026-10-28T15:00:00-04:00", function () {
      showTab("watch");
      resetWatchAuto();
      var lib = document.querySelectorAll("#watchLibrary li.card");
      var w2Btn = null, i;
      for (i = 0; i < lib.length; i++) {
        if (lib[i].textContent.indexOf("B-0014") !== -1) { w2Btn = lib[i].querySelector("button"); break; }
      }
      var w2ok = false;
      if (w2Btn) {
        tClick(w2Btn);
        var t2 = document.querySelector("#nowReading").textContent;
        w2ok = !!document.querySelector("#watchMain canvas") &&
          document.querySelector("#watchMain #nowReading h3").textContent === "Screening" &&
          nowReadingRefs() === "B-0014,B-0014-A,A-0015,A-0015-A" &&
          /TOP-VOTED/.test(t2) && /RANDOM DRAW/.test(t2) &&
          document.querySelectorAll("#nowReading .zone-post").length === 2 &&
          document.querySelectorAll("#nowReading .zone-answer").length === 2 &&
          document.querySelectorAll("#nowReading button").length === 2;
        showTab("watch");
      }
      ok("R27 Week of Oct 12 stacks both posts on the slate path", w2ok);
    });
  }

  function emit() {
    if (typeof document !== "undefined" && document.body) {
      var pre = document.createElement("pre");
      pre.id = "probe-out";
      pre.textContent = lines.join("\n");
      document.body.appendChild(pre);
    } else if (typeof console !== "undefined") {
      console.log(lines.join("\n"));
    }
  }
  emit();
})();
