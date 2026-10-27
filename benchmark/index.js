'use strict'

const { writeFileSync } = require('fs')
const { join } = require('path')
const FindMyWay = require('find-my-way')

const createRouter = require('..')

const RUNS = 7
const REQUESTS = 1_000_000

const median = values => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const createResponse = () => ({
  statusCode: 200,
  writableEnded: false,
  headers: {},
  body: undefined,
  setHeader (name, value) {
    this.headers[name] = value
  },
  end (body) {
    this.body = body
    this.writableEnded = true
  }
})

const finalHandler = (err, req, res) => {
  res.statusCode = err ? 500 : 404
  res.end(err ? err.message : 'Not Found')
}

const sendUser = (req, res) => res.end(req.params.id)

const markOne = (req, res, next) => {
  req.one = true
  next()
}

const markTwo = (req, res, next) => {
  req.two = true
  next()
}

const routerWith = configure => {
  const router = createRouter(finalHandler)
  configure(router)
  return router
}

const userRoutes = router => router.get('/', (req, res) => res.end('home')).get('/user/:id', sendUser)

const rawFindMyWay = () => {
  const router = FindMyWay()
  router.on('GET', '/user/:id', sendUser)
  return (req, res) => {
    const match = router.find(req.method, req.url)
    req.params = match.params
    match.handler(req, res)
  }
}

const CASES = [
  {
    name: 'static route',
    url: '/',
    dispatch: routerWith(userRoutes),
    expected: { statusCode: 200, body: 'home' }
  },
  {
    name: 'param route',
    url: '/user/123?x=1',
    dispatch: routerWith(userRoutes),
    expected: { statusCode: 200, body: '123' }
  },
  {
    name: 'param route 2 middlewares',
    url: '/user/123?x=1',
    dispatch: routerWith(router => userRoutes(router.use(markOne, markTwo))),
    expected: { statusCode: 200, body: '123', one: true, two: true }
  },
  {
    name: 'not found',
    url: '/missing/path',
    dispatch: routerWith(userRoutes),
    expected: { statusCode: 404, body: 'Not Found' }
  },
  {
    name: 'control raw find-my-way',
    url: '/user/123?x=1',
    dispatch: rawFindMyWay(),
    expected: { statusCode: 200, body: '123' }
  }
]

const matches = (req, res, expected) =>
  res.writableEnded &&
  res.statusCode === expected.statusCode &&
  res.body === expected.body &&
  (expected.one === undefined || req.one === expected.one) &&
  (expected.two === undefined || req.two === expected.two)

const serve = entry => {
  const { dispatch, url, expected } = entry
  let failures = 0
  for (let i = 0; i < REQUESTS; i++) {
    const req = { method: 'GET', url, headers: {} }
    const res = createResponse()
    dispatch(req, res)
    if (!matches(req, res, expected)) failures++
  }
  if (failures > 0) throw new Error(`${entry.name}: ${failures} wrong responses`)
}

const sample = entry => {
  const samples = []
  let errors = 0
  for (let run = 0; run < RUNS; run++) {
    const started = process.hrtime.bigint()
    try {
      serve(entry)
      samples.push(Number(process.hrtime.bigint() - started) / 1e6)
    } catch (error) {
      errors++
      console.error(error)
    }
  }
  return { samples, errors }
}

const fmt = value => value.toFixed(1)

const report = (entry, { samples, errors }) => {
  const med = samples.length ? median(samples) : Number.NaN
  const min = samples.length ? Math.min(...samples) : Number.NaN
  const max = samples.length ? Math.max(...samples) : Number.NaN
  const extra = `work ${REQUESTS} requests ${entry.url}, errors ${errors}, runs ${RUNS}`
  console.log(`${entry.name}  median ${fmt(med)}ms  range ${fmt(min)}-${fmt(max)}  ${extra}`)
  return {
    name: entry.name,
    unit: 'ms',
    value: Number(fmt(med)),
    range: `${fmt(min)}-${fmt(max)}`,
    extra
  }
}

const main = () => {
  const results = []
  let errors = 0
  for (const entry of CASES) {
    try {
      serve(entry)
    } catch (error) {
      errors++
      console.error(error)
    }
    const result = sample(entry)
    errors += result.errors
    results.push(report(entry, result))
  }
  writeFileSync(
    join(__dirname, '..', 'benchmark-output.json'),
    JSON.stringify(results, null, 2) + '\n'
  )
  if (errors > 0 || results.some(result => !Number.isFinite(result.value))) {
    process.exitCode = 1
  }
}

main()
