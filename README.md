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
    - [Express compatibility](#express-compatibility)
    - [Print routes](#print-routes)
    - [Nested routers](#nested-routers)
    - [Skipping to parent router](#skipping-to-parent-router)
  - [Benchmark](#benchmark)
  - [Related](#related)
  - [License](#license)


A middleware-style router similar to [express router](https://github.com/pillarjs/router), with key advantages:

- **Predictable performance** – Backed by [find-my-way](https://github.com/delvedor/find-my-way), a trie-based router with constant O(1) lookup time.
- **Battle-tested** – Well maintained with comprehensive test coverage.
- **Lightweight** – Only 2 kB (minified + gzipped)

## Why not Express router?

Express uses regex-based route matching that degrades linearly as routes increase:

| Routes | `express@router` | `router-http` |
|--------|-----------|---------------|
| 5      | ~10.7M ops/sec | **~13.7M ops/sec** |
| 10     | ~6.5M ops/sec | **~13.7M ops/sec** |
| 50     | ~1.5M ops/sec | **~11.5M ops/sec** |
| 1000   | ~41K ops/sec | **~10.6M ops/sec** |

In contrast, **router-http** is backed by a trie-based implementation that maintains nearly constant performance regardless of the number of routes.

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
| `req.baseUrl` | Mount prefix, while a mounted middleware runs |
| `req.originalUrl` | The request target as the client sent it |

> `req.query` and `req.search` are only set if not already present.

`req.path` ends where find-my-way stops matching: at the first `?` or `#` (and at the first `;` when `useSemicolonDelimiter` is enabled). Absolute-form request lines such as `GET http://example.com/foo` are reduced to their origin form, and `ignoreDuplicateSlashes` / `ignoreTrailingSlash` are applied. It stays percent-encoded, where find-my-way matches on the decoded path.

The query is what sits between `?` and `#`. A `?` inside a fragment is fragment content, not a query string.

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

That is what makes `.use(path, subRouter)` work: the sub-router runs inside the frame and sees itself at the root. `req.baseUrl` accumulates through nesting, and `req.originalUrl` always holds the target the client sent.

Only the mount's own prefix is removed, so a sub-router receives the tail as the client sent it — duplicate and trailing slashes included, even when this router is collapsing them. The one rewrite that survives into the tail is absolute-form: `GET http://example.com/v1/info` reaches a `/v1` sub-router as `/info`.

Which mounts match is decided once, from the incoming target, before any middleware runs. A middleware that rewrites `req.url` still has its rewrite honoured — the frame strips from the rewritten value — but it cannot bring a new mount into play:

```js
router.use((req, res, next) => {
  req.url = '/admin/x'
  next()
})
router.use('/admin', authorize) // does not run for GET /other
```

This is the one place the router diverges from Express, which re-matches after every layer.

> **Fixed.** The mount prefix used to be stripped permanently, so a route handler saw a `req.path` that had nothing to do with the path its route was registered and matched against: `.get('/admin/:id')` handling `/admin/42` reported `req.path` as `/42` while `req.params.id` was `42`. Adding an unrelated `.use('/admin')` was enough to change what `req.path` meant inside a route handler. The strip is now scoped to the mount that needs it. If you were reading the stripped prefix in a route handler, it is in `req.baseUrl`.

An `onBadUrl` or `onMaxParamLength` handler must end the response. It runs as the route handler, after global and mount middleware, and the chain stops there — a handler that only sets `statusCode` leaves the request hanging.

### Express compatibility

Middleware behaviour is checked against [`router`](https://github.com/pillarjs/router), the router Express itself uses, by running the same cases through both and comparing the middleware trace and the response. These match:

- every mount whose prefix matches runs, in registration order
- re-registering the same mount path keeps its position in that order
- a global registered after a mount runs after it, and sees the unstripped request
- a mount sees `req.url` stripped and `req.baseUrl` set; the route handler sees neither
- `req.baseUrl` accumulates through nested routers, and `req.originalUrl` is the target the client sent
- `next(null)` continues; `next('route')` from middleware continues to the next layer
- a `req.url` rewritten before a mount survives the frame
- trailing-slash and exact mount matches, query strings, and falling through to the parent

One deliberate difference: a mount registered decoded matches a percent-encoded request.

```js
router.use('/café', authorize)
router.get('/café/secret', handler)

// GET /caf%C3%A9/secret
// pillarjs/router: neither the mount nor the route matches
// router-http:     both match, so authorize runs
```

find-my-way matches routes on the decoded path, so mounts have to be matched the same way. Matching them literally would let the route run with its mount skipped, which for an auth mount is a bypass.

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

The printed output shows the nested structure of your routes along with their registered HTTP methods. This works for both flat and deeply nested routers, including those mounted via `.use()`.

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

With all the improvements, **router-http** is approximately 30% faster than the express router:

**express@5.2.1**

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.23ms    1.40ms  96.27ms   99.61%
    Req/Sec    10.15k   615.89    11.07k    86.24%
  2430687 requests in 30.10s, 356.98MB read
Requests/sec:  80752.48
Transfer/sec:     11.86MB
```

**router-http**

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     0.97ms    1.27ms  84.82ms   99.77%
    Req/Sec    12.91k     1.07k   14.67k    71.51%
  3092927 requests in 30.10s, 386.40MB read
Requests/sec: 102751.65
Transfer/sec:     12.84MB
```

See [benchmark](/benchmark) for details.

## Related

- [send-http](https://github.com/Kikobeats/send-http) – `res.end` with data type detection
- [http-body](https://github.com/Kikobeats/http-body) – Parse request body to text/json/buffer
- [http-compression](https://github.com/Kikobeats/http-compression) – Gzip/Brotli compression middleware

## License

**router-http** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/router-http/blob/master/LICENSE.md) License.

Credits to [Luke Edwards](https://github.com/lukeed) for [Polka](https://github.com/lukeed/polka) which inspired this project.
