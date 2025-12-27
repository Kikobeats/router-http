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
    - [Print routes](#print-routes)
    - [Nested routers](#nested-routers)
    - [Skipping to parent router](#skipping-to-parent-router)
  - [Benchmark](#benchmark)
  - [Related](#related)
  - [License](#license)


A middleware-style router similar to [express router](https://github.com/pillarjs/router), with key advantages:

- **Predictable performance** – Backed by [find-my-way](https://github.com/delvedor/find-my-way), a trie-based router with constant O(1) lookup time.
- **Battle-tested** – Well maintained with comprehensive test coverage.
- **Lightweight** – Only 1.3 kB (minifized + gzipped)

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

console.log(router.prettyPrint())
// └── / (GET)
//     ├── favicon.ico (GET)
//     └── user/
//         └── :id (GET)

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

> `req.query` and `req.search` are only set if not already present.

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
