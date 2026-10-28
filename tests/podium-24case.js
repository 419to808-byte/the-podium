/* 24-case gate suite: fallback = real local logic; live = real live hooks with
   fetch stubbed at the transport boundary (simulated Spark/Wonder replies).
   The stub is an independent mini-reviewer, not the adapter's own lists. */
(function () {
  var lines = [];
  function ok(n, c) { lines.push((c ? "CASE-OK: " : "CASE-FAIL: ") + n); }
  function hard(t) { return PodiumAI.checkText(t).hard.length > 0; }
  function soft(t, w) {
    var s = PodiumAI.checkText(t).soft.filter(function (f) { return f.word.toLowerCase() === w; });
    return s.length ? s[0].suggestion : null;
  }
  // ---- Fallback (local) cases 1-16 ----
  ok("01 shit blocked", hard("This is shit."));
  ok("02 shiitake passes", !hard("Shiitake mushrooms grow here."));
  ok("03 I hate you blocked", hard("I hate you."));
  ok("04 I hate your policy passes", !hard("I hate your policy."));
  ok("05 you're an idiot blocked", hard("You're an idiot."));
  ok("06 you suck blocked", hard("You suck and everyone knows it."));
  ok("07 kill the bill passes", !hard("We must kill the bill today."));
  ok("08 gonna -> going to", soft("We are gonna fix it.", "gonna") === "going to");
  ok("09 Gonna lead -> Going to", soft("Gonna fix it now.", "gonna") === "Going to");
  ok("10 ur -> your", soft("ur plan works.", "ur") === "your");
  ok("11 citzen -> citizen", soft("Every citzen deserves this.", "citzen") === "citizen");
  ok("12 dont -> don't", soft("We dont agree.", "dont") === "don\u2019t");
  ok("13 standalone i -> I", soft("i think so.", "i") === "I");
  var seedsClean = PODIUM_SEED.posts.every(function (p) { return PodiumAI.checkText(p.body).hard.length === 0; });
  ok("14 no seed post hard-flagged", seedsClean);
  ok("15 lol removal no double space", PodiumAI.tidyDraft("a lol b.").indexOf("  ") === -1);
  var w630 = []; for (var i = 0; i < 630; i++) w630.push("word");
  ok("16 630 words reads 4:30", PodiumAI.formatTimer(w630.join(" ")).indexOf("4:30") !== -1);
  // ---- Clarity cases 17-22 ----
  ok("17 Fix my road clear", PodiumAI.clarityOf("Fix my road. It has holes.").unclear === false);
  ok("18 word salad held", PodiumAI.clarityOf("i run chicken up tuesday before practise today then.").unclear === true);
  ok("19 gibberish held", PodiumAI.clarityOf("asdkjf qwer poiuy.").unclear === true);
  ok("20 dialect clear", PodiumAI.clarityOf("My road got holes, fix it please.").unclear === false);
  var da = PodiumAI.clarityOf("i propose we fix the road on main street because the holes are very big now");
  ok("21 discernible ask detected (rewrite path)", da.ask === true && !!da.topic);
  ok("22 single word held", PodiumAI.clarityOf("Hello").unclear === true);
  // ---- Already Voiced + timer cases 23-24 ----
  var pool = [
    { id: "x1", body: "I propose mobile cardiac screening units for rural counties, scheduled quarterly and published a year ahead. Early detection should not depend on living near a city hospital.", votes: 5 },
    { id: "x2", body: "I propose a national dashboard listing every bridge rated structurally deficient, with inspection dates. Citizens deserve to see where their roads stand.", votes: 9 }
  ];
  var sim = PodiumAI.findTopSimilar("My mother drives ninety minutes each way to see a cardiologist. I propose mobile cardiac screening units for rural counties, scheduled quarterly and published a year ahead.", pool);
  ok("23 Already Voiced returns top-voted similar post", !!sim && sim.id === "x1");
  ok("24 zero words reads 0:00", PodiumAI.formatTimer("").indexOf("0:00") !== -1);
  // ---- Seed/data consistency + scale robustness ----
  var dcCitizens = PODIUM_SEED.citizens.filter(function (c) { return c.state === "District of Columbia"; });
  ok("25 District of Columbia vocabulary, no bare DC",
    dcCitizens.length > 0 &&
    PODIUM_SEED.citizens.every(function (c) { return c.state !== "DC"; }) &&
    PODIUM_SEED.posts.every(function (p) { return p.authorState !== "DC"; }));
  var g4 = PodiumAI.tidyDraft("We gonna fix the road gonna try gonna win gonna go.");
  ok("26 four repeated slang occurrences all replaced",
    g4.toLowerCase().indexOf("gonna") === -1 && PodiumAI.checkText(g4).soft.length === 0);
  var mapLabels = PodiumAI.topicLabels.slice().sort().join("|");
  var seedTopics = PODIUM_SEED.topics.slice().sort().join("|");
  ok("27 keyword-map topics match the canonical seed topic set", mapLabels === seedTopics);
  // ---- Live-mode (stubbed transport) ----
  // The stub is installed on window.fetch and MUST be removed afterwards,
  // even if the chain rejects: finishSuite restores fetch and the suite key.
  var realFetch = window.fetch;
  var seenModels = [];
  window.fetch = function (url, opts) {
    var body = JSON.parse(opts.body);
    seenModels.push(body.model);
    var content = body.messages[0].content;
    var reply;
    if (body.model.indexOf("wonder") !== -1) {
      reply = "The committee will direct the Food and Drug Administration to issue guidance on alkalized bottled water within 90 days, coordinated through the Department of Health and Human Services.";
    } else if (content.indexOf("clarity reviewer") !== -1) {
      reply = JSON.stringify({ unclear: true, proposal: null });
    } else if (content.indexOf("farm fresh daily") !== -1) {
      /* Overclaiming model: asserts hard "shit" for a shiitake draft and a
         substring soft span. Whole-word validation must drop both, keeping
         only the genuine whole-word span. */
      reply = JSON.stringify({ hard: ["shit"], soft: [
        { word: "room", suggestion: "rooms", reason: "Not a whole word." },
        { word: "fresh", suggestion: "new", reason: "Stale word." }
      ] });
    } else if (content.indexOf("This is shit") !== -1) {
      reply = JSON.stringify({ hard: ["shit"], soft: [] });
    } else if (content.indexOf("gonna") !== -1) {
      reply = JSON.stringify({ hard: [], soft: [{ word: "gonna", suggestion: "going to", reason: "Slang: going to for a national audience." }] });
    } else {
      reply = JSON.stringify({ hard: [], soft: [] });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ choices: [{ message: { content: reply } }] }); } });
  };
  try { sessionStorage.setItem("podium.modelKey", "suite-key"); } catch (e) {}
  function finishSuite() {
    window.fetch = realFetch;
    try { sessionStorage.removeItem("podium.modelKey"); } catch (e) {}
    var pre = document.createElement("pre");
    pre.id = "probe-out";
    pre.textContent = lines.join("\n");
    document.body.appendChild(pre);
  }
  PodiumAI.checkTextLive("This is shit.").then(function (r1) {
    ok("L1 live shit hard", !!r1 && r1.hard.length === 1);
    return PodiumAI.checkTextLive("Shiitake mushrooms grow here.");
  }).then(function (r2) {
    ok("L2 live shiitake passes", !!r2 && r2.hard.length === 0);
    return PodiumAI.checkTextLive("We are gonna fix it.");
  }).then(function (r3) {
    ok("L3 live gonna suggestion", !!r3 && r3.soft.length === 1 && r3.soft[0].suggestion === "going to");
    return PodiumAI.checkTextLive("Shiitake mushrooms grow here, farm fresh daily.");
  }).then(function (rOver) {
    ok("L7 overclaimed hard span dropped for shiitake draft", !!rOver && rOver.hard.length === 0);
    var words = !!rOver ? rOver.soft.map(function (f) { return String(f.word); }) : [];
    ok("L8 substring soft span dropped, whole-word span kept", words.length === 1 && words[0] === "fresh");
    return PodiumAI.checkClarityLive("i run chicken up tuesday before practise today then.");
  }).then(function (r4) {
    ok("L4 live salad unclear, no invented proposal", !!r4 && r4.unclear === true && r4.proposal === null);
    return PodiumAI.draftCommitteeAnswer(PODIUM_SEED.posts[0]);
  }).then(function (draft) {
    ok("L5 Wonder draft via muse-wonder-1.0", !!draft && draft.indexOf("Food and Drug Administration") !== -1 && seenModels.indexOf("muse-wonder-1.0") !== -1);
    try { sessionStorage.removeItem("podium.modelKey"); } catch (e) {}
    return PodiumAI.draftCommitteeAnswer(PODIUM_SEED.posts[0]);
  }).then(function (none) {
    ok("L6 Wonder no-key resolves null (seeded fallback)", none === null);
    finishSuite();
  }, function () {
    ok("L-chain survived rejection", false);
    finishSuite();
  });
})();
