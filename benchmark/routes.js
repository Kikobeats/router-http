'use strict'

// How dispatch scales with the number of registered routes. This is the claim
// the README table makes, so it lives here rather than in a comment: a radix
// trie should be flat across route count where a regex list degrades.
//
//   node benchmark/routes.js [rounds]
//
// Requests always hit the LAST route registered, which is the worst case for
// anything matching by iteration and makes no difference to a trie.

const ExpressRouter = require('router')
const createRouter = require('..')

const ROUTE_COUNTS = [5, 10, 50, 1000]
const ROUNDS = Number(process.argv[2]) || 5
const ITERATIONS = 200_000

const noop = () => {}

const makeRes = () => ({
  writableEnded: false,
  statusCode: 200,
  end () {
    this.writableEnded = true
  }
})

const buildOurs = routeCount => {
  const router = createRouter(noop)
  for (let i = 0; i < routeCount; i++) {
    router.get(`/route${i}/:id`, (req, res) => res.end())
  }
  return router
}

const buildExpress = routeCount => {
  const router = ExpressRouter()
  for (let i = 0; i < routeCount; i++) {
    router.get(`/route${i}/:id`, (req, res) => res.end())
  }
  return (req, res) => router(req, res, noop)
}

const opsPerSecond = (dispatch, url) => {
  for (let i = 0; i < 20_000; i++) dispatch({ method: 'GET', url }, makeRes())
  const start = process.hrtime.bigint()
  for (let i = 0; i < ITERATIONS; i++) dispatch({ method: 'GET', url }, makeRes())
  const seconds = Number(process.hrtime.bigint() - start) / 1e9
  return ITERATIONS / seconds
}

const format = ops =>
  ops >= 1e6 ? `${(ops / 1e6).toFixed(1)}M` : `${Math.round(ops / 1e3)}K`

const best = {}
for (let round = 0; round < ROUNDS; round++) {
  for (const routeCount of ROUTE_COUNTS) {
    const url = `/route${routeCount - 1}/42`
    for (const [name, build] of [
      ['express', buildExpress],
      ['ours', buildOurs]
    ]) {
      const ops = opsPerSecond(build(routeCount), url)
      const key = `${name}:${routeCount}`
      if (ops > (best[key] || 0)) best[key] = ops
    }
  }
}

console.log(`node ${process.version} · best of ${ROUNDS} · hitting the last route\n`)
console.log('| Routes | `express@router` | `router-http` |')
console.log('|--------|------------------|---------------|')
for (const routeCount of ROUTE_COUNTS) {
  const mine = format(best[`ours:${routeCount}`])
  const theirs = format(best[`express:${routeCount}`])
  console.log(`| ${routeCount} | ~${theirs} ops/sec | **~${mine} ops/sec** |`)
}
