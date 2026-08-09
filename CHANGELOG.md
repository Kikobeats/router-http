# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## 3.0.0 (2026-08-09)


### ⚠ BREAKING CHANGES

* route handlers no longer see the mount prefix stripped from
req.url and req.path. Only middleware registered with .use(path, fn) runs on
the stripped view; by the time a route handler runs, the frame is undone and
it sees the full request. Read the prefix from req.baseUrl instead.

Also breaking: every mount whose prefix matches now runs, in registration
order, rather than only the longest one.

Recorded as a footer because the subject that carried the `!` marker was
reworded during a rebase, and without this standard-version cuts 2.0.11 for a
change that breaks anyone reading req.path in a route handler.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* refactor: drop the defaultRoute that can never fire

find-my-way only reaches defaultRoute through lookup(), and this router never
calls it — find() is used directly and an unmatched path is handled where the
match is read. So the closure was allocated per router for nothing, and it
silently overrode a user-supplied options.defaultRoute, which was equally dead.

Also: mountCount was true exactly when lastMount was null; `cursor = 0` on the
abort path is not read once limit is 0; req.params was guarded as `!== undefined`
in one branch and `|| {}` three lines later; and the test-side `notFound`
handler was `final` minus a 500 path its three callers never reach — using
`final` there also turns an unexpected error into a visible failure rather than
a silent hang.

`trimTrailingSlashes` collided with the `trimTrailingSlash` option binding nine
lines below it; it is the whole mount-path shape, not just the trim.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* test: send the compat requests with got, like every other test does

express-compat hand-rolled http.get into a string through a 9-line promise
while got was already a devDependency doing exactly that in index.js. Two ways
to make an HTTP GET in one suite, for no difference in what is asserted.

Also folds the encoded-mount guard into the plain one — same options, same
mount, same route, and the helper already loops over request spellings — and
writes down why the frame-state initializers are there, which until now only
existed in review conversation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* docs: warn that a percent-encoded mount matches nothing

The README documented one direction of the encoding divergence — a decoded
mount matching an encoded request — and left the mirror unsaid. Register a
mount as '/caf%C3%A9' and it never runs, for any request, because the path it
is compared against has already been decoded. That is the same silently-skipped
auth mount this PR exists to prevent, so it belongs next to the case it is the
inverse of.

Verified: neither /café/secret nor /caf%C3%A9/secret runs such a mount.
test/mount-invariant.js already pinned the behaviour; only the docs were quiet.

Also shares the got client and the layer tracker through test/_helpers.js
rather than keeping a second copy of each in the compat suite, drops an
assertion `message` argument that was always its `path` argument, and renders
errors in the compat final handler instead of handing them on — a case that
threw used to match express's 'DONE' by accident.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* test: share the server helper and drop four subsumed tests

runServer joins got and createTracker in _helpers; the compat suite was
hand-rolling createServer + listen + close for the same job.

The four removed tests each have a named superset still in the file:
- middleware-before-routes ordering, by the test that runs both orderings
- last middleware ends response, by every route test in the file
- req.params without a route match, by the no-match test that asserts the
  value rather than its truthiness
- exposes find-my-way methods, by the prettyPrint test, which now also carries
  the Array.isArray assertion so nothing is lost

Checked rather than assumed: line, statement, branch and function coverage are
identical before and after, at 99.23 / 98.39 / 96.15.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* docs: keep the layer-sharing rationale on the variable that carries it

The measured version already sits on `lastMount`; registerMount restated the
weaker half without the numbers. The correctness clause stays — that
consecutive registrations have nothing in between to jump ahead of is what
licenses the globalsBefore term in the guard, and it is stated nowhere else.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* docs: cut the design rationale back out of the reference

Every review round that found a wrong README claim got answered by adding a
paragraph, and the two sections this PR touched grew into an explanation of how
the router works rather than what it does: Mounted middleware 45 lines, Express
compatibility 34, most of it prose a user does not need to read to call
`.use()`.

Both are now half that. What went: an eight-bullet list restating the section
above it, the frame mechanics that the two examples already show, and the
match-once discussion, which is a divergence and belongs with the other one
rather than interrupting the mount description. What stayed: every contract a
caller can observe, both deliberate differences from Express, and the encoded
mount footgun.

The request-object notes were reordered so the two `req.path` paragraphs sit
together instead of being split by the onBadUrl warning.

All seven examples in the rewritten sections were executed against the code.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* fix: keep req.path describing req.url after a middleware rewrites it

req.path was derived once, at handler entry. Frame entry then measured the
mount prefix against the *current* req.url and sliced the *entry-derived*
req.path by that index — an offset from one string applied to another:

  use(req => { req.url = '/x' })
  use('/admin/panel', mw)
  GET /admin/panel/y   ->   mw saw url="/" path="dmin/panel/y"

A path with no leading slash. With no mount involved the pair simply
disagreed: url="/other?z=9" path="/admin/x".

Reusing the url offset for the path is the round-6 optimization and it is
sound only while req.path is req.url's path half, so the fix restores that
premise instead of dropping the shortcut: track which url req.path came from
and re-derive when they diverge. One string comparison per layer — a pointer
compare unless a rewrite actually happened. Costs 1-2% on dispatch.

leaveFrame already did this on the way out, re-parsing rather than restoring
its snapshot when a middleware rewrote the url inside the frame. Entry never
got the same treatment; the two ends are now symmetric.

This is the invariant the PR already states for req.query/req.search — two
shapes of one thing must never describe different requests — extended to the
pair that escaped it. For reference, pillarjs/router has no req.path at all,
and Express derives it lazily through parseurl, so neither can go stale.

