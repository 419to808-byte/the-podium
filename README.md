# THE PODIUM — a civic portal (hackathon v1)

Verified citizens post ideas and concerns. The community votes (upvote-only).
Each week the top-voted post plus one randomly drawn post are read aloud
**verbatim** and addressed in a public briefing, with follow-up tracking until
resolved.

## Run it (no install, no build, no network)

Open the file directly — double-click it or paste the path into a browser:

```
podium/index.html
```

Works from `file://` and from any static host. Demo data is seeded in-app;
your votes and posts persist in the browser's localStorage.

To serve over HTTP (any one of these, from the `podium/` folder):

```
npx serve .
python -m http.server 8080
php -S localhost:8080
```

then open the printed URL.

To reset the demo: clear the site's localStorage (or run
`localStorage.removeItem("podium.v1")` in devtools) and reload.

## Deploy

This is a dependency-free static folder. Publish it as-is to GitHub Pages,
Netlify Drop, Cloudflare Pages, Vercel static, or any web server.

## Demo spine (under 5 minutes)

1. **Rule** — top of the home page: the Verbatim Rule + fine print.
2. **Gate catch** — Post tab: type a draft with slang (`gonna`, `btw`) or a
   misspelling (`goverment`) → held with suggestions; try profanity → hard
   block with a clear error.
3. **Already Voiced** — type a full sentence about drug prices or class sizes,
   then stop typing → one muted advisory box appears (never "duplicate",
   never a block); three exits.
4. **Preview** — "Hear it as the nation will" shows exact words as briefed,
   plus a single review-time topic suggestion you may accept or ignore.
5. **Vote** — Feed → Top Voted → Sign in (pick any demo citizen; no sign-in,
   no vote) → upvote (this week's posts only; no downvote).
6. **Share** — every post card has Share: native share sheet on mobile,
   otherwise the post's link is copied (`index.html#post/<id>`). Opening a
   shared link lands on that post, highlighted, with the upvote visible.
7. **Briefing** — condensed: two This Week summary cards (verbatim excerpt,
   "Read verbatim in full" expansion, "See full record" link); Next Week
   shows the FULL verbatim text of each in-committee post with
   answer-coming dates (never answers; published post-briefing, not
   before it); read-only draw record (pool record + excluded-posts audit
   with reasons + worked example: pool 12, beacon …4839 → post #4).
8. **Prior Posts & Answers** — archive: each selection's verbatim post plus
   the committee's answer, with a cross-link to its status updates.
9. **Status Updates** — follow-through: dated progress updates plus current
   status per item, with a cross-link back to its post and answer.
10. **Codes** — every post carries a permanent reference code (letter = topic
   at posting, platform-wide number, e.g. A-0147); answers add `-A`,
   updates `-U1`, `-U2`. Search a full code to jump to that item, a base
   code for the whole thread, or open `index.html#post/A-0147` directly.
11. **Watch Live** — broadcast tab: Upcoming agenda with the next airing,
   Live player with now-reading during the Wed 1:00 PM window (demo
   switcher previews any state), replay screenings on demand.

## Structure

```
index.html        app shell (feed, composer, briefing, prior answers,
                  status updates, watch live, modals)
css/style.css     mobile-first styles, no framework
js/seed.js        deterministic demo data (115 citizens, 5 cycles, 217 posts:
                  6 retained selections + 3 demo copies + 8 current-cycle
                  seed posts + 200 generated scale posts, 6 briefing
                  items, exact draw math)
js/ai-adapter.js  ALL model calls go through PodiumAI (local fallback plus
                  live Muse Spark via Meta Model API when a key is set)
js/store.js       localStorage persistence + queries (votes,
                  one-post-per-cycle, closed-cycle cleanup)
js/app.js         UI wiring
```

## Weekly cycle (locked schedule, all times ET)

Posting/voting week Mon 00:00 → Sun 23:59. Cutoff Sun 23:59 (pool frozen
and published; unselected posts are removed, selections are kept) →
draw Mon 12:00, pre-announced (NIST beacon pulse;
`position = beacon mod pool + 1`) → committee week Mon → Sun (answers
ONLY; never alters, substitutes, delays, or declines; Mon–Tue of
briefing week are finalization buffer) → briefing Wed 1:00 PM. The
Podium segment is the fixed opening segment of the Wednesday briefing;
if no regular briefing is scheduled that Wednesday, the segment still
runs standalone at the same time, same room, same cameras.

## Notes for judges

- Sign-in is **simulated**; no real personal data is collected, requested,
  or stored anywhere. AI wording checks run locally; with a key pasted in
  the footer they also call Muse Spark directly, and fail silent to
  local. The indicator in the composer shows which mode is live.
- Posting and upvoting require sign-in (pick any demo citizen).
  No sign-in, no vote.
- Committee answers are seeded sample responses. On a Next Week post on
  the briefing tab, "Draft answer with Wonder" drafts a replacement with
  Muse Wonder (`muse-wonder-1.0`, same footer key, 30s timeout) for
  committee review; it displays separately as pending review and only
  replaces the displayed answer after "Approve draft" (demo approval;
  the seeded record is preserved and remains the fallback). Prior Posts
  & Answers is the read-only permanent record. Wonder
  drafts answers only — never citizen posts — and never falls back to
  Spark.
- Posts are final: no edit, no redact, no comments in v1.
- Automated suites, run from the committed runner (27 replay-timing cases incl. Watch-agenda rollover, Prior/Status refill, and Replay-screening stacking, + 35 gate cases: 27 fallback + 8 live-stubbed, all against the real adapter): open `tests/run-tests.html` in a browser (file:// or the hosted site, no build) and read the combined pass/total at the top. Headless: `msedge --headless --dump-dom file:///…/podium/tests/run-tests.html` and read the `RUNNER-DONE ok=… fail=…` title plus the `CASE-OK`/`CASE-FAIL` lines.
- Tracker statuses: Answered → Action Promised → In Progress → Resolved,
  plus No Action with an official reason.

