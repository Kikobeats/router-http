# router-http

![Last version](https://img.shields.io/github/tag/Kikobeats/router-http.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/router-http.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/router-http)
[![NPM Status](https://img.shields.io/npm/dm/router-http.svg?style=flat-square)](https://www.npmjs.org/package/router-http)

- [router-http](#router-http)
  - [Why not Express router?](#why-not-express-router)
  - [Installation](#installation)
  - [Getting Started](#getting-started)
    - [Declaring routes](#declaring-routes)
    - [Declaring middlewares](#declaring-middlewares)
    - [Starting the server](#starting-the-server)
  - [Advanced](#advanced)
    - [Request object](#request-object)
    - [Mounted middleware](#mounted-middleware)
    - [Print routes](#print-routes)
    - [Nested routers](#nested-routers)
    - [Skipping to parent router](#skipping-to-parent-router)
  - [Benchmark](#benchmark)
  - [Related](#related)
  - [License](#license)

A middleware-style router similar to [express router](https://github.com/pillarjs/router), with key advantages:

- **Predictable performance** – Backed by [find-my-way](https://github.com/delvedor/find-my-way), a radix-trie router whose lookup cost tracks the path length rather than the number of routes.
- **Battle-tested** – Well maintained with comprehensive test coverage.
- **Lightweight** – Around 2 kB (minified + gzipped)

## Why not Express router?

Express matches routes by walking a list of regexes, so dispatch slows down as routes are added. Requests here hit the last route registered — the worst case for a list, and no different from the first for a trie:

| Routes | `express@router` | `router-http` |
|--------|------------------|---------------|
| 5 | ~2.6M ops/sec | **~8.5M ops/sec** |
| 10 | ~2.1M ops/sec | **~8.5M ops/sec** |
| 50 | ~891K ops/sec | **~7.6M ops/sec** |
| 1000 | ~23K ops/sec | **~7.0M ops/sec** |

Across that range the express router loses 113× of its throughput; **router-http** loses 1.2×. Regenerate the table with `npm run benchmark:routes`.

## Installation

```bash
npm install router-http
```

## Getting Started

First, define a handler for errors and unmatched routes:

```js
const createRouter = require('router-http')

const finalHandler = (error, req, res) => {
  if (error) {
    res.statusCode = 500
    res.end(error.message)
  } else {
    res.statusCode = 404
    res.end('Not Found')
  }
}

const router = createRouter(finalHandler)
```

You can also pass [find-my-way options](https://github.com/delvedor/find-my-way#options) as a second argument:

```js
const router = createRouter(finalHandler, {
  caseSensitive: false,
  ignoreTrailingSlash: true
})
```

### Declaring routes

Use HTTP verb methods to define your routes:

```js
router
  .get('/', (req, res) => res.end('Hello World'))
  .post('/users', (req, res) => res.end('User created'))
  .put('/users/:id', (req, res) => res.end('User updated'))
  .delete('/users/:id', (req, res) => res.end('User deleted'))
```

Use `.all()` to match any HTTP method:

```js
router.all('/ping', (req, res) => res.end('pong'))
```

The dynamic segments will be captured using the `:param` syntax, with parameters accessible via `req.params`:

```js
router.get('/users/:id', (req, res) => {
  res.end(`User ID: ${req.params.id}`)
})

router.get('/posts/:year/:month', (req, res) => {
  const { year, month } = req.params
  res.end(`Posts from ${month}/${year}`)
})
```

See [Request object](#request-object) for details on how to access route parameters and other useful properties added to `req`.

### Declaring middlewares

A middleware is declared using `.use()`. it will be added globally before running any route:

```js
// Global middleware (runs on every request)
router
  .use((req, res, next) => {
    req.timestamp = Date.now()
    next()
})
```

You can also declare middleware specific to routes:

```js
const auth = (req, res, next) => { /* verify token */ next() }
const log = (req, res, next) => { /* log request */ next() }

const protected = [auth, log]

router
  .get('/admin', protected, (req, res) => res.end('Admin panel'))
  .get('/settings', protected, (req, res) => res.end('Settings'))
```

If you want to add a middleware conditionally, just return a falsy value:

```js
router
  .use(process.env.NODE_ENV === 'production' && rateLimiter())
```

### Starting the server

The router is a standard request handler. Pass it to `http.createServer`:

```js
const http = require('http')

http.createServer(router).listen(3000)
```

## Advanced

### Request object

The router adds these properties to `req`:

| Property | Description |
|----------|-------------|
| `req.path` | URL pathname |
| `req.params` | Route parameters object |
| `req.query` | Raw query string (after `?`) |
| `req.search` | Raw search string (including `?`) |
| `req.baseUrl` | Mount prefix while a mounted middleware runs; the inherited prefix otherwise, `''` at the top level |
| `req.originalUrl` | The request target as the client sent it |

`req.path` ends where find-my-way stops matching: at the first `?` or `#`, or `;` with `useSemicolonDelimiter`. Absolute-form targets like `GET http://example.com/foo` are reduced to origin form, and `ignoreDuplicateSlashes` / `ignoreTrailingSlash` are applied. It stays percent-encoded.

`req.query` and `req.search` are whatever sits between `?` and `#` — a `?` inside a fragment is fragment content, not a query. Being two shapes of one string, they are set together and only if neither already holds a value.

> An `onBadUrl` or `onMaxParamLength` handler runs as the route handler and must end the response — one that only sets `statusCode` leaves the request hanging.

### Mounted middleware

`.use(path, ...fns)` mounts middleware under a path prefix, following Express semantics.

Every mount whose prefix matches runs, in registration order — not just the longest one:

```js
router.use('/admin', authorize)
router.use('/admin/panel', audit)
router.get('/admin/panel/secret', handler)

// GET /admin/panel/secret runs authorize, then audit, then handler
```

While a mount runs, the request is rooted at that mount: `req.url` and `req.path` have the prefix removed and `req.baseUrl` holds it. The frame is undone afterwards, so the route handler sees the full request:

```js
router.use('/admin', (req, res, next) => {
  req.baseUrl // '/admin'
  req.url     // '/panel/secret'
  next()
})
router.get('/admin/panel/secret', (req, res) => {
  req.baseUrl // ''
  req.url     // '/admin/panel/secret'
})
```

That is what makes `.use(path, subRouter)` work: the sub-router runs inside the frame and sees itself at the root. `req.baseUrl` accumulates through nesting, and the tail keeps the slashes the client sent — duplicates and trailing included, even when this router is collapsing them.

### Print routes

You can visualize your router's routes in a readable tree format using the `router.prettyPrint()` method. This is especially helpful for debugging or understanding your route structure at a glance.

For example:

```js
const http = require('http')

console.log(router.prettyPrint())
// └── / (GET)
//     ├── favicon.ico (GET)
//     └── user/
//         └── :id (GET)

http.createServer(router).listen(3000)
```

The printed output shows the nested structure of your routes along with their registered HTTP methods. It covers the routes registered on this router only — a sub-router mounted with `.use()` holds its own routing table and prints its own tree. The `routes` getter has the same scope.

See more in [find-my-way prettyPrint documentation](https://github.com/delvedor/find-my-way#routerprettyprint).

### Nested routers

You can use a router as a middleware for another router. This is useful for prefixing routes or for modularizing your application:

```js
const createRouter = require('router-http')
const http = require('http')

const final = (err, req, res) => {
  res.statusCode = err ? 500 : 404
  res.end(err ? err.message : 'Not Found')
}

// 1. Create a sub-router for API v1
const v1 = createRouter(final)
v1.get('/info', (req, res) => res.end('v1 info'))

// 2. Create another sub-router for API v2
const v2 = createRouter(final)
v2.get('/info', (req, res) => res.end('v2 info'))

// 3. Create the main router and mount sub-routers
const router = createRouter(final)

router
  .use('/v1', v1)
  .use('/v2', v2)
  .get('/', (req, res) => res.end('Welcome to the main router'))

http.createServer(router).listen(3000)
```

When a sub-router is used as a middleware, it will only handle requests that match its prefix. If no route matches inside the sub-router, it will automatically call `next()` to pass control back to the parent router.

### Skipping to parent router

Use `next('router')` to exit the current router and pass control back to the parent:

```js
const beta = createRouter(finalHandler)

beta.use((req, res, next) => {
  if (!req.isBetaTester) return next('router')
  next()
})

beta.get('/feature', (req, res) => res.end('Beta feature'))

router.use('/v1', beta)
router.get('/v1/feature', (req, res) => res.end('Stable feature'))
```

## Benchmark

Over HTTP, against the same two-middleware app in [benchmark](/benchmark). Best of three interleaved 30s runs, `wrk -t8 -c100`, node v26.6.0:

| | Requests/sec |
|---|---|
| **router-http** | **110,983** |
| polka | 108,444 |
| express | 85,985 |

About 29% ahead of the express router. Reproduce with `npm run benchmark` — it warms each server, interleaves the rounds so a busy moment cannot land on one of them, and prints the load average alongside the result.

## Related

- [send-http](https://github.com/Kikobeats/send-http) – `res.end` with data type detection
- [http-body](https://github.com/Kikobeats/http-body) – Parse request body to text/json/buffer
- [http-compression](https://github.com/Kikobeats/http-compression) – Gzip/Brotli compression middleware

## License

**router-http** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/router-http/blob/master/LICENSE.md) License.

Credits to [Luke Edwards](https://github.com/lukeed) for [Polka](https://github.com/lukeed/polka) which inspired this project.
