# Benchmarks

Two benchmarks, measuring different things.

## Over HTTP — `npm run benchmark`

Every server here runs the same app: two global middlewares that mutate `req`, an empty `GET /favicon.ico`, and a `GET /user/:id` returning `User: {id}`. They are loaded with `wrk -t8 -c100`, warmed for 5s first.

Rounds are interleaved rather than run back to back, and each server keeps its best. A single sequential sample lets whichever server happens to run during a load spike carry that handicap through its whole measurement — that alone was enough to invert the ranking on a busy laptop. Check the load average before trusting a run; the script prints it.

```sh
npm run benchmark          # 3 rounds of 30s
./benchmark/run.sh 10s 5   # or pick your own
```

Best of three 30s rounds, node v26.6.0, wrk 4.2.0, load average 5.7 on 12 cores:

| | Requests/sec |
|---|---|
| **router-http** | **110,983** |
| polka | 108,444 |
| express | 85,985 |

The three rounds agreed within 2.5% for express and 6% for router-http, so the ordering is stable even though the absolute numbers are depressed by the load.

## Dispatch vs route count — `npm run benchmark:routes`

In-process, no sockets: how dispatch scales as routes are registered. Requests hit the **last** route registered, the worst case for anything matching by iteration and no different from the first for a trie.

```sh
npm run benchmark:routes   # best of 5
node benchmark/routes.js 3
```

Best of five, node v26.6.0:

| Routes | `express@router` | `router-http` |
|--------|------------------|---------------|
| 5 | ~2.6M ops/sec | **~8.5M ops/sec** |
| 10 | ~2.1M ops/sec | **~8.5M ops/sec** |
| 50 | ~891K ops/sec | **~7.6M ops/sec** |
| 1000 | ~23K ops/sec | **~7.0M ops/sec** |

Express loses 113× of its throughput across that range; router-http loses 1.2×. That gap is the reason for the trie, and it is why the HTTP benchmark above — a four-route app — understates the difference for any real routing table.

## CI baseline — `node benchmark/index.js`

In-process, no sockets, no competitor libraries: the number tracked on every pull request by `.github/workflows/benchmark.yml`. Each case dispatches 1,000,000 requests through fake `req`/`res` objects, 7 runs, and reports the median wall time. Every response is checked, so a broken router fails the job instead of looking fast.

| Case | Request |
|---|---|
| static route | `GET /` |
| param route | `GET /user/123?x=1` |
| param route 2 middlewares | same, behind two global `.use()` middlewares |
| not found | `GET /missing/path`, answered by the final handler |
| control raw find-my-way | `find()` plus the handler call, no router-http |

The control case is the floor: `param route` minus `control raw find-my-way` is the cost router-http adds on top of find-my-way. The two benchmarks above stay out of CI, since one needs `wrk` and a bash 4 shell and both compare against other libraries.