The mount-invariant sweep varied only the request target, which is why 4536
combinations missed this; it now varies what a middleware does to req.url as
well. That axis also covers `return length` in getSegmentEnd, until now the
one reachable-but-uncovered line in the walker: coverage 99.23 -> 99.62%.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* chore(benchmark): make the numbers reproducible, then re-measure them

benchmark/express.js and polka.js required packages that were not in
devDependencies, so `node benchmark/express.js` failed from a clean clone and
nobody could reproduce the figures the README pointed at. Both are dependencies
now, with `npm run benchmark` and `npm run benchmark:routes` to run them.

The route-count table had no source in the repo at all — it was four numbers
with nothing behind them. benchmark/routes.js regenerates it.

Re-measured on node v26.6.0. The HTTP result moved little (27% -> 29% ahead of
express) but the route-count table moved a lot, and in our favour: hitting the
last of 1000 routes, express manages ~23K ops/sec against our ~7.0M. Across
5..1000 routes express loses 113x of its throughput and we lose 1.2x.

run.sh interleaves its rounds and keeps each server's best rather than running
them back to back. That is not ceremony: a sequential single sample on a loaded
laptop reported polka at 70K when it had measured 102K minutes earlier, and
inverted the ranking. It also waits for port 3000 between servers, which the
first version did not, so a lingering server silently served the next run.
Conditions and load average are printed with the results.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* chore(benchmark): bind a free port and never leave a server running

The runner hardcoded 3000, which on any developer machine is whatever else is
already listening — here it was another project's dev server, and the run spent
its time timing out on a port it was never going to get. It now asks the kernel
for a free port and passes it through PORT, which the three servers honour.

And when a server fails to come up, measure returned without killing it. That
listener would fail the next round's free check or, worse, quietly answer its
load. Every exit now goes through the same stop.

Verified by replacing polka.js with a module that cannot resolve: the run
reports "polka did not start; skipping", measures the other two, and leaves no
node process behind.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* docs: drop the compatibility section and the upgrade note

Both were written for someone auditing the change, not someone using the
router. The pillarjs parity list restated behaviour the sections above already
document, and the 3.0.0 note is release history — the BREAKING CHANGE footer on
this branch puts it in the changelog, which is where an upgrader looks.

README is 377 lines at its peak, 303 now, against 292 on master.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* docs: drop the onBadUrl note

onBadUrl is a find-my-way option we pass through, and without it a malformed
url already reaches the finalHandler as a 404 — which is what a reader expects
and needs no documenting. The note was about the escape hatch, not the default.

The trap it described is real (find-my-way calls it as (path, req, res) with no
next, so a handler that does not end the response hangs the request) but it
only reaches someone who opted into the option, and it stays pinned by
`onBadUrl handler does not crash the request`.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

* docs: chain the router examples that were writing it out longhand

Four examples repeated `router.` per line while four others already chained,
so the README was showing two styles for one API without saying either was a
choice. Every method returns the router; now the examples look like it, and
Declaring routes says so once.

All 14 js blocks in the README were extracted and executed against the source
to check the restructuring did not break any.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GVKYNNskSmHriXVTNJBq5a

### Bug Fixes

* keep path middleware aligned with route normalization ([#36](https://github.com/Kikobeats/router-http/issues/36)) ([f581ef8](https://github.com/Kikobeats/router-http/commit/f581ef885f5e2348702d0bb41e1df9cc329ac1fb))

### 2.0.10 (2026-08-04)


### Bug Fixes

* match .use() mounts by decoded longest prefix ([#35](https://github.com/Kikobeats/router-http/issues/35)) ([6c95dfb](https://github.com/Kikobeats/router-http/commit/6c95dfbd5ef5efda58938e1371d6f174e2cec16e))

### 2.0.9 (2026-08-03)

### 2.0.8 (2026-07-21)

### 2.0.7 (2026-05-06)

### 2.0.6 (2026-04-14)


### Bug Fixes

* keep route on subrouter ([#25](https://github.com/Kikobeats/router-http/issues/25)) ([3e1cf3f](https://github.com/Kikobeats/router-http/commit/3e1cf3f3bbd68f3f7ba2a54f770544d185359802))

### 2.0.5 (2026-04-14)

### 2.0.4 (2026-03-17)

### 2.0.3 (2026-02-23)

### 2.0.2 (2026-01-05)

### 2.0.1 (2025-12-27)

## [2.0.0](https://github.com/Kikobeats/router-http/compare/v1.0.13...v2.0.0) (2025-12-27)


### Features

* use a trie based implementation ([#19](https://github.com/Kikobeats/router-http/issues/19)) ([1b7d4a1](https://github.com/Kikobeats/router-http/commit/1b7d4a1d90b90401c38dd7545b50fc8e6380503e)), closes [#12](https://github.com/Kikobeats/router-http/issues/12)

### 1.0.13 (2025-12-27)

### 1.0.12 (2025-11-30)

### 1.0.11 (2025-08-13)

### 1.0.10 (2024-09-29)


### Bug Fixes

* catch async errors ([c0de3cb](https://github.com/Kikobeats/router-http/commit/c0de3cbd8eb59926da82e134b232bda40a562778))

### 1.0.9 (2024-09-29)

### 1.0.8 (2024-05-07)

### 1.0.7 (2024-02-08)

### 1.0.6 (2024-02-08)

### 1.0.5 (2023-12-04)

### 1.0.4 (2023-10-23)

### 1.0.3 (2023-09-07)

### 1.0.2 (2023-04-22)

### 1.0.1 (2023-03-28)

## [1.0.0](https://github.com/Kikobeats/router-http/compare/v0.0.1...v1.0.0) (2023-02-25)

### 0.0.1 (2023-02-25)
