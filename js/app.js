/* The Podium — UI wiring. No framework, no network calls. */
(function () {
  "use strict";

  /* Scroll behavior (TY, Oct 28): every full load starts at the top,
     regardless of where the user was scrolled before refreshing. Belt
     and braces for this static app: disable browser scroll restoration
     and scroll to top on load, timed so a late restoration cannot
     override it. Deep-link loads (#post/...) are exempt — the app scrolls
     those to the linked post by design. Tab-click scrolling is untouched. */
  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  } catch (e) { /* older engine: the load handler below still applies */ }
  function startAtTop() {
    if (/^#post\//.test(window.location.hash || "")) return;
    window.scrollTo(0, 0);
  }
  window.addEventListener("load", function () {
    startAtTop();
    if (window.requestAnimationFrame) window.requestAnimationFrame(startAtTop);
    setTimeout(startAtTop, 0);
  });

  var state = PodiumStore.load(etNow());
  var currentView = "feed";

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function excerpt(body, n) {
    if (body.length <= n) return body;
    return body.slice(0, n).replace(/\s\S*$/, "") + "\u2026";
  }
  function votesLabel(n) {
    return n + " vote" + (n === 1 ? "" : "s");
  }
  /* Frozen author state (display metadata only; empty means none shown). */
  function stateSuffix(p) {
    return p && p.authorState ? " \u00b7 " + esc(p.authorState) : "";
  }

  /* ---------- tabs ---------- */
  /* Active-tab persistence (TY, Oct 28): the current view id is written to
     sessionStorage on every view change, so a reload restores the same tab
     (a fresh tab has empty sessionStorage and boots to Live Feed as
     before). Deep links win over the saved tab; see init. */
  var TAB_KEY = "podium.v1.tab";
  var VALID_VIEWS = { feed: 1, post: 1, briefing: 1, watch: 1, prior: 1, status: 1 };
  function saveView(name) {
    try { window.sessionStorage.setItem(TAB_KEY, name); } catch (e) { /* session-only */ }
  }
  function savedView() {
    try {
      var v = window.sessionStorage.getItem(TAB_KEY);
      return (v && VALID_VIEWS[v]) ? v : null;
    } catch (e) { return null; }
  }
  var tabs = document.querySelectorAll(".main-nav .tab");
  function showView(name) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-view") === name;
      t.classList.toggle("is-active", on);
      if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    currentView = name;
    saveView(name);
    ["feed", "post", "briefing", "watch", "prior", "status"].forEach(function (v) {
      $("view-" + v).hidden = (v !== name);
    });
    if (name === "briefing") renderBriefing();
    if (name === "prior") renderPrior();
    if (name === "status") renderStatus();
    if (name === "watch") { renderWatch(); } else { stopWatchPlayback(); }
    if (name === "post") renderComposerGate();
    window.scrollTo(0, 0);
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { showView(t.getAttribute("data-view")); });
  });
  $("readFullRule").addEventListener("click", function (e) {
    e.preventDefault();
    window.scrollTo(0, 0);
  });

  /* ---------- citizen ---------- */
  function currentUser() {
    return state.currentUserId ? PodiumStore.citizenById(state, state.currentUserId) : null;
  }
  function renderCitizen() {
    var chip = $("citizenChip");
    if (!state.currentUserId) {
      chip.textContent = "Not signed in";
      $("switchCitizenBtn").textContent = "Sign in";
      $("citizenStateWrap").hidden = true;
    } else {
      var me = currentUser();
      chip.innerHTML = "Signed in as <strong>" + esc(me.name) + "</strong>" +
        (me.state ? " \u00b7 " + esc(me.state) : "") +
        ' <span class="verified" title="Simulated verification for demo">\u2713 Verified citizen (demo)</span>';
      $("switchCitizenBtn").textContent = "Switch citizen";
      $("citizenStateWrap").hidden = false;
      $("citizenStateSel").value = me.state || "";
    }
  }
  /* ---------- modal focus management ---------- */
  var modalReturnFocus = null;
  function modalFocusables(box) {
    return Array.prototype.slice.call(box.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"))
      .filter(function (el) { return el.offsetParent !== null; });
  }
  function openModal(box) {
    modalReturnFocus = document.activeElement;
    box.hidden = false;
    var f = modalFocusables(box);
    if (f.length) f[0].focus();
  }
  function closeModal(box) {
    box.hidden = true;
    if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  /* reason: "vote" | "post" | undefined (plain switch) */
  function openCitizens(reason) {
    var pr = $("citizenPrompt");
    if (reason === "vote") {
      pr.textContent = "Sign in to vote \u2014 pick a demo citizen. No sign-in, no vote.";
      pr.hidden = false;
    } else if (reason === "post") {
      pr.textContent = "Sign in to post \u2014 pick a demo citizen.";
      pr.hidden = false;
    } else {
      pr.hidden = true;
    }
    var ul = $("citizenList");
    ul.innerHTML = "";
    state.citizens.forEach(function (c) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c.name + (c.state ? " \u00b7 " + c.state : "") + (c.id === state.currentUserId ? " (current)" : "") + "  \u2713 Verified (demo)";
      b.addEventListener("click", function () {
        state.currentUserId = c.id;
        PodiumStore.save(state);
        renderCitizen(); renderFeed(); updateOnePostNotice();
        closeModal($("citizenModal"));
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    openModal($("citizenModal"));
  }
  $("switchCitizenBtn").addEventListener("click", openCitizens);
  $("citizenClose").addEventListener("click", function () { closeModal($("citizenModal")); });

  /* ---------- feed ---------- */
  /* Feed scale (TY, Oct 28, part 1 of 2): DISPLAY-ONLY pagination and sorts.
     Pagination/sorts/filters never change which posts exist, which post is
     top-voted, or which posts are in a cycle's draw pool. The ordered list
     is snapshotted (frozen): page turns use the frozen id list, votes
     update counts in place without re-sorting, and re-sorting happens only
     when the user changes sort, topic, search, or page size. */
  var subtabs = document.querySelectorAll(".subtab");
  var FEED_SORTS = { recent: 1, top: 1, needs: 1, discover: 1 };
  var FEED_PAGE_SIZES = [10, 20, 50];
  var FEED_STATE_KEY = "podium.v1.feed";
  var feedSort = "recent";   /* recent | top | needs | discover */
  var feedTopic = "";        /* "" = all topics */
  var feedPageSize = 20;
  var feedPage = 1;
  var feedList = null;       /* frozen array of post ids in display order */
  var feedListKey = "";      /* sort|topic|query|size the frozen list was built for */
  var feedFreeze = false;    /* storage-event path: prune only, never add posts */
  function feedQuery() { return $("searchInput").value.trim(); }
  function isCodeSearch() {
    return /^([A-Z])-(\d+)(?:-(A|U\d+))?$/i.test(feedQuery());
  }
  function feedKey() {
    return feedSort + "|" + feedTopic + "|" + feedQuery().toLowerCase() + "|" + feedPageSize;
  }
  function saveFeedState() {
    try {
      window.sessionStorage.setItem(FEED_STATE_KEY,
        JSON.stringify({ sort: feedSort, topic: feedTopic, page: feedPage }));
    } catch (e) { /* session-only */ }
  }
  function restoreFeedState() {
    try {
      var s = JSON.parse(window.sessionStorage.getItem(FEED_STATE_KEY) || "null");
      if (!s) return;
      if (FEED_SORTS[s.sort]) feedSort = s.sort;
      if (typeof s.topic === "string" && state.topics.indexOf(s.topic) !== -1) feedTopic = s.topic;
      var p = parseInt(s.page, 10);
      feedPage = (p >= 1) ? p : 1;
    } catch (e) { /* fresh or corrupt session: defaults stand */ }
  }
  function setFeedSort(mode, forceRebuild) {
    if (linkedPostId || linkMissing) { linkedPostId = null; linkedSuffix = null; linkMissing = false; }
    feedSort = mode;
    feedPage = 1;
    if (forceRebuild) feedList = null; /* explicit sort pick always rebuilds (Discover reshuffles) */
    saveFeedState();
    renderFeed();
  }
  function setFeedTopic(t) {
    if (linkedPostId || linkMissing) { linkedPostId = null; linkedSuffix = null; linkMissing = false; }
    feedTopic = t || "";
    feedPage = 1;
    saveFeedState();
    renderFeed();
  }
  subtabs.forEach(function (t, i) {
    t.addEventListener("click", function () { setFeedSort(t.getAttribute("data-feed"), true); });
    t.tabIndex = t.classList.contains("is-active") ? 0 : -1;
    t.addEventListener("keydown", function (e) {
      var j = null;
      if (e.key === "ArrowRight") j = (i + 1) % subtabs.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + subtabs.length) % subtabs.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = subtabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      setFeedSort(subtabs[j].getAttribute("data-feed"), true);
      subtabs[j].focus();
    });
  });
  function fillTopics(sel, withAll) {
    sel.innerHTML = "";
    if (withAll) {
      var o = document.createElement("option");
      o.value = ""; o.textContent = "All topics";
      sel.appendChild(o);
    }
    state.topics.forEach(function (t) {
      var op = document.createElement("option");
      op.value = t; op.textContent = t;
      sel.appendChild(op);
    });
  }
  fillTopics($("topicFilter"), true);
  fillTopics($("composerTopic"), false);
  $("composerTopic").addEventListener("change", saveDraft);
  /* Citizen state (demo): stated state for the signed-in citizen, frozen
     onto posts at publish by the store. Display metadata only. */
  var US_STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];
  (function () {
    var sel = $("citizenStateSel");
    var o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "State not set";
    sel.appendChild(o0);
    US_STATES.forEach(function (nm) {
      var o = document.createElement("option");
      o.value = nm;
      o.textContent = nm;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      var u = currentUser();
      if (!u) return;
      u.state = sel.value || "";
      PodiumStore.save(state);
      renderCitizen();
    });
  })();
  $("topicFilter").addEventListener("change", function () { setFeedTopic($("topicFilter").value); });
  /* Search re-renders the whole feed per keystroke, so it waits for a
     short pause (same clear-then-set style as the draft-save debounce). */
  var SEARCH_DEBOUNCE_MS = 300;
  var searchTimer = null;
  $("searchInput").addEventListener("input", function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    searchTimer = setTimeout(function () {
      searchTimer = null;
      if (linkedPostId || linkMissing) { linkedPostId = null; linkedSuffix = null; linkMissing = false; }
      feedPage = 1;
      saveFeedState();
      renderFeed();
    }, SEARCH_DEBOUNCE_MS);
  });
  $("pageSizeSel").addEventListener("change", function () {
    var n = parseInt($("pageSizeSel").value, 10);
    feedPageSize = (FEED_PAGE_SIZES.indexOf(n) !== -1) ? n : 20;
    feedPage = 1;
    saveFeedState();
    renderFeed();
  });
  $("prevPage").addEventListener("click", function () {
    if (feedPage > 1) { feedPage -= 1; saveFeedState(); renderFeed(); scrollFeedIntoView(); }
  });
  $("nextPage").addEventListener("click", function () {
    feedPage += 1; saveFeedState(); renderFeed(); scrollFeedIntoView();
  });
  function scrollFeedIntoView() {
    var list = $("postList");
    if (list && list.scrollIntoView) list.scrollIntoView();
  }
  function matchingPostIds() {
    var ids = [];
    var q = feedQuery().toLowerCase();
    PodiumStore.postsForCycle(state, currentCycle()).forEach(function (p) {
      if (feedTopic && p.topic !== feedTopic) return;
      if (q) {
        /* Keyword search covers the body AND the author name AND the topic,
           so "Lisa" or "Housing" finds posts a body-only search would miss. */
        var author = PodiumStore.citizenById(state, p.authorId);
        var hay = (p.body + " " + (author ? author.name : "") + " " + p.topic).toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      ids.push(p.id);
    });
    return ids;
  }
  function sortFeedIds(ids) {
    var arr = ids.slice();
    function byId(id) { return PodiumStore.postById(state, id); }
    if (feedSort === "top") {
      arr.sort(function (a, b) { return byId(b).votes - byId(a).votes; });
    } else if (feedSort === "needs") {
      arr.sort(function (a, b) { return byId(a).votes - byId(b).votes; });
    } else if (feedSort === "discover") {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
    } else {
      arr.sort(function (a, b) { return byId(a).createdAt < byId(b).createdAt ? 1 : -1; });
    }
    return arr;
  }
  function ensureFeedList(forceRebuild) {
    var key = feedKey();
    if (!forceRebuild && feedList && feedListKey === key) {
      var ids = matchingPostIds();
      var pruned = feedList.filter(function (id) { return ids.indexOf(id) !== -1; });
      if (pruned.length === feedList.length && pruned.length === ids.length) return feedList;
      if (feedFreeze || pruned.length) {
        feedList = feedFreeze ? pruned : sortFeedIds(ids);
        feedListKey = key;
        feedFreeze = false;
        return feedList;
      }
      /* fell through: mass delete plus additions with an empty survivor
         set — rebuild so the view is never wrongly empty */
    }
    feedFreeze = false;
    feedList = sortFeedIds(matchingPostIds());
    feedListKey = key;
    return feedList;
  }
  function syncFeedControls() {
    subtabs.forEach(function (x) {
      var on = x.getAttribute("data-feed") === feedSort;
      x.classList.toggle("is-active", on);
      x.setAttribute("aria-selected", on ? "true" : "false");
      x.tabIndex = on ? 0 : -1;
    });
    $("topicFilter").value = feedTopic;
    $("pageSizeSel").value = String(feedPageSize);
  }
  function renderTopicList() {
    var box = $("topicList");
    box.innerHTML = "";
    var counts = {};
    state.topics.forEach(function (t) { counts[t] = 0; });
    var total = 0;
    PodiumStore.postsForCycle(state, currentCycle()).forEach(function (p) {
      if (counts[p.topic] === undefined) counts[p.topic] = 0;
      counts[p.topic] += 1;
      total += 1;
    });
    function addBtn(label, topic, count) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small topic-btn";
      b.textContent = label + " (" + count + ")";
      b.setAttribute("aria-pressed", (feedTopic === topic) ? "true" : "false");
      b.addEventListener("click", function () { setFeedTopic(topic); });
      box.appendChild(b);
    }
    addBtn("All topics", "", total);
    state.topics.forEach(function (t) { addBtn(t, t, counts[t] || 0); });
  }
  function renderPager(total, totalPages) {
    var pager = $("feedPager");
    pager.hidden = totalPages <= 1;
    $("pageInfo").textContent = "Page " + feedPage + " of " + totalPages;
    $("prevPage").disabled = feedPage <= 1;
    $("nextPage").disabled = feedPage >= totalPages;
  }
  function refreshVoteButtons(pid) {
    if (!pid) return;
    var p = PodiumStore.postById(state, pid);
    if (!p) return;
    var voted = state.currentUserId ? PodiumStore.hasVoted(state, state.currentUserId, pid) : false;
    var open = p.cycleId === currentCycle();
    document.querySelectorAll('.vote-btn[data-post="' + pid + '"]').forEach(function (b) {
      b.setAttribute("aria-pressed", voted ? "true" : "false");
      b.textContent = voted ? "\u25b2 Upvoted" : "\u25b3 Upvote";
      var li = b.closest("li");
      var count = li ? li.querySelector(".vote-count") : null;
      if (count) {
        count.textContent = votesLabel(p.votes) + (voted ? " \u00b7 Your vote" : "") +
          (open ? "" : " \u00b7 voting closed");
      }
    });
  }

  function statusChip(postId) {
    var b = PodiumStore.briefingItemFor(state, postId);
    if (!b) return "";
    var shown = displayPipeline(PodiumStore.cycleById(state, b.cycleId), b.pipeline);
    var stage = shown === "committee" ? "in committee" : shown;
    if (b.selection === "top") return '<span class="post-status top">Top-voted \u00b7 ' + esc(stage) + "</span>";
    return '<span class="post-status random">Random pick \u00b7 ' + esc(stage) + "</span>";
  }

  var linkedPostId = null;
  var linkedSuffix = null;
  var lastCodeJump = null;
  var linkMissing = false;

  function postLi(p, linked) {
    var li = document.createElement("li");
    li.className = "post" + (linked ? " is-linked" : "");
    if (linked) li.id = "linkedPost";
    var author = PodiumStore.citizenById(state, p.authorId);
    var open = (p.cycleId === currentCycle());
    var voted = state.currentUserId ? PodiumStore.hasVoted(state, state.currentUserId, p.id) : false;
    var cycle = PodiumStore.cycleById(state, p.cycleId);
    var html = '<div class="post-meta"><span class="post-author">' + esc(author.name) +
      "</span>" + stateSuffix(p) + '<span title="Simulated verification for demo">\u2713 verified (demo)</span>' +
      '<span class="post-topic">' + esc(p.topic) + "</span>" +
      '<span class="ref-code">' + esc(p.ref || "") + "</span>" +
      "<span>" + esc(PodiumStore.displayDateFor(p, etNow())) + " \u00b7 " + esc(cycleLabel(cycle)) + "</span>" +
      statusChip(p.id) + "</div>" +
      '<p class="post-body">' + esc(p.body) + "</p>" +
      '<div class="post-actions">';
    if (open) {
      html += '<button type="button" class="vote-btn" data-post="' + esc(p.id) + '" aria-pressed="' + (voted ? "true" : "false") + '">' +
        (voted ? "\u25b2 Upvoted" : "\u25b3 Upvote") + "</button>";
    }
    html += '<button type="button" class="share-btn" data-share="' + esc(p.id) + '">Share</button>';
    html += '<span class="vote-count">' + votesLabel(p.votes) +
      (voted ? " \u00b7 Your vote" : "") +
      (open ? "" : " \u00b7 voting closed") + "</span></div>";
    li.innerHTML = html;
    return li;
  }

  function attachCardButtons(list) {
    list.querySelectorAll(".vote-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!state.currentUserId) { openCitizens("vote"); return; }
        /* One vote per cycle, frozen pages: update the affected counts in
           place — no re-sort, no re-page, no snapshot rebuild. */
        var pid = btn.getAttribute("data-post");
        var prev = PodiumStore.userVoteInCycle(state, state.currentUserId, currentCycle());
        PodiumStore.castVote(state, state.currentUserId, pid);
        refreshVoteButtons(prev);
        refreshVoteButtons(pid);
      });
    });
    list.querySelectorAll(".share-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = PodiumStore.postById(state, btn.getAttribute("data-share"));
        if (p) doShare(p, btn);
      });
    });
  }

  function firstSentence(body) {
    var m = /^(.+?[.!?])(\s|$)/.exec(body);
    return m ? m[1] : body.slice(0, 120);
  }
  function answerCode(post) { return (post.ref || "") + "-A"; }
  function updateCode(post, i) { return (post.ref || "") + "-U" + (i + 1); }
  /* Displayed committee answers lose the seeded "Sample committee response"
     data label at render time — plain ("Sample committee response: ...")
     and parenthetical ("Sample committee response (...): ...") forms —
     and the remainder's first letter is capitalized so the record reads
     finished. Stored text is never touched; Wonder drafts carry no prefix,
     so the strip is a no-op there. */
  function displayAnswer(a) {
    var s = String(a == null ? "" : a).replace(/^Sample committee response(\s*\([^)]*\))?:\s*/, "");
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* Thread view: the post plus its answer and updates, each with its code.
     Used for deep links and code search. highlight is null | "A" | "U<n>". */
  function renderThread(list, post, highlight) {
    list.appendChild(postLi(post, true));
    var b = PodiumStore.briefingItemFor(state, post.id);
    if (!b) return;
    var ans = document.createElement("li");
    ans.className = "card zone-answer" + (highlight === "A" ? " thread-hl" : "");
    if (highlight === "A") ans.id = "threadTarget";
    ans.innerHTML = '<span class="zone-label">Official Answer</span>' +
      '<p><span class="ref-code">' + esc(answerCode(post)) + "</span></p>" +
      "<p>" + esc(displayAnswer(b.answer)) + "</p>";
    list.appendChild(ans);
    b.updates.forEach(function (u, i) {
      var hl = highlight === ("U" + (i + 1));
      var li = document.createElement("li");
      li.className = "card zone-answer" + (hl ? " thread-hl" : "");
      if (hl) li.id = "threadTarget";
      li.innerHTML = '<span class="zone-label">Update U' + (i + 1) + "</span>" +
        '<p><span class="ref-code">' + esc(updateCode(post, i)) + "</span> <strong>" + esc(u.date) + "</strong></p>" +
        "<p>" + esc(u.text) + "</p>";
      list.appendChild(li);
    });
  }
  function scrollThreadTarget() {
    var t = $("threadTarget") || $("linkedPost");
    if (t && t.scrollIntoView) t.scrollIntoView();
  }

  function renderFeed() {
    var list = $("postList");
    list.innerHTML = "";
    if (linkedPostId) {
      var lp = PodiumStore.postById(state, linkedPostId);
      if (lp) {
        var noteEl = $("feedNote");
        var lpOpen = (lp.cycleId === currentCycle());
        noteEl.textContent = lpOpen
          ? "You opened a shared post. Sign in to upvote it. "
          : "You opened a shared post from a past week. Voting is closed on past weeks\u2019 posts. ";
        if (!lpOpen && PodiumStore.briefingItemFor(state, lp.id)) {
          noteEl.appendChild(fullRecordButton(lp.id));
          noteEl.appendChild(document.createTextNode(" "));
        }
        var back = document.createElement("button");
        back.type = "button";
        back.className = "btn btn-small";
        back.textContent = "Show full feed";
        back.addEventListener("click", clearDeepLink);
        noteEl.appendChild(back);
        renderThread(list, lp, linkedSuffix);
        attachCardButtons(list);
        scrollThreadTarget();
        return;
      }
      linkedPostId = null;
      linkedSuffix = null;
    }
    if (linkMissing) {
      var noteEl = $("feedNote");
      noteEl.textContent = "This post is no longer available. Posts that are not selected for a weekly briefing are removed when their cycle closes. ";
      var back = document.createElement("button");
      back.type = "button";
      back.className = "btn btn-small";
      back.textContent = "Show full feed";
      back.addEventListener("click", clearDeepLink);
      noteEl.appendChild(back);
      var liGone = document.createElement("li");
      liGone.className = "post";
      liGone.textContent = "This post is no longer available. Posts that are not selected for a weekly briefing are removed when their cycle closes.";
      list.appendChild(liGone);
      return;
    }
    /* Live Feed = current cycle only: the posts citizens can vote on now.
       Reference-code search jumps to a thread (unpaginated, as before);
       every other list below is the frozen, paginated snapshot. */
    var raw = $("searchInput").value.trim();
    var cm = /^([A-Z])-(\d+)(?:-(A|U\d+))?$/i.exec(raw);
    if (cm) {
      var base = cm[1].toUpperCase() + "-" + (cm[2].length > 4 ? cm[2] : ("0000" + cm[2]).slice(-4));
      var suffix = cm[3] ? cm[3].toUpperCase() : null;
      if (suffix === "U0") suffix = null; /* updates start at U1 */
      var found = PodiumStore.postByRef(state, base);
      if (!found) {
        $("feedNote").textContent = "No item with code " + raw.toUpperCase() + ".";
        var liNone = document.createElement("li");
        liNone.className = "post";
        liNone.textContent = "No post, answer, or update carries that code.";
        list.appendChild(liNone);
        return;
      }
      $("feedNote").textContent = suffix
        ? ("Code " + base + "-" + suffix + ": jumping to that item in the thread.")
        : ("Code " + base + ": post plus its answer and updates.");
      renderThread(list, found, suffix);
      attachCardButtons(list);
      if (base + (suffix || "") !== lastCodeJump) {
        lastCodeJump = base + (suffix || "");
        scrollThreadTarget();
      }
      return;
    }
    lastCodeJump = null;
    var ids = ensureFeedList(false);
    var totalPages = Math.max(1, Math.ceil(ids.length / feedPageSize));
    if (feedPage > totalPages) { feedPage = totalPages; saveFeedState(); }
    if (feedPage < 1) feedPage = 1;
    var note = "";
    if (feedSort === "top") {
      note = "Highest-voted first. This week\u2019s leader becomes the top-voted briefing pick.";
    } else if (feedSort === "needs") {
      note = "Least-voted first, so unseen posts surface. These are this week\u2019s posts \u2014 voting is open on all of them.";
    } else if (feedSort === "discover") {
      note = "Shuffled for discovery \u2014 re-pick Discover for a fresh shuffle. These are this week\u2019s posts \u2014 voting is open on all of them.";
    } else if (raw) {
      note = ids.length + " result(s).";
    } else {
      note = "Newest first. These are this week\u2019s posts \u2014 voting is open on all of them.";
    }
    if (feedTopic) note += " Filtered to topic \u201c" + feedTopic + "\u201d (" + ids.length + ").";
    $("feedNote").textContent = note;
    syncFeedControls();
    renderTopicList();
    renderPager(ids.length, totalPages);
    if (!ids.length) {
      var li0 = document.createElement("li");
      li0.className = "post";
      li0.textContent = "No posts here yet.";
      list.appendChild(li0);
      return;
    }
    ids.slice((feedPage - 1) * feedPageSize, feedPage * feedPageSize).forEach(function (id) {
      var p = PodiumStore.postById(state, id);
      if (p) list.appendChild(postLi(p, false));
    });
    attachCardButtons(list);
  }

  /* ---------- composer ---------- */
  var composerText = $("composerText");
  var publishBtn = $("publishBtn");
  var gateState = { hard: [], soft: [], punctFix: null, clarityHold: false, overLimit: false };

  function updateOnePostNotice() {
    var box = $("onePostNotice");
    if (!state.currentUserId) {
      box.hidden = false;
      box.innerHTML = "<strong>Sign in to post.</strong> Pick a demo citizen to address the nation. ";
      var sb = document.createElement("button");
      sb.type = "button";
      sb.className = "btn btn-small";
      sb.textContent = "Sign in";
      sb.addEventListener("click", function () { openCitizens("post"); });
      box.appendChild(sb);
      $("composerForm").style.display = "none";
      return;
    }
    var existing = PodiumStore.userPostInCycle(state, state.currentUserId, currentCycle());
    if (existing) {
      box.hidden = false;
      box.innerHTML = "<strong>One post per citizen per weekly cycle.</strong> You already published this week (" +
        esc(excerpt(existing.body, 90)) + "). You can still vote on this week\u2019s posts.";
      $("composerForm").style.display = "none";
    } else {
      box.hidden = true;
      $("composerForm").style.display = "";
    }
  }

  function renderComposerGate() {
    var text = composerText.value;
    /* A wholly replaced draft (new opening) is a new draft: guided answers
       given for the old opening must not leak into its help panel. */
    var headNow = text.slice(0, 24);
    if (promptHead !== null && headNow !== promptHead) promptAnswers = { what: "", want: "", who: "" };
    promptHead = headNow;
    var words = PodiumAI.countWords(text);

    gateState.overLimit = words > PodiumAI.WORD_LIMIT;
    var timer = $("readTimer");
    timer.textContent = PodiumAI.formatTimer(text);
    timer.classList.toggle("over", gateState.overLimit);

    var res = PodiumAI.checkText(text);
    if (liveGateCache && liveGateCache.text === text) {
      res = { hard: unionHard(res.hard, liveGateCache.hard), soft: unionSoft(res.soft, liveGateCache.soft), punctFix: res.punctFix };
    }
    gateState.hard = res.hard;
    gateState.soft = res.soft;
    gateState.punctFix = res.punctFix || null;
    /* Comprehensibility hold: local verdict stands; live may only add a hold,
       never lift one. Live proposal wins when verified, else the tidy. */
    var localClarity = PodiumAI.clarityOf(text);
    var clarity = localClarity;
    var proposal = null;
    scheduleClarityLive(text, res.hard.length > 0);
    if (liveClarityCache && liveClarityCache.text === text) {
      if (liveClarityCache.unclear && !localClarity.unclear) {
        clarity = { unclear: true, hasSentence: localClarity.hasSentence, topic: localClarity.topic, ask: localClarity.ask, words: localClarity.words };
      }
      if (clarity.unclear && liveClarityCache.proposal) proposal = verifyProposal(liveClarityCache.proposal, text, clarity);
    }
    if (!proposal && localClarity.unclear && !res.hard.length) {
      proposal = verifyProposal(PodiumAI.tidyDraft(text), text, localClarity);
    }
    gateState.clarityHold = clarity.unclear;
    var gm = $("gateMessages");
    gm.innerHTML = "";
    var sf = $("softFlags");
    sf.innerHTML = "";

    scheduleLiveGate(text);
    if (!text.trim()) {
      publishBtn.disabled = true;
      clarityDismissedFor = null;
      renderVoiced(null);
      renderClarityPanel("", res, { unclear: false }, null);
      return;
    }
    if (gateState.overLimit) {
      var d0 = document.createElement("div");
      d0.className = "gate-error";
      d0.textContent = "Too long for the national reading: " + words + " of 630 words maximum. Shorten your post to fit the 4:30 read-aloud slot.";
      gm.appendChild(d0);
    }
    if (res.hard.length) {
      var d1 = document.createElement("div");
      d1.className = "gate-error";
      d1.innerHTML = "<strong>Cannot publish:</strong> this draft contains " + esc(res.hard.join(", ")) +
        ", which counts as profanity, a slur, or a personal attack. Such posts are never published. Remove it and keep your address professional.";
      gm.appendChild(d1);
    }
    if (!res.hard.length && res.soft.length) {
      var d2 = document.createElement("div");
      d2.className = "gate-hold";
      d2.innerHTML = "<strong>Held for your correction:</strong> " + res.soft.length +
        " wording issue(s) would embarrass you before a national audience. Accept a suggestion or retype the word yourself \u2014 nothing changes without your action.";
      gm.appendChild(d2);
      res.soft.forEach(function (f) {
        var chip = document.createElement("span");
        chip.className = "flag-chip";
        var label = "\u201c" + f.word + "\u201d \u2014 " + f.reason + " ";
        chip.textContent = label;
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = f.suggestion ? ("Use \u201c" + f.suggestion + "\u201d") : "Remove it";
        b.setAttribute("aria-label", "Replace " + f.word + (f.suggestion ? (" with " + f.suggestion) : " by removing it"));
        b.addEventListener("click", function () {
          var re = new RegExp("\\b" + f.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", f.caseSensitive ? "g" : "gi");
          composerText.value = composerText.value.replace(re, f.suggestion).replace(/ {2,}/g, " ");
          renderComposerGate();
          composerText.focus();
        });
        chip.appendChild(b);
        sf.appendChild(chip);
      });
    }
    if (!res.hard.length && res.punctFix) {
      var pf = document.createElement("div");
      pf.className = "gate-hold";
      pf.textContent = "Punctuation and spacing need a touch-up \u2014 one click fixes double spaces, spaces before punctuation, and the final period. ";
      var fixBtn = document.createElement("button");
      fixBtn.type = "button";
      fixBtn.textContent = "Fix punctuation and spacing";
      fixBtn.addEventListener("click", function () {
        composerText.value = res.punctFix;
        renderComposerGate();
      });
      pf.appendChild(fixBtn);
      gm.appendChild(pf);
    }
    if (!res.hard.length && clarity.unclear) {
      var ch = document.createElement("div");
      ch.className = "gate-hold";
      ch.innerHTML = "<strong>Held so you can be heard clearly:</strong> this draft is hard to understand as written, so it cannot publish yet. This is not a refusal \u2014 your post is not declined. Use the help below, or fix the draft yourself; you can return and publish at any time.";
      gm.appendChild(ch);
    }
    renderClarityPanel(text, res, clarity, proposal);
    if (!res.hard.length && !res.soft.length && !gateState.overLimit && !res.punctFix && !clarity.unclear) {
      var d3 = document.createElement("div");
      d3.className = "gate-ok";
      d3.textContent = "Wording check passed. Your topic, position, and meaning are yours alone \u2014 the check never touches them.";
      gm.appendChild(d3);
    }
    var blocked = res.hard.length > 0 || res.soft.length > 0 || res.punctFix || clarity.unclear || gateState.overLimit;
    publishBtn.disabled = blocked;

  }
  /* Live gate merge: local result (above) always stands; live may only add.
     The cache is keyed by exact draft text, so stale results never apply. */
  var liveGateCache = null;
  var liveGateTimer = null;
  function unionHard(a, b) {
    var out = (a || []).slice(), seen = {};
    out.forEach(function (x) { seen[x] = true; });
    (b || []).forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
    return out;
  }
  /* First-wins: local's casing-correct suggestion keeps its slot when live
     flags the same word, so the chip text never flickers on merge. A live
     capitalised suggestion still upgrades a local lowercase one. */
  function unionSoft(a, b) {
    var out = [], seen = {};
    (a || []).forEach(function (f) {
      if (f && f.word && !seen[String(f.word).toLowerCase()]) {
        seen[String(f.word).toLowerCase()] = true;
        out.push({ word: f.word, suggestion: f.suggestion, reason: f.reason, caseSensitive: f.caseSensitive });
      }
    });
    (b || []).forEach(function (f) {
      if (f && f.word && !seen[String(f.word).toLowerCase()]) {
        seen[String(f.word).toLowerCase()] = true;
        out.push({ word: f.word, suggestion: f.suggestion, reason: f.reason || "Live wording check.", caseSensitive: f.caseSensitive });
      }
    });
    out.forEach(function (f) {
      var g = (b || []).filter(function (x) { return x && String(x.word).toLowerCase() === String(f.word).toLowerCase(); })[0];
      if (g && !/^[A-Z]/.test(String(f.suggestion || "")) && /^[A-Z]/.test(String(g.suggestion || "")) && String(f.suggestion).toLowerCase() === String(g.suggestion).toLowerCase()) {
        f.suggestion = g.suggestion;
      }
    });
    return out;
  }
  function scheduleLiveGate(text) {
    if (liveGateTimer) clearTimeout(liveGateTimer);
    liveGateTimer = null;
    if (!text.trim()) { liveGateCache = null; return; }
    if (liveGateCache && liveGateCache.text === text) return; /* cached; merges on render */
    var snapshot = text;
    liveGateTimer = setTimeout(function () {
      liveGateTimer = null;
      PodiumAI.checkTextLive(snapshot).then(function (live) {
        if (!live) return; /* fallback: local stands, cache untouched */
        liveGateCache = { text: snapshot, hard: live.hard || [], soft: live.soft || [] };
        if (composerText.value !== snapshot) return; /* stale */
        renderComposerGate();
      });
    }, LIVE_DEBOUNCE_MS);
  }
  composerText.addEventListener("input", function () {
    renderComposerGate();
    scheduleVoiced();
    saveDraft();
  });

  /* ---------- comprehensibility hold + wording help ---------- */
  /* A held draft is never a published post: it lives only in the composer
     (persisted below), never in state.posts, so it cannot enter the draw
     pool or count toward one post per cycle. Nothing here publishes: the
     "Use this version" click loads the approved words and runs the normal
     publish path, which re-verifies everything. */
  var DRAFT_KEY = "podium.v1.draft";
  var draftSaveTimer = null;
  function saveDraft() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(function () {
      draftSaveTimer = null;
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: composerText.value, topic: $("composerTopic").value }));
      } catch (e) { /* private mode: the draft simply does not persist */ }
    }, 500);
  }
  function restoreDraft() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var d = JSON.parse(raw);
      if (d && typeof d.text === "string" && d.text && !composerText.value) {
        composerText.value = d.text.slice(0, 9000);
        if (d.topic) $("composerTopic").value = d.topic;
      }
    } catch (e) { /* corrupt draft: start fresh */ }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  function canSpeak() { return ("speechSynthesis" in window) && ("SpeechSynthesisUtterance" in window); }
  function speak(text) {
    if (!canSpeak()) return false;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      return true;
    } catch (e) { return false; }
  }
  function stopSpeak() { if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch (e) {} } }

  /* A proposal is offerable only when hard-clean, clear, within the cap, and
     different from the draft. Topic must not drift when both detect one. */
  function verifyProposal(proposal, draftText, draftClarity) {
    if (typeof proposal !== "string") return null;
    var p = proposal.trim();
    if (!p || p === String(draftText).trim()) return null;
    if (PodiumAI.countWords(p) > PodiumAI.WORD_LIMIT) return null;
    if (PodiumAI.checkText(p).hard.length) return null;
    var c = PodiumAI.clarityOf(p);
    if (c.unclear) return null;
    if (draftClarity && draftClarity.ask && !c.ask) return null; /* an approved rewrite must keep the author's ask */
    if (draftClarity && draftClarity.topic && c.topic && c.topic !== draftClarity.topic) return null;
    return p;
  }

  var liveClarityCache = null;
  var liveClarityTimer = null;
  function scheduleClarityLive(text, skip) {
    if (liveClarityTimer) clearTimeout(liveClarityTimer);
    liveClarityTimer = null;
    if (!text.trim()) { liveClarityCache = null; return; }
    if (skip) return;
    if (liveClarityCache && liveClarityCache.text === text) return; /* cached; merges on render */
    var snapshot = text;
    liveClarityTimer = setTimeout(function () {
      liveClarityTimer = null;
      PodiumAI.checkClarityLive(snapshot).then(function (live) {
        if (!live) return; /* fallback: local stands, cache untouched */
        liveClarityCache = { text: snapshot, unclear: live.unclear, proposal: live.proposal || null };
        if (composerText.value !== snapshot) return; /* stale */
        renderComposerGate();
      });
    }, LIVE_DEBOUNCE_MS);
  }

  var clarityDismissedFor = null; /* snapshot whose rewrite offer was declined */
  var promptAnswers = { what: "", want: "", who: "" };
  var promptHead = null; /* opening snapshot the current prompt answers were given for */
  var builtOffer = null; /* { text, built } answer-composed proposal awaiting approval */
  var clarityRenderKey = null;
  function renderClarityPanel(text, res, clarity, proposal) {
    var panel = $("clarityPanel");
    if (builtOffer && builtOffer.text !== text) builtOffer = null;
    var showHelp = !res.hard.length && clarity.unclear && !!text.trim() && text !== clarityDismissedFor;
    var useBuilt = !!(showHelp && builtOffer && builtOffer.text === text);
    var effProposal = useBuilt ? builtOffer.built : (showHelp ? proposal : null);
    var key = showHelp ? ((useBuilt ? "B" : "C") + text + "\n" + (effProposal || "")) : "off";
    if (key === clarityRenderKey) return;
    clarityRenderKey = key;
    panel.innerHTML = "";
    if (!showHelp) { panel.hidden = true; return; }
    panel.hidden = false;
    if (effProposal) renderOffer(panel, text, effProposal, useBuilt);
    else renderPrompts(panel);
  }

  function renderOffer(panel, text, proposal, built) {
    var wrap = document.createElement("div");
    wrap.className = "gate-hold";
    var title = built ? "Built only from your answers:" : "Proposed version \u2014 same meaning, clearer words:";
    var t = document.createElement("div");
    t.innerHTML = "<strong>" + esc(title) + "</strong> Nothing publishes until you click \u201cUse this version.\u201d";
    wrap.appendChild(t);
    var cols = document.createElement("div");
    cols.style.display = "flex";
    cols.style.flexWrap = "wrap";
    cols.style.gap = "8px";
    cols.style.margin = "8px 0";
    [["Your words:", String(text).trim()], ["Proposed version:", proposal]].forEach(function (pair) {
      var cell = document.createElement("div");
      cell.style.flex = "1 1 220px";
      var lab = document.createElement("div");
      lab.textContent = pair[0];
      var q = document.createElement("blockquote");
      q.textContent = pair[1];
      q.style.margin = "4px 0";
      cell.appendChild(lab);
      cell.appendChild(q);
      cols.appendChild(cell);
    });
    wrap.appendChild(cols);
    var row = document.createElement("div");
    var useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "btn btn-small";
    useBtn.textContent = "Use this version";
    useBtn.addEventListener("click", function () { useProposal(proposal); });
    row.appendChild(useBtn);
    row.appendChild(document.createTextNode(" "));
    var keepBtn = document.createElement("button");
    keepBtn.type = "button";
    keepBtn.className = "btn btn-small";
    keepBtn.textContent = "Keep my words";
    keepBtn.addEventListener("click", function () {
      clarityDismissedFor = composerText.value;
      builtOffer = null;
      promptAnswers = { what: "", want: "", who: "" };
      clarityRenderKey = null;
      renderComposerGate();
      composerText.focus();
    });
    row.appendChild(keepBtn);
    if (canSpeak()) {
      row.appendChild(document.createTextNode(" "));
      var hearBtn = document.createElement("button");
      hearBtn.type = "button";
      hearBtn.className = "btn btn-small";
      hearBtn.textContent = "Hear the proposed version";
      hearBtn.addEventListener("click", function () { speak(proposal); });
      row.appendChild(hearBtn);
    } else {
      var nn = document.createElement("div");
      nn.className = "hint";
      nn.textContent = "Your browser cannot read aloud; please read the proposed version above before approving.";
      wrap.appendChild(nn);
    }
    wrap.appendChild(row);
    panel.appendChild(wrap);
  }

  function useProposal(proposal) {
    stopSpeak();
    var p = verifyProposal(proposal, composerText.value, PodiumAI.clarityOf(composerText.value));
    if (!p) { clarityRenderKey = null; renderComposerGate(); return; } /* stale offer: re-evaluate */
    composerText.value = p;
    builtOffer = null;
    clarityDismissedFor = null;
    renderComposerGate();
    if (!PodiumAI.getKey()) {
      /* Publishes only when fully clean; otherwise the approved words stay
         in the composer with the remaining holds shown for fixing. */
      tryPublish(true);
      return;
    }
    /* A key is set: Spark gets the last word on the approved text before it
       can publish. Any live detection stands; the author then fixes and
       publishes. A failed call falls back silently, as everywhere. */
    PodiumAI.checkTextLive(p).then(function (live) {
      if (composerText.value !== p) return; /* author moved on */
      if (live && ((live.hard && live.hard.length) || (live.soft && live.soft.length))) {
        liveGateCache = { text: p, hard: live.hard || [], soft: live.soft || [] };
        renderComposerGate();
        return;
      }
      PodiumAI.checkClarityLive(p).then(function (cl) {
        if (composerText.value !== p) return;
        if (cl && cl.unclear) {
          liveClarityCache = { text: p, unclear: true, proposal: cl.proposal || null };
          clarityRenderKey = null;
          renderComposerGate();
          return;
        }
        tryPublish(true);
      });
    });
  }

  function renderPrompts(panel) {
    var wrap = document.createElement("div");
    wrap.className = "gate-hold";
    var t = document.createElement("div");
    t.innerHTML = "<strong>Help us understand \u2014 answer in your own words:</strong> no rewrite is offered because no clear position could be found in the draft. Nothing is invented: a draft is built only from your answers, and only with your approval.";
    wrap.appendChild(t);
    [["what", "What happened?"], ["want", "What do you want fixed or changed?"], ["who", "Who should fix it?"]].forEach(function (pair) {
      var fd = document.createElement("div");
      fd.className = "field";
      var lab = document.createElement("label");
      lab.textContent = pair[1];
      var inp = document.createElement("input");
      inp.type = "text";
      inp.value = promptAnswers[pair[0]];
      (function (key, el) {
        el.addEventListener("input", function () { promptAnswers[key] = el.value; });
      })(pair[0], inp);
      lab.appendChild(inp);
      fd.appendChild(lab);
      wrap.appendChild(fd);
    });
    var msg = document.createElement("div");
    msg.className = "hint";
    wrap.appendChild(msg);
    var buildBtn = document.createElement("button");
    buildBtn.type = "button";
    buildBtn.className = "btn btn-small";
    buildBtn.textContent = "Build my draft from these answers";
    buildBtn.addEventListener("click", function () { buildFromAnswers(panel, msg); });
    wrap.appendChild(buildBtn);
    panel.appendChild(wrap);
  }

  /* Compose a draft from the author's answers only: each answer becomes one
     sentence (first letter capitalized, terminal period added). No other
     words are added, and the result still faces the hard screen and the
     clarity check before any approval can publish it. */
  function buildFromAnswers(panel, msg) {
    var sents = [];
    ["what", "want", "who"].forEach(function (k) {
      var a = promptAnswers[k].trim();
      if (!a) return;
      a = a.charAt(0).toUpperCase() + a.slice(1);
      if (!/[.!?]$/.test(a)) a += ".";
      sents.push(a);
    });
    if (!sents.length) { msg.textContent = "Answer at least one question above, in your own words."; return; }
    var built = sents.join(" ");
    if (PodiumAI.checkText(built).hard.length) {
      msg.textContent = "These answers cannot be used as written: they contain wording that can never publish. Change the flagged words and try again.";
      return;
    }
    var bc = PodiumAI.clarityOf(built);
    if (bc.unclear) {
      /* Still unclear: show the composed words in the composer for fixing. */
      composerText.value = built;
      clarityRenderKey = null;
      renderComposerGate();
      composerText.focus();
      return;
    }
    builtOffer = { text: composerText.value, built: built };
    clarityRenderKey = null;
    renderComposerGate();
  }

  function wireHearUi() {
    var hb = $("hearDraftBtn");
    if (!hb) return;
    if (!canSpeak()) {
      var note = document.createElement("span");
      note.className = "hint";
      note.textContent = "Your browser cannot read text aloud.";
      hb.parentNode.replaceChild(note, hb);
      return;
    }
    hb.addEventListener("click", function () {
      var text = composerText.value.trim();
      if (!text) { composerText.focus(); return; }
      speak(text);
    });
  }

  function pipelineLabel(postId) {
    var b = PodiumStore.briefingItemFor(state, postId);
    if (!b) return "not yet selected";
    return (b.selection === "top" ? "top-voted" : "random pick") + ", " + displayPipeline(PodiumStore.cycleById(state, b.cycleId), b.pipeline);
  }

  var voicedTimer = null;
  var voicedShown = false;
  var voicedDismissed = false;
  var voicedForText = null; /* draft lineage the box state belongs to */
  /* Generic live-AI debounce: the live gate, live clarity, and Already-voiced
     checks all wait this long after typing stops before calling out. */
  var LIVE_DEBOUNCE_MS = 2500;

  /* The box appears only after the user STOPS typing for a few seconds, and
     only once per draft. It sits below the composer and never blocks input. */
  function scheduleVoiced() {
    if (voicedTimer) clearTimeout(voicedTimer);
    voicedTimer = null;
    if (!composerText.value.trim()) {
      voicedShown = false;
      voicedDismissed = false;
      voicedForText = null;
      renderVoiced(null);
      return;
    }
    /* A wholly replaced draft (new opening) is a new draft: the once-per-draft
       box may appear for it. Edits keeping the opening keep the manners. */
    var curHead = composerText.value.slice(0, 24);
    if (voicedForText !== null && curHead !== voicedForText.slice(0, 24)) {
      voicedShown = false;
      voicedDismissed = false;
    }
    if (voicedShown || voicedDismissed) return;
    voicedTimer = setTimeout(function () {
      voicedTimer = null;
      if (voicedShown || voicedDismissed) return;
      var snapshot = composerText.value;
      var scope = PodiumStore.postsForCycle(state, currentCycle());
      var local = PodiumAI.findTopSimilar(snapshot, scope);
      renderVoiced(local);
      PodiumAI.findTopSimilarLive(snapshot, scope).then(function (livePost) {
        if (!livePost) return; /* fallback: local stands */
        if (composerText.value !== snapshot || voicedDismissed) return; /* stale */
        var pool = [];
        if (local) pool.push(local);
        if (!local || livePost.id !== local.id) pool.push(livePost);
        pool.sort(function (a, b) { return b.votes - a.votes; });
        if (pool.length && (!local || pool[0].id !== local.id)) renderVoiced(pool[0]);
      });
    }, LIVE_DEBOUNCE_MS);
  }

  function renderVoiced(match) {
    var panel = $("voicedPanel");
    panel.innerHTML = "";
    if (!match) { panel.hidden = true; return; }
    voicedShown = true;
    voicedForText = composerText.value;
    panel.hidden = false;
    var head = document.createElement("div");
    head.className = "voiced-head";
    var h = document.createElement("h3");
    h.textContent = "Already voiced";
    var x = document.createElement("button");
    x.type = "button";
    x.className = "voiced-close";
    x.textContent = "\u00d7 Dismiss";
    x.setAttribute("aria-label", "Dismiss this suggestion");
    x.addEventListener("click", function () {
      voicedDismissed = true;
      voicedForText = composerText.value;
      panel.hidden = true;
    });
    head.appendChild(h);
    head.appendChild(x);
    panel.appendChild(head);
    var author = PodiumStore.citizenById(state, match.authorId);
    var mp = document.createElement("p");
    mp.innerHTML = "<strong>" + esc(author.name) + "</strong> (" + votesLabel(match.votes) +
      " \u00b7 " + esc(pipelineLabel(match.id)) + "): " +
      esc(excerpt(match.body, 220));
    panel.appendChild(mp);
    var rem = document.createElement("p");
    rem.className = "reminder";
    rem.textContent = "A conflicting post may divide votes and reduce the likelihood of your concern being heard.";
    panel.appendChild(rem);
    var exits = document.createElement("div");
    exits.className = "exits";
    var insteadBtn = document.createElement("button");
    insteadBtn.type = "button";
    insteadBtn.className = "btn btn-small";
    insteadBtn.textContent = (state.currentUserId && PodiumStore.hasVoted(state, state.currentUserId, match.id))
      ? "Upvoted \u2713" : "Vote for theirs instead";
    insteadBtn.addEventListener("click", function () {
      if (!state.currentUserId) { openCitizens("vote"); return; }
      if (match.cycleId !== currentCycle()) {
        insteadBtn.textContent = "Voting closed (past week)";
        insteadBtn.disabled = true;
        return;
      }
      if (!PodiumStore.hasVoted(state, state.currentUserId, match.id)) {
        PodiumStore.castVote(state, state.currentUserId, match.id);
      }
      insteadBtn.textContent = "Upvoted \u2713";
      renderFeed();
    });
    var bothBtn = document.createElement("button");
    bothBtn.type = "button";
    bothBtn.className = "btn btn-small";
    bothBtn.textContent = "Post mine and vote theirs too";
    bothBtn.addEventListener("click", function () {
      if (!state.currentUserId) { openCitizens("vote"); return; }
      if (match.cycleId === currentCycle() && !PodiumStore.hasVoted(state, state.currentUserId, match.id)) {
        PodiumStore.castVote(state, state.currentUserId, match.id);
      }
      renderFeed();
      publishBtn.focus();
    });
    var asisBtn = document.createElement("button");
    asisBtn.type = "button";
    asisBtn.className = "btn btn-small";
    asisBtn.textContent = "Post mine as-is";
    asisBtn.addEventListener("click", function () { publishBtn.focus(); });
    exits.appendChild(insteadBtn);
    exits.appendChild(bothBtn);
    exits.appendChild(asisBtn);
    panel.appendChild(exits);
  }

  /* Layer 1 anti-flood: exact copy of a current-cycle post. Hard gate with
     no post-anyway exit. The draft is kept; the citizen can upvote instead. */
  function showCopyRedirect(dup) {
    var gm = $("gateMessages");
    gm.innerHTML = "";
    var d = document.createElement("div");
    d.className = "gate-error";
    var msg = document.createElement("p");
    msg.textContent = "This post already exists in this cycle \u2014 upvote it to add your voice.";
    d.appendChild(msg);
    var quote = document.createElement("p");
    quote.innerHTML = "<strong>Existing post:</strong> \u201c" + esc(excerpt(dup.body, 200)) + "\u201d";
    d.appendChild(quote);
    var vb = document.createElement("button");
    vb.type = "button";
    vb.className = "btn btn-small";
    vb.textContent = PodiumStore.hasVoted(state, state.currentUserId, dup.id) ? "Upvoted \u2713" : "Upvote it instead";
    vb.addEventListener("click", function () {
      if (!PodiumStore.hasVoted(state, state.currentUserId, dup.id)) {
        PodiumStore.castVote(state, state.currentUserId, dup.id);
      }
      vb.textContent = "Upvoted \u2713";
      renderFeed();
    });
    d.appendChild(vb);
    gm.appendChild(d);
    publishBtn.disabled = true;
  }

  function tryPublish(fromPreview) {
    if (!state.currentUserId) { openCitizens("post"); return; }
    renderComposerGate();
    if (publishBtn.disabled && !fromPreview) return;
    var text = composerText.value.trim();
    if (!text) return;
    if (gateState.hard.length || gateState.soft.length || gateState.punctFix || gateState.clarityHold || gateState.overLimit) return;
    var dup = PodiumStore.findExactInCycle(state, currentCycle(), text);
    if (dup) { showCopyRedirect(dup); return; }
    var post = PodiumStore.publishPost(state, state.currentUserId, currentCycle(), $("composerTopic").value, text, etNow());
    if (!post) { updateOnePostNotice(); return; }
    composerText.value = "";
    clearDraft();
    stopSpeak();
    promptAnswers = { what: "", want: "", who: "" };
    builtOffer = null;
    clarityDismissedFor = null;
    clarityRenderKey = null;
    if (voicedTimer) clearTimeout(voicedTimer);
    voicedTimer = null;
    voicedShown = false;
    voicedDismissed = false;
    voicedForText = null;
    renderVoiced(null);
    closeModal($("previewModal"));
    renderComposerGate();
    updateOnePostNotice();
    feedSort = "recent";
    feedTopic = "";
    $("searchInput").value = "";
    feedPage = 1;
    feedList = null; /* rebuild so the new post leads page 1 */
    saveFeedState();
    showView("feed");
    renderFeed();
    $("feedNote").textContent = "Published \u2014 final. Your post cannot be edited or redacted. It now stands for this week\u2019s vote.";
  }
  $("composerForm").addEventListener("submit", function (e) {
    e.preventDefault();
    tryPublish(false);
  });

  /* ---------- preview ---------- */
  function showTopicSuggestion(sug) {
    var pt = $("previewTopic");
    pt.hidden = false;
    pt.innerHTML = "AI topic suggestion, shown once at review \u2014 yours to accept or ignore: <strong>" + esc(sug) + "</strong> ";
    var useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "btn btn-small";
    useBtn.textContent = "Use this topic";
    useBtn.addEventListener("click", function () {
      $("composerTopic").value = sug;
      pt.hidden = true;
      saveDraft();
    });
    pt.appendChild(useBtn);
  }
  $("previewBtn").addEventListener("click", function () {
    if (!state.currentUserId) { openCitizens("post"); return; }
    var text = composerText.value.trim();
    if (!text) { composerText.focus(); return; }
    $("previewMeta").textContent = currentUser().name + " \u00b7 " + $("composerTopic").value + " \u00b7 " +
      PodiumAI.countWords(text) + " words \u00b7 " + PodiumAI.formatTimer(text) + " read aloud";
    $("previewBody").textContent = text;
    var pt = $("previewTopic");
    var sug = PodiumAI.suggestTopic(text);
    if (sug && sug !== $("composerTopic").value) {
      showTopicSuggestion(sug);
    } else {
      pt.hidden = true;
      pt.innerHTML = "";
      var snapText = text, snapTopic = $("composerTopic").value;
      PodiumAI.suggestTopicLive(text).then(function (liveSug) {
        if (!liveSug) return; /* fallback: nothing to add */
        if ($("previewModal").hidden) return; /* stale */
        if (composerText.value.trim() !== snapText || $("composerTopic").value !== snapTopic) return;
        if (!$("previewTopic").hidden) return; /* first-shown wins */
        showTopicSuggestion(liveSug);
      });
    }
    openModal($("previewModal"));
  });
  $("previewClose").addEventListener("click", function () { closeModal($("previewModal")); });
  $("previewPublish").addEventListener("click", function () { tryPublish(true); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!$("previewModal").hidden) { closeModal($("previewModal")); return; }
      if (!$("citizenModal").hidden) { closeModal($("citizenModal")); return; }
      return;
    }
    if (e.key !== "Tab") return;
    var box = !$("previewModal").hidden ? $("previewModal") : (!$("citizenModal").hidden ? $("citizenModal") : null);
    if (!box) return;
    var f = modalFocusables(box);
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });

  /* ---------- briefing ---------- */
  /* Pipeline stage is displayed from the clock, never from frozen seed flags:
     once the cycle's briefing datetime has passed the stage is "Briefed",
     otherwise the stored pipeline value stands. Stored values are untouched. */
  function displayPipeline(cycle, pipeline) {
    var bAt = cycle && cycleDateTimeFor(cycle, cycle.briefingAt);
    if (bAt && bAt <= etNow()) return "briefed";
    return pipeline;
  }
  function stageHtml(pipeline) {
    var steps = [["selected", "Selected"], ["committee", "In Committee Review"], ["briefed", "Briefed"]];
    var order = { selected: 0, committee: 1, briefed: 2 };
    var cur = order[pipeline] !== undefined ? order[pipeline] : 0;
    return '<div class="stage" role="img" aria-label="Pipeline stage: ' + steps[cur][1] + '">' + steps.map(function (s, i) {
      return (i > 0 ? '<span class="stage-arrow" aria-hidden="true">\u2192</span>' : "") +
        '<span class="stage-step' + (i <= cur ? " done" : "") + '">' + s[1] + "</span>";
    }).join("") + "</div>";
  }

  function selectionBadge(cycle, item, p) {
    var poolLen = cycle.poolSize;
    if (item.selection === "top") {
      return '<span class="badge-top">TOP-VOTED \u00b7 ' + p.votes + " votes</span>";
    }
    return '<span class="badge-random">RANDOM DRAW \u00b7 position ' + cycle.position + " of " + poolLen + "</span>";
  }
  /* Verbatim excerpt only: the author's exact words (first sentence, capped
     at ~200 chars). Never a paraphrase — the Verbatim Rule forbids editors. */
  function briefExcerpt(text) {
    var s = firstSentence(text);
    if (s.length <= 200) return s;
    return excerpt(text, 200);
  }
  /* One box's own expansion button, placed directly under that box.
     Expansion extends the EXISTING box in place: the toggle swaps that same
     box's blockquote between excerpt and full text, so the card never gains
     a second box. "Verbatim" belongs to the citizen post only — the
     answer's button says "answer", never "verbatim", so the two zones
     stay distinct. Labels and button texts stay as they are. */
  function zoneExpander(zoneClass, labelText, fullLabelText, excerptHtml, fullHtml, buttonLabel) {
    var wrap = document.createElement("div");
    var box = document.createElement("div");
    box.className = "zone " + zoneClass;
    box.innerHTML = '<span class="zone-label">' + labelText + "</span><blockquote>" + excerptHtml + "</blockquote>";
    wrap.appendChild(box);
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-small";
    toggle.textContent = buttonLabel;
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", function () {
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      box.querySelector("blockquote").innerHTML = expanded ? excerptHtml : fullHtml;
      box.querySelector(".zone-label").textContent = expanded ? labelText : fullLabelText;
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.textContent = expanded ? buttonLabel : "Show summary";
    });
    wrap.appendChild(toggle);
    return wrap;
  }
  function briefingSummaryCard(cycle, item) {
    var p = PodiumStore.postById(state, item.postId);
    var author = PodiumStore.citizenById(state, p.authorId);
    var li = document.createElement("li");
    li.className = "card";
    var head = document.createElement("div");
    head.innerHTML = "<p>" + selectionBadge(cycle, item, p) + "</p>" +
      '<p class="hint">' + esc(cycleLabel(cycle)) + "</p>" +
      stageHtml(displayPipeline(cycle, item.pipeline)) +
      '<p><span class="ref-code">' + esc(p.ref || "") + "</span> <strong>" + esc(author.name) + "</strong>" + stateSuffix(p) + " \u00b7 " + esc(p.topic) + " \u00b7 " + p.votes + " votes</p>";
    li.appendChild(head);
    li.appendChild(zoneExpander("zone-post", "Citizen Post \u2014 excerpt, verbatim", "Citizen Post \u2014 in full, verbatim",
      esc(briefExcerpt(p.body)), esc(p.body), "Read verbatim in full"));
    li.appendChild(zoneExpander("zone-answer", "Official Answer \u2014 excerpt", "Official Answer \u2014 in full",
      esc(briefExcerpt(displayAnswer(item.answer))), esc(displayAnswer(item.answer)), "Read answer in full"));
    var row = document.createElement("div");
    row.className = "btn-row";
    var record = document.createElement("button");
    record.type = "button";
    record.className = "btn btn-small";
    record.textContent = "See full record";
    record.addEventListener("click", function () {
      threadSelect($("priorSelect"), renderPriorCard).value = p.id;
      showView("prior");
    });
    row.appendChild(record);
    li.appendChild(row);
    return li;
  }
  function briefingWednesday(cycle) {
    var m = /^Wed ([A-Za-z]+ \d+)/.exec(cycle.briefingAt || "");
    return m ? ("Wednesday, " + m[1]) : cycle.briefingAt;
  }
  /* Next Week preview: selected posts awaiting answers. NEVER shows answer
     text — the committee is still formulating it. */
  function nextWeekItem(cycle, item) {
    var p = PodiumStore.postById(state, item.postId);
    var author = PodiumStore.citizenById(state, p.authorId);
    var li = document.createElement("li");
    li.className = "card next-item";
    li.innerHTML = "<p>" + selectionBadge(cycle, item, p) + "</p>" + stageHtml(displayPipeline(cycle, item.pipeline)) +
      '<p><span class="ref-code">' + esc(p.ref || "") + "</span> <strong>" + esc(author.name) + "</strong>" + stateSuffix(p) + " \u00b7 " + esc(p.topic) + "</p>" +
      '<div class="zone zone-post"><span class="zone-label">Citizen Post \u2014 verbatim in full</span>' +
      "<blockquote>" + esc(p.body) + "</blockquote>" +
      '<p class="hint">\u2014 ' + esc(author.name) + " \u00b7 selected for next week\u2019s briefing</p></div>" +
      '<p class="hint">Answer coming ' + esc(briefingWednesday(cycle)) + ". The committee is still formulating it.</p>";
    li.appendChild(buildWonderZone(p));
    return li;
  }

  /* Wonder answer drafts (demo): session-only, never mutate any record.
     A draft displays separately until "Approve draft" is clicked; only
     then does the DISPLAYED text change (approved pill). The seeded
     record is never mutated. The zone lives under Next Week posts: the
     committee drafts during committee week, before the briefing airs. */
  var wonderDrafts = {};   /* postId -> draft text */
  var wonderApproved = {}; /* postId -> true once approved in this session */
  var wonderEdited = {};   /* postId -> true once the committee edited the draft */
  /* Committee-only visibility (TY, Oct 28): in the real product drafts
     and editing are committee-only; the demo shows them publicly for
     evaluation. Display text only — never gates or hides the controls. */
  var WONDER_VISIBILITY_NOTE = "Demo only: drafts and editing are committee-only in the real product and shown here for evaluation. The public sees only approved answers.";
  function buildWonderZone(p) {
    var wonderBox = document.createElement("div");
    wonderBox.className = "zone zone-answer";
    var draftBtn = document.createElement("button");
    draftBtn.type = "button";
    draftBtn.className = "btn btn-small";
    draftBtn.textContent = "Draft answer with Wonder";
    var wonderVisibility = document.createElement("p");
    wonderVisibility.className = "hint";
    wonderVisibility.textContent = WONDER_VISIBILITY_NOTE;
    var wonderStatus = document.createElement("p");
    wonderStatus.className = "hint";
    wonderBox.appendChild(draftBtn);
    wonderBox.appendChild(wonderVisibility);
    wonderBox.appendChild(wonderStatus);
    function draftLabel() {
      return wonderEdited[p.id]
        ? "AI-drafted by Muse Wonder, edited by committee \u2014 pending committee review"
        : "AI-drafted by Muse Wonder \u2014 pending committee review";
    }
    function showDraft() {
      var draft = wonderDrafts[p.id];
      if (!draft || wonderApproved[p.id]) return;
      var box = document.createElement("div");
      box.innerHTML = '<span class="zone-label">' + esc(draftLabel()) + "</span>" +
        "<p>" + esc(draft) + "</p>" +
        '<p class="hint">' + esc(WONDER_VISIBILITY_NOTE) + "</p>" +
        '<p class="hint">Demo only: in the real product the committee reviews, edits, and approves drafts; approval here is simulated and changes only what is displayed.</p>';
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-small";
      editBtn.textContent = "Edit draft";
      editBtn.addEventListener("click", function () {
        /* Local UI operation on the returned draft text only: no model
           call, no re-draft. Save updates the session-only draft. */
        box.innerHTML = '<span class="zone-label">' + esc(draftLabel()) + "</span>";
        var ta = document.createElement("textarea");
        ta.value = wonderDrafts[p.id];
        ta.rows = 6;
        ta.style.width = "100%";
        ta.setAttribute("aria-label", "Edit the committee draft answer");
        box.appendChild(ta);
        var saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn btn-small";
        saveBtn.textContent = "Save edit";
        saveBtn.addEventListener("click", function () {
          if (!ta.value.trim()) { renderBriefing(); return; }
          wonderDrafts[p.id] = ta.value;
          wonderEdited[p.id] = true;
          renderBriefing();
        });
        var cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn btn-small";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", function () { renderBriefing(); });
        box.appendChild(saveBtn);
        box.appendChild(document.createTextNode(" "));
        box.appendChild(cancelBtn);
        ta.focus();
      });
      var approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "btn btn-small";
      approveBtn.textContent = "Approve draft";
      approveBtn.addEventListener("click", function () {
        wonderApproved[p.id] = true;
        renderBriefing();
      });
      box.appendChild(editBtn);
      box.appendChild(document.createTextNode(" "));
      box.appendChild(approveBtn);
      wonderBox.appendChild(box);
    }
    draftBtn.addEventListener("click", function () {
      draftBtn.disabled = true;
      wonderStatus.textContent = "Drafting with Muse Wonder (" + PodiumAI.WONDER_MODEL + ")...";
      PodiumAI.draftCommitteeAnswer(p).then(function (draft) {
        draftBtn.disabled = false;
        if (!draft) {
          wonderStatus.textContent = "Muse Wonder is unavailable (no session key, or the call failed) \u2014 the seeded answer above stands. Answers are never drafted by Spark.";
          return;
        }
        wonderDrafts[p.id] = draft;
        delete wonderApproved[p.id];
        delete wonderEdited[p.id];
        wonderStatus.textContent = "";
        showDraft();
      });
    });
    if (wonderApproved[p.id] && wonderDrafts[p.id]) {
      var done = document.createElement("div");
      done.innerHTML = '<p><span class="status-pill">Approved by committee (demo)</span></p>' +
        "<p>" + esc(wonderDrafts[p.id]) + "</p>";
      wonderBox.appendChild(done);
    } else if (wonderDrafts[p.id]) {
      showDraft();
    }
    return wonderBox;
  }

  /* Settled timing (TY, Oct 28): This Week = the most recently AIRED
     briefing, and only that — it flips only after the Wednesday 1:00 PM ET
     airing. Next Week = the selections for the next briefing, published
     from the Monday draw onward. Derived from briefing datetimes and the
     clock (America/New_York), never from seed statuses. */
  function etNow() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  }
  /* Derived current cycle, recomputed at every call so a tab left open
     across a week boundary rolls on re-render, not only on reload. */
  function currentCycle() { return PodiumStore.currentCycleId(state, etNow()); }
  /* Render-time "(voting now)" marker: the derived current cycle is the
     voting one; static labels carry no marker since the rollover. */
  function cycleLabel(c) { return c ? c.label + (c.id === currentCycle() ? " (voting now)" : "") : ""; }
  /* Single parsing implementation lives in PodiumStore (same flip as Replay).
     The year always comes from the cycle's own votingStart, never the clock. */
  function cycleDateTimeFor(c, str) {
    var y = PodiumStore.cycleYear(c);
    return PodiumStore.cycleDateTime(str, y === null ? etNow().getFullYear() : y);
  }
  function renderBriefing() {
    var nowEt = etNow();
    var thisWeek = null, next = null;
    state.cycles.forEach(function (c) {
      var bAt = cycleDateTimeFor(c, c.briefingAt);
      if (!bAt || !c.topPostId) return;
      if (bAt <= nowEt) thisWeek = c; /* cycles are chronological: last aired wins */
      var dAt = cycleDateTimeFor(c, c.drawAt);
      if (bAt > nowEt && (!dAt || dAt <= nowEt)) next = c; /* most recently drawn, unbriefed */
    });
    /* No stale-status fallback: before the first briefing airs, This Week is
       empty (the section renders nothing until a briefing datetime passes). */
    var pl = $("pipelineList");
    pl.innerHTML = "";
    if (thisWeek) {
      $("briefingTitle").textContent = "This week\u2019s briefing \u2014 " + thisWeek.briefingAt;
      PodiumStore.itemsForCycle(state, thisWeek.id).forEach(function (item) {
        pl.appendChild(briefingSummaryCard(thisWeek, item));
      });
    }
    var nl = $("nextList");
    nl.innerHTML = "";
    $("nextSection").hidden = !next;
    if (next) {
      PodiumStore.itemsForCycle(state, next.id).forEach(function (item) {
        nl.appendChild(nextWeekItem(next, item));
      });
    }



    /* draw transparency: most recent completed draw */
    var drawn = next || thisWeek;
    var df = $("drawFacts");
    df.innerHTML = "";
    if (drawn && drawn.topPostId) {
      /* Historical record: stored values only, never a live recount — the
         cutoff removes unselected posts, so recounting would rewrite history. */
      var picked = PodiumStore.postById(state, drawn.randomPostId);
      var rows = [
        ["Cycle", cycleLabel(drawn) + " (" + drawn.range + ")"],
        ["Pool frozen", drawn.cutoffAt + " \u2014 " + drawn.poolSize + " eligible posts (winner and winner-matching copies excluded), published before the draw"],
        ["Beacon pulse", drawn.beaconTime + " \u2014 value " + drawn.beaconHex + " (numeric excerpt " + drawn.beaconNum + ")"],
        ["Computation", drawn.beaconNum + " mod " + drawn.poolSize + " = " + (drawn.position - 1) + " \u2192 +1 = post #" + drawn.position],
        ["Selected", picked ? ("\u201c" + excerpt(picked.body, 80) + "\u201d") : "\u2014"]
      ];
      rows.forEach(function (r) {
        var dt = document.createElement("dt"); dt.textContent = r[0];
        var dd = document.createElement("dd"); dd.textContent = r[1];
        df.appendChild(dt); df.appendChild(dd);
      });
      var ex = $("excludedList");
      ex.innerHTML = "";
      var winner = PodiumStore.postById(state, drawn.topPostId);
      var winnerBody = winner.body.trim().toLowerCase();
      PodiumStore.postsForCycle(state, drawn.id)
        .filter(function (p) { return p.id === drawn.topPostId || p.body.trim().toLowerCase() === winnerBody; })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; })
        .forEach(function (p) {
          var li = document.createElement("li");
          var isWinner = p.id === drawn.topPostId;
          var by = PodiumStore.citizenById(state, p.authorId);
          li.innerHTML = "<strong>" + esc(by.name) + "</strong>" + stateSuffix(p) + " " +
            '<span class="ref-code">' + esc(p.ref || "") + "</span> \u201c" + esc(excerpt(p.body, 120)) + "\u201d \u2014 " +
            (isWinner ? "already has the briefing\u2019s top slot" : "anti-flood deduplication (content matches the winner\u2019s)") + " ";
          var full = document.createElement("div");
          full.hidden = true;
          full.innerHTML = "<blockquote>" + esc(p.body) + "</blockquote>";
          li.appendChild(full);
          var toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "btn btn-small";
          toggle.textContent = "Read full post";
          toggle.setAttribute("aria-expanded", "false");
          toggle.addEventListener("click", function () {
            full.hidden = !full.hidden;
            toggle.setAttribute("aria-expanded", String(!full.hidden));
            toggle.textContent = full.hidden ? "Read full post" : "Collapse";
          });
          li.appendChild(document.createTextNode(" "));
          li.appendChild(toggle);
          ex.appendChild(li);
        });
    }
  }

  /* ---------- prior posts & answers / status updates ---------- */
  /* Visibility gating (TY, Oct 28): Prior and Status list ONLY selections
     whose briefing has aired. Reuses the aired-cycle rule built for This
     Week / Replay (PodiumStore.replayCycles) — no second timing rule. */
  function airedCycleIds() {
    var ids = {};
    PodiumStore.replayCycles(state, etNow()).forEach(function (c) { ids[c.id] = true; });
    return ids;
  }
  function airedBriefingItems() {
    var ok = airedCycleIds();
    return state.briefingItems.filter(function (b) { return !!ok[b.cycleId]; });
  }
  function defaultAiredBriefing() {
    var items = airedBriefingItems();
    if (!items.length) return null;
    var cycles = PodiumStore.replayCycles(state, etNow()); /* newest first */
    for (var i = 0; i < cycles.length; i++) {
      var top = null, first = null;
      items.forEach(function (b) {
        if (b.cycleId === cycles[i].id) {
          if (!first) first = b;
          if (b.selection === "top") top = b;
        }
      });
      if (top || first) return top || first;
    }
    return items[0];
  }
  function fillThreadSelect(sel) {
    airedBriefingItems().forEach(function (b) {
      var c = PodiumStore.cycleById(state, b.cycleId);
      var p = PodiumStore.postById(state, b.postId);
      var o = document.createElement("option");
      o.value = b.postId;
      o.textContent = cycleLabel(c) + " \u00b7 " + (b.selection === "top" ? "top-voted" : "random draw") + " \u00b7 " + (p.ref || "") + " \u00b7 " + excerpt(p.body, 40);
      sel.appendChild(o);
    });
    var d = defaultAiredBriefing();
    if (d) sel.value = d.postId;
  }
  /* Dropdown options are rebuilt on every render (never filled once): after a
     briefing flip, new aired selections appear without a reload. The current
     selection is preserved when it still exists, else the default applies. */
  function threadSelect(sel, onChange) {
    var cur = sel.value;
    sel.innerHTML = "";
    fillThreadSelect(sel);
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === cur) { has = true; break; }
    }
    if (has && cur) sel.value = cur;
    if (!sel.dataset.bound) { sel.dataset.bound = "1"; sel.addEventListener("change", onChange); }
    return sel;
  }
  function selectedBriefing(selId) {
    var b = PodiumStore.briefingItemFor(state, $(selId).value);
    if (b && airedCycleIds()[b.cycleId]) return b;
    return defaultAiredBriefing() || state.briefingItems[0];
  }
  function selectionTitle(b) {
    var c = PodiumStore.cycleById(state, b.cycleId);
    return esc(cycleLabel(c)) + " \u00b7 " + (b.selection === "top" ? "Top-voted selection" : "Random-draw selection");
  }
  function renderPrior() {
    threadSelect($("priorSelect"), renderPriorCard);
    renderPriorCard();
  }
  function renderPriorCard() {
    var b = selectedBriefing("priorSelect");
    var p = PodiumStore.postById(state, b.postId);
    var author = PodiumStore.citizenById(state, p.authorId);
    var card = $("priorCard");
    var html = "<h3>" + selectionTitle(b) + "</h3>" +
      stageHtml(displayPipeline(PodiumStore.cycleById(state, b.cycleId), b.pipeline)) +
      '<p><span class="ref-code">' + esc(p.ref || "") + "</span></p>" +
      '<div class="zone zone-post"><span class="zone-label">Citizen Post \u2014 verbatim, final</span>' +
      "<blockquote>" + esc(p.body) + "</blockquote>" +
      '<p class="hint">\u2014 ' + esc(author.name) + stateSuffix(p) + " \u00b7 " + esc(p.topic) + " \u00b7 " + votesLabel(p.votes) + "</p></div>" +
      '<div class="zone zone-answer"><span class="zone-label">Official Answer</span>' +
      '<p><span class="ref-code">' + esc(answerCode(p)) + "</span></p>" +
      "<p>" + esc(displayAnswer(b.answer)) + "</p></div>";
    var last = b.updates[b.updates.length - 1];
    if (last) {
      html += '<div class="zone zone-answer"><span class="zone-label">Most recent update</span>' +
        '<p><span class="ref-code">' + esc(updateCode(p, b.updates.length - 1)) + "</span> <strong>" + esc(last.date) + "</strong></p>" +
        "<p>" + esc(last.text) + "</p>" +
        '<p>Status: <span class="status-pill">' + esc(b.trackerStatus) + "</span>" +
        (b.trackerStatus === "No Action" && b.officialReason ? " \u2014 " + esc(b.officialReason) : "") + "</p></div>";
    }
    card.innerHTML = html;
    var link = document.createElement("button");
    link.type = "button";
    link.className = "btn btn-small";
    link.textContent = "Status updates for " + (p.ref || "this post") + " \u2192";
    link.addEventListener("click", function () {
      threadSelect($("statusSelect"), renderStatusCard).value = p.id;
      showView("status");
    });
    card.appendChild(link);
  }
  function renderStatus() {
    threadSelect($("statusSelect"), renderStatusCard);
    renderStatusCard();
  }
  function renderStatusCard() {
    var b = selectedBriefing("statusSelect");
    var p = PodiumStore.postById(state, b.postId);
    var author = PodiumStore.citizenById(state, p.authorId);
    var card = $("statusCard");
    var html = "<h3>" + selectionTitle(b) + "</h3>" +
      '<p><span class="ref-code">' + esc(p.ref || "") + "</span> " + esc(author.name) + stateSuffix(p) + ' \u00b7 Status: <span class="status-pill">' + esc(b.trackerStatus) + "</span>" +
      (b.trackerStatus === "No Action" && b.officialReason ? " \u2014 " + esc(b.officialReason) : "") + "</p>" +
      "<h4>Dated progress updates</h4><ul class=\"updates\">" +
      b.updates.map(function (u, i) { return "<li><span class=\"ref-code\">" + esc(updateCode(p, i)) + "</span> <strong>" + esc(u.date) + ":</strong> " + esc(u.text) + "</li>"; }).join("") +
      "</ul>";
    card.innerHTML = html;
    var back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn-small";
    back.textContent = "\u2190 Post and answer for " + (p.ref || "this post");
    back.addEventListener("click", function () {
      threadSelect($("priorSelect"), renderPriorCard).value = p.id;
      showView("prior");
    });
    card.appendChild(back);
  }

  /* ---------- share + deep links ---------- */
  function postUrl(id) {
    return window.location.href.split("#")[0] + "#post/" + id;
  }
  function copyText(text, done) {
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }
  function doShare(p, btn) {
    var url = postUrl(p.id);
    if (navigator.share) {
      /* Some environments expose share without ever settling it; fall back
         to copy so the control always completes. A real dismiss stays
         a no-op. */
      var settled = false;
      var shareTimer = setTimeout(function () {
        if (!settled) { settled = true; copyShareLink(url, btn); }
      }, 5000);
      navigator.share({ title: "The Podium", text: excerpt(p.body, 140), url: url })
        .then(function () { settled = true; clearTimeout(shareTimer); },
          function (e) {
            settled = true; clearTimeout(shareTimer);
            /* Genuine user cancel stays a no-op; any other failure (not
               allowed, not supported) falls back to copy. */
            if (!e || e.name !== "AbortError") copyShareLink(url, btn);
          });
      return;
    }
    copyShareLink(url, btn);
  }
  function copyShareLink(url, btn) {
    copyText(url, function (ok) {
      btn.textContent = ok ? "Link copied \u2713" : "Copy failed";
      setTimeout(function () { btn.textContent = "Share"; }, 2000);
    });
  }
  function clearDeepLink() {
    linkedPostId = null;
    linkedSuffix = null;
    linkMissing = false;
    lastCodeJump = null;
    try {
      history.replaceState(null, document.title, window.location.pathname + window.location.search);
    } catch (e) { /* file:// may refuse: hash stays but view resets */ }
    renderFeed();
  }
  function handleDeepLink() {
    var m = /^#post\/([A-Za-z0-9-]+)/.exec(window.location.hash || "");
    if (!m) {
      if (linkedPostId || linkMissing) { linkedPostId = null; linkedSuffix = null; linkMissing = false; renderFeed(); }
      return;
    }
    var key = m[1];
    var post = PodiumStore.postById(state, key);
    var suffix = null;
    if (!post) {
      var cm = /^([A-Za-z])-(\d+)(?:-(A|U\d+))?$/.exec(key);
      if (cm) {
        var base = cm[1].toUpperCase() + "-" + (cm[2].length > 4 ? cm[2] : ("0000" + cm[2]).slice(-4));
        post = PodiumStore.postByRef(state, base);
        if (post && cm[3]) suffix = cm[3].toUpperCase();
        if (suffix === "U0") suffix = null; /* updates start at U1 */
      }
    }
    if (post) {
      linkedPostId = post.id;
      linkedSuffix = suffix;
      linkMissing = false;
      showView("feed");
      renderFeed();
    } else {
      linkedPostId = null;
      linkedSuffix = null;
      linkMissing = true;
      showView("feed");
      renderFeed();
    }
  }
  window.addEventListener("hashchange", handleDeepLink);

  /* ---------- watch live ---------- */
  var watchOverride = null; /* null = clock; "upcoming" | "live" | "replay" */
  var watchSticky = null; /* bar/tick marker for a library replay in flight */
  var watchShownState = null; /* state currently rendered, for clock transitions */
  var watchRAF = null;
  var liveCtx = null, liveGain = null, liveAnalyser = null;
  var LIVE_START_H = 13, LIVE_LEN_MIN = 30; /* Wed 1:00-1:30 PM ET */

  function etParts(when) {
    var parts = {};
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York",
      weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
      month: "short", day: "numeric" })
      .formatToParts(when || new Date()).forEach(function (x) { parts[x.type] = x.value; });
    parts.hourNum = parseInt(parts.hour, 10) % 24;
    parts.minuteNum = parseInt(parts.minute, 10);
    return parts;
  }
  function clockIsLive(now) {
    var p = etParts(now);
    return p.weekday === "Wed" && p.hourNum === LIVE_START_H && p.minuteNum < LIVE_LEN_MIN;
  }
  function nextAiring() {
    var now = new Date();
    if (clockIsLive(now)) return { live: true, label: null };
    for (var i = 0; i < 8; i++) {
      var d = new Date(now.getTime() + i * 86400000);
      var p = etParts(d);
      if (p.weekday !== "Wed") continue;
      if (i === 0 && (p.hourNum > LIVE_START_H || (p.hourNum === LIVE_START_H && p.minuteNum >= LIVE_LEN_MIN))) continue;
      return { live: false, label: "Wednesday, " + p.month + " " + p.day };
    }
    /* Always returns: any 8 consecutive days contain a Wednesday, so the
       loop meets one by i === 7 at the latest and returns there. */
  }
  /* Watch agenda from datetimes, never frozen seed flags (TY, Oct 28):
     the briefing on air now is the latest briefing datetime at or before
     now (live window only, and only when that briefing is today); otherwise
     the bill is the next briefing datetime after now. Null when no future
     briefing exists — the view then says the agenda is to be announced.
     Seed statuses are ignored (kept in seed/saves only for compatibility). */
  function sameEtDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function agendaCycle() {
    var nowEt = etNow();
    var past = null, future = null;
    state.cycles.forEach(function (c) {
      var bAt = cycleDateTimeFor(c, c.briefingAt);
      if (!bAt) return;
      if (bAt <= nowEt) past = c; /* chronological: last aired-or-airing wins */
      else if (!future) future = c; /* chronological: first upcoming wins */
    });
    if (clockIsLive()) {
      if (!past) return null;
      var pAt = cycleDateTimeFor(past, past.briefingAt);
      return (pAt && sameEtDay(pAt, nowEt)) ? past : null;
    }
    return future;
  }
  function watchState() {
    if (watchOverride) return watchOverride;
    return clockIsLive() ? "live" : "upcoming";
  }
  function fullRecordButton(postId, label) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-small";
    b.textContent = label || "See full record";
    b.addEventListener("click", function () {
      threadSelect($("priorSelect"), renderPriorCard).value = postId;
      showView("prior");
    });
    return b;
  }

  function renderWatch() {
    stopWatchPlayback();
    watchSticky = null;
    var st = watchState();
    watchShownState = st;
    var main = $("watchMain");
    main.innerHTML = "";
    main.hidden = (st === "replay");
    if (st === "upcoming") renderUpcoming(main);
    else if (st === "live") { renderLive(main, null); attemptLiveAudio(); }
    renderLibrary();
    markDemoBar();
  }
  function renderUpcoming(main) {
    var nx = nextAiring();
    var h = document.createElement("h3");
    h.textContent = nx.live ? "The briefing is on air now" : "Next briefing: " + nx.label + ", 1:00 PM ET";
    main.appendChild(h);
    var cyc = agendaCycle();
    if (!cyc) {
      var none = document.createElement("p");
      none.textContent = "Agenda to be announced after the next draw.";
      main.appendChild(none);
    } else if (!PodiumStore.itemsForCycle(state, cyc.id).length) {
      /* Agenda known but nothing drawn yet (the static seed never draws
         future cycles): name the wait instead of an empty bill. The draw
         sentence appears only while the stored draw datetime is still in
         the future, so the note stays true after the date passes too. */
      var pend = document.createElement("p");
      var txt = "Selections for this briefing have not been drawn yet.";
      if (cyc.drawAt) {
        var dAt = cycleDateTimeFor(cyc, cyc.drawAt);
        if (dAt && dAt > etNow()) txt += " Draw: " + cyc.drawAt + ".";
      }
      pend.textContent = txt;
      main.appendChild(pend);
    } else {
      var sub = document.createElement("p");
      sub.textContent = "On the air bill (" + cycleLabel(cyc) + " selections):";
      main.appendChild(sub);
      var ul = document.createElement("ul");
      ul.className = "watch-library";
      PodiumStore.itemsForCycle(state, cyc.id).forEach(function (item) {
        var p = PodiumStore.postById(state, item.postId);
        var author = PodiumStore.citizenById(state, p.authorId);
        var li = document.createElement("li");
        li.className = "card";
        li.innerHTML = "<p>" + selectionBadge(cyc, item, p) + "</p>" +
          '<p><span class="ref-code">' + esc(p.ref || "") + "</span> <strong>" + esc(author.name) + "</strong> \u00b7 " + esc(p.topic) + "</p>";
        li.appendChild(fullRecordButton(p.id, "Full record: " + (p.ref || "")));
        ul.appendChild(li);
      });
      main.appendChild(ul);
    }
    var note = document.createElement("p");
    note.className = "hint";
    note.textContent = "For a live stream or a pre-recorded screening, whichever is next. If you are on this tab when the briefing airs, the stream starts automatically.";
    main.appendChild(note);
  }
  function liveItems(cyc) {
    return cyc ? PodiumStore.itemsForCycle(state, cyc.id) : [];
  }
  /* Real replay video (TY, Oct 28): only cycles carrying replaySrc (Week of
     Oct 5) play a real presenter video instead of the simulated slate. */
  function replayBar(live) {
    var bar = document.createElement("div");
    bar.className = "player-bar";
    var badge = document.createElement("span");
    badge.className = "live-badge";
    badge.textContent = live ? "LIVE" : "REPLAY";
    bar.appendChild(badge);
    return bar;
  }
  function renderSlateReplay(player, live, title) {
    var cv = document.createElement("canvas");
    cv.width = 640;
    cv.height = 300;
    cv.setAttribute("aria-label", live ? "Live broadcast picture (demo simulation)" : "Replay picture (demo simulation)");
    cv.setAttribute("role", "img");
    cv.textContent = "Demo simulation of the weekly briefing broadcast. No real stream.";
    player.appendChild(cv);
    var bar = replayBar(live);
    var unmute = document.createElement("button");
    unmute.type = "button";
    unmute.className = "btn btn-small unmute-btn";
    unmute.id = "watchUnmute";
    unmute.hidden = true;
    unmute.textContent = "Tap to unmute \u2014 join with sound";
    unmute.addEventListener("click", function () { attemptLiveAudio(); });
    bar.appendChild(unmute);
    var snd = document.createElement("span");
    snd.id = "watchSoundNote";
    snd.style.color = "#fff";
    bar.appendChild(snd);
    player.appendChild(bar);
    startSlate(cv, live, title);
  }
  function renderVideoReplay(player, rc) {
    var v = document.createElement("video");
    v.setAttribute("controls", "");
    v.preload = "metadata";
    v.src = rc.replaySrc;
    v.addEventListener("error", function () {
      if (v.dataset.stopped || !v.parentNode) return;
      /* Fallback: file missing or unloadable — the existing simulated
         slate for the same cycle, so the tab never breaks or blanks. */
      player.innerHTML = "";
      renderSlateReplay(player, false, "Replay \u2014 " + cycleLabel(rc));
    });
    player.appendChild(v);
    player.appendChild(replayBar(false));
    return v;
  }
  function renderLive(main, replayId) {
    var items, title, live;
    var rc = replayId ? PodiumStore.cycleById(state, replayId) : null;
    if (replayId) {
      items = liveItems(rc);
      title = "Replay \u2014 " + cycleLabel(rc);
      live = false;
    } else {
      items = liveItems(agendaCycle());
      title = "Live \u2014 This Week\u2019s Briefing";
      live = true;
    }
    var player = document.createElement("div");
    player.className = "player";
    var videoEl = null;
    if (!live && rc && rc.replaySrc) {
      videoEl = renderVideoReplay(player, rc);
    } else {
      renderSlateReplay(player, live, title);
    }
    main.appendChild(player);
    main.appendChild(buildNowReading(live, items));
    if (videoEl) {
      /* The open click is a user gesture: try to play; if the browser
         blocks it, controls remain so the user can press play manually. */
      try {
        var pr = videoEl.play();
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) {}
    }
  }
  /* One screening entry: selection badge, the Citizen Post block, the
     Committee Answer block (omitted when the item has no answer text),
     and that post's Full record button. Same blocks the single-item view
     used; the replay loop below just stacks one per item. */
  function screeningEntry(item) {
    var frag = document.createDocumentFragment();
    var p = PodiumStore.postById(state, item.postId);
    if (!p) return frag;
    var badge = document.createElement("p");
    badge.innerHTML = selectionBadge(PodiumStore.cycleById(state, p.cycleId), item, p);
    frag.appendChild(badge);
    var z = document.createElement("div");
    z.className = "zone zone-post";
    z.innerHTML = '<span class="zone-label">Citizen Post \u2014 verbatim</span>' +
      '<p><span class="ref-code">' + esc(p.ref || "") + "</span></p>" +
      "<blockquote>" + esc(p.body) + "</blockquote>";
    frag.appendChild(z);
    if (item.answer) {
      var za = document.createElement("div");
      za.className = "zone zone-answer";
      za.innerHTML = '<span class="zone-label">Committee Answer \u2014 verbatim</span>' +
        '<p><span class="ref-code">' + esc(answerCode(p)) + "</span></p>" +
        "<blockquote>" + esc(displayAnswer(item.answer)) + "</blockquote>";
      frag.appendChild(za);
    }
    frag.appendChild(fullRecordButton(p.id, "Full record: " + (p.ref || "")));
    return frag;
  }
  function buildNowReading(live, items) {
    var nr = document.createElement("div");
    nr.className = "now-reading";
    nr.id = "nowReading";
    if (!live) {
      /* Replay "Screening" view: the FULL record — every item in order
         (top-voted first), each with its badge, post block, answer block,
         and Full record button. A replay is a record, not a timed
         broadcast, so stacking needs no new state or controls. The live
         "Now reading" path below is untouched. Shared by the video and
         slate replay paths. */
      nr.setAttribute("data-idx", 0);
      var h = document.createElement("h3");
      h.textContent = "Screening";
      nr.appendChild(h);
      items.forEach(function (item) { nr.appendChild(screeningEntry(item)); });
      if (!items.length) nr.appendChild(document.createTextNode("Agenda to be announced."));
      return nr;
    }
    var idx = (items.length > 1 && etParts().minuteNum >= 15) ? 1 : 0;
    nr.setAttribute("data-idx", idx);
    var first = items[idx] ? PodiumStore.postById(state, items[idx].postId) : null;
    if (!first) {
      nr.textContent = "Agenda to be announced.";
      return nr;
    }
    var hl = document.createElement("h3");
    hl.textContent = "Now reading (" + (idx + 1) + " of " + items.length + ")";
    nr.appendChild(hl);
    var z = document.createElement("div");
    z.className = "zone zone-post";
    z.innerHTML = '<span class="zone-label">Citizen Post \u2014 verbatim</span>' +
      '<p><span class="ref-code">' + esc(first.ref || "") + "</span></p>" +
      "<blockquote>" + esc(first.body) + "</blockquote>";
    nr.appendChild(z);
    nr.appendChild(fullRecordButton(first.id, "Full record: " + (first.ref || "")));
    return nr;
  }
  function refreshNowReading(nrEl) {
    var items = liveItems(agendaCycle());
    var want = (items.length > 1 && etParts().minuteNum >= 15) ? 1 : 0;
    if (Number(nrEl.getAttribute("data-idx")) === want) return;
    nrEl.parentNode.replaceChild(buildNowReading(true, items), nrEl);
  }
  /* Replay timing (TY, Oct 28): the Replay library flips exactly like This
     Week — a cycle appears only once its briefing datetime has passed
     (newest briefing first), so the upcoming briefing never shows early.
     A briefed cycle with no replay video attached shows an honest
     "Replay processing, available soon" placeholder instead of silence
     and never an old replay mislabeled as the new one. The player itself
     stays the demo-only simulated slate. */
  var REPLAY_PROCESSING_TEXT = "Replay processing, available soon";
  function replayPlaceholder(c) {
    var p = document.createElement("p");
    p.className = "hint";
    p.textContent = REPLAY_PROCESSING_TEXT + " \u2014 " + cycleLabel(c) + " aired " + c.briefingAt + ".";
    return p;
  }
  function stopReplayButton(main) {
    var stop = document.createElement("button");
    stop.type = "button";
    stop.className = "btn btn-small";
    stop.textContent = "Stop replay";
    stop.addEventListener("click", function () { renderWatch(); window.scrollTo(0, 0); });
    main.appendChild(stop);
  }
  function renderLibrary() {
    var ul = $("watchLibrary");
    ul.innerHTML = "";
    var past = PodiumStore.replayCycles(state, etNow());
    if (!past.length) {
      var li0 = document.createElement("li");
      li0.textContent = "No past briefings yet.";
      ul.appendChild(li0);
      return;
    }
    past.forEach(function (c) {
      var li = document.createElement("li");
      li.className = "card";
      var names = PodiumStore.itemsForCycle(state, c.id).map(function (b) {
        var p = PodiumStore.postById(state, b.postId);
        return (b.selection === "top" ? "Top-voted" : "Random draw") + " " + (p.ref || "");
      }).join("; ");
      li.innerHTML = "<p><strong>" + esc(cycleLabel(c)) + "</strong> \u00b7 aired " + esc(c.briefingAt) + "</p>" +
        '<p class="hint">' + esc(names) + "</p>";
      if (!PodiumStore.replayReady(c)) {
        li.appendChild(replayPlaceholder(c));
      } else {
        var play = document.createElement("button");
        play.type = "button";
        play.className = "btn btn-small";
        play.textContent = c.replaySrc ? "Play video" : "Play this screening";
        play.addEventListener("click", function () { playReplay(c.id); });
        li.appendChild(play);
      }
      ul.appendChild(li);
    });
  }
  function playReplay(cycleId) {
    stopWatchPlayback();
    watchSticky = "replay";
    var main = $("watchMain");
    main.hidden = false;
    main.innerHTML = "";
    markDemoBar();
    var cyc = PodiumStore.cycleById(state, cycleId);
    if (cyc && !PodiumStore.replayReady(cyc)) {
      main.appendChild(replayPlaceholder(cyc));
      stopReplayButton(main);
      window.scrollTo(0, 0);
      return;
    }
    renderLive(main, cycleId);
    stopReplayButton(main);
    /* Real-video replays carry their own audio: never start the slate drone. */
    if (!(cyc && cyc.replaySrc)) attemptLiveAudio(); /* click is a gesture: sound starts directly */
    window.scrollTo(0, 0);
  }

  /* --- production-faithful sound policy: real AudioContext state, real
     autoplay blocking. Only the program content is simulated. --- */
  function ensureLiveAudio() {
    if (liveCtx) return liveCtx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    liveCtx = new AC();
    liveGain = liveCtx.createGain();
    liveGain.gain.value = 0.0;
    liveAnalyser = liveCtx.createAnalyser();
    liveAnalyser.fftSize = 64;
    var o1 = liveCtx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = 220;
    var o2 = liveCtx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = 277.18;
    var g2 = liveCtx.createGain();
    g2.gain.value = 0.4;
    o1.connect(liveGain);
    o2.connect(g2);
    g2.connect(liveGain);
    liveGain.connect(liveAnalyser);
    liveAnalyser.connect(liveCtx.destination);
    o1.start();
    o2.start();
    return liveCtx;
  }
  function setUnmuteUI(mode) {
    var b = $("watchUnmute"), n = $("watchSoundNote");
    if (!b || !n) return;
    if (mode === "live") { b.hidden = true; n.textContent = "Live with sound."; }
    else if (mode === "blocked") { b.hidden = false; n.textContent = "Sound blocked by the browser: picture is live, audio is muted."; }
    else if (mode === "unavailable") { b.hidden = true; n.textContent = "Audio unavailable in this browser."; }
    else { b.hidden = true; n.textContent = "Starting\u2026"; }
  }
  function attemptLiveAudio() {
    var ctx = ensureLiveAudio();
    setUnmuteUI("trying");
    if (!ctx) { setUnmuteUI("unavailable"); return; }
    ctx.resume().then(function () {
      if (ctx.state === "running") { liveGain.gain.value = 0.03; setUnmuteUI("live"); }
      else { liveGain.gain.value = 0.0; setUnmuteUI("blocked"); }
    }).catch(function () { setUnmuteUI("blocked"); });
  }
  function stopWatchPlayback() {
    if (watchRAF) { cancelAnimationFrame(watchRAF); watchRAF = null; }
    var wm = $("watchMain");
    if (wm) {
      Array.prototype.forEach.call(wm.querySelectorAll("video"), function (v) {
        try { v.dataset.stopped = "1"; v.pause(); v.removeAttribute("src"); } catch (e) {}
      });
    }
    try {
      if (liveGain) liveGain.gain.value = 0.0;
      if (liveCtx && liveCtx.state === "running") liveCtx.suspend();
    } catch (e) {}
  }
  function liveLevel() {
    if (!liveAnalyser || !liveCtx || liveCtx.state !== "running") return 0;
    var a = new Uint8Array(liveAnalyser.frequencyBinCount);
    liveAnalyser.getByteFrequencyData(a);
    var sum = 0, i;
    for (i = 0; i < a.length; i++) sum += a[i];
    return Math.min(1, (sum / a.length / 255) * 3);
  }
  function startSlate(cv, live, title) {
    if (watchRAF) { cancelAnimationFrame(watchRAF); watchRAF = null; }
    if (!cv.getContext) return;
    var g = cv.getContext("2d");
    function frame() {
      var W = cv.width, H = cv.height;
      g.fillStyle = "#0b1d33";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#fdb81e";
      g.fillRect(0, 0, W, 8);
      g.fillStyle = live ? "#e31c3d" : "#3e94cf";
      g.font = "bold 34px Georgia, serif";
      g.fillText(live ? "\u25cf LIVE" : "REPLAY", 28, 64);
      g.fillStyle = "#ffffff";
      g.font = "28px Georgia, serif";
      g.fillText("THE PODIUM", 28, 110);
      g.fillStyle = "#d7dee8";
      g.font = "20px Georgia, serif";
      g.fillText(String(title).slice(0, 42), 28, 145);
      var t = new Date();
      var et = etParts(t);
      g.fillStyle = "#ffffff";
      g.font = "22px monospace";
      g.fillText(et.hour + ":" + et.minute + ":" + ("0" + t.getSeconds()).slice(-2) + " ET", 28, 185);
      var level = liveLevel();
      g.fillStyle = "#1d2f45";
      g.fillRect(28, 210, 300, 26);
      g.fillStyle = level > 0 ? "#2e8540" : "#5b616b";
      g.fillRect(28, 210, Math.max(2, 300 * level), 26);
      g.fillStyle = "#9aa3ad";
      g.font = "16px sans-serif";
      g.fillText("DEMO SIMULATION \u2014 no real stream", 28, 268);
      watchRAF = requestAnimationFrame(frame);
    }
    frame();
  }

  function markDemoBar() {
    document.querySelectorAll("#watchDemoBar [data-watch-state]").forEach(function (b) {
      var on = b.getAttribute("data-watch-state") === (watchOverride || watchSticky || "auto");
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function tickWatch() {
    var live = clockIsLive();
    var badge = $("watchTabLive");
    if (badge) badge.hidden = !live;
    var tab = document.querySelector('.main-nav .tab[data-view="watch"]');
    if (tab) tab.setAttribute("aria-label", live ? "Watch Live, briefing on air now" : "Watch Live");
    if (currentView !== "watch" || watchOverride || watchSticky) return;
    var desired = live ? "live" : "upcoming";
    if (watchShownState && watchShownState !== desired) { renderWatch(); return; }
    if (live) {
      var main = $("watchMain");
      if (main && !main.querySelector(".player")) { renderWatch(); return; }
      var nrEl = $("nowReading");
      if (nrEl) refreshNowReading(nrEl);
    }
  }

  $("gotoWatchBtn").addEventListener("click", function () { showView("watch"); });
  $("backToBriefingBtn").addEventListener("click", function () { showView("briefing"); });
  document.querySelectorAll("#watchDemoBar [data-watch-state]").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-watch-state");
      watchOverride = (v === "auto") ? null : v;
      renderWatch();
      window.scrollTo(0, 0);
    });
  });
  tickWatch();
  setInterval(tickWatch, 20000);

  /* Indicator stability (TY, Oct 28): overlapping live checks can flip the
     reported mode back and forth while typing. Display only: hold the last
     shown state until a new state persists — a change applies after it
     survives one quiet window, and a flip back inside the window cancels
     silently. Which engine runs, the fallback rule, and gate results are
     untouched; the settled display always matches the last settled check. */
  var aiModeShown = null; /* "live" | "stub" | null (not yet shown) */
  var aiModeTimer = null;
  var AI_MODE_QUIET_MS = 1000;
  function showAiMode(want) {
    aiModeShown = want;
    var el = $("aiMode");
    el.textContent = want === "live" ? "AI: live (Muse Spark)" : "AI: local fallback";
    el.classList.toggle("is-live", want === "live");
  }
  function renderAiMode() {
    var want = PodiumAI.isLive() ? "live" : "stub";
    if (aiModeShown === null) { showAiMode(want); return; }
    if (want === aiModeShown) {
      if (aiModeTimer) { clearTimeout(aiModeTimer); aiModeTimer = null; }
      return;
    }
    if (aiModeTimer) clearTimeout(aiModeTimer);
    aiModeTimer = setTimeout(function () {
      aiModeTimer = null;
      showAiMode(PodiumAI.isLive() ? "live" : "stub");
    }, AI_MODE_QUIET_MS);
  }
  function wireKeyUi() {
    $("apiKeySave").addEventListener("click", function () {
      PodiumAI.setKey($("apiKeyInput").value.trim());
      $("apiKeyInput").value = "";
      liveGateCache = null;
      liveClarityCache = null;
      renderAiMode();
    });
    $("apiKeyClear").addEventListener("click", function () {
      PodiumAI.clearKey();
      $("apiKeyInput").value = "";
      liveGateCache = null;
      liveClarityCache = null;
      renderAiMode();
    });
    PodiumAI.onModeChange = renderAiMode;
  }

  /* ---------- cross-tab sync ---------- */
  /* Another tab's save wins, as whole-state saves always have; this only
     makes it timely. The current view refreshes in place; a draft being
     actively typed here is never overwritten. */
  window.addEventListener("storage", function (e) {
    if (e.key === "podium.v1") {
      state = PodiumStore.load(etNow());
      renderCitizen();
      updateOnePostNotice();
      if (currentView === "feed" && !linkedPostId && !linkMissing && !isCodeSearch()) {
        /* Another tab saved: refresh counts in place on the frozen list.
           Never auto-inject new posts into a view being read. */
        feedFreeze = true;
        renderFeed();
      } else if (currentView === "feed") renderFeed();
      else if (currentView === "briefing") renderBriefing();
      else if (currentView === "prior") renderPrior();
      else if (currentView === "status") renderStatus();
      else if (currentView === "watch") {
        /* A replay in flight (slate or video) stays put: never yank what
           is playing. Library / Upcoming / Live states re-render with the
           fresh state. */
        var vw = $("watchMain");
        var vv = vw && vw.querySelector("video");
        if (!watchSticky && !(vv && !vv.paused)) renderWatch();
      }
      else if (currentView === "post") renderComposerGate();
    } else if (e.key === DRAFT_KEY && document.activeElement !== composerText) {
      restoreDraft();
      renderComposerGate();
    }
  });

  /* ---------- init ---------- */
  renderCitizen();
  updateOnePostNotice();
  restoreDraft();
  renderComposerGate();
  wireHearUi();
  wireKeyUi();
  renderAiMode();
  restoreFeedState(); /* sort + topic + clamped page ride along when the feed is restored */
  /* Restore the saved tab synchronously during initial render (no flash of
     feed). A #post/... deep link governs instead and the saved tab is
     ignored for that load; with no saved tab, boot to Live Feed. The
     load-time scroll-to-top runs after this, so a reload settles at the
     top of the restored tab. */
  (function () {
    var start = savedView();
    if (/^#post\//.test(window.location.hash || "")) start = null;
    if (start && start !== "feed") showView(start);
    else renderFeed();
  })();
  handleDeepLink();
})();


