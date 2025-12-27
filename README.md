# router-http

![Last version](https://img.shields.io/github/tag/Kikobeats/router-http.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/router-http.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/router-http)
[![NPM Status](https://img.shields.io/npm/dm/router-http.svg?style=flat-square)](https://www.npmjs.org/package/router-http)

- [router-http](#router-http)
  - [Install](#install)
  - [Usage](#usage)
    - [Options](#options)
    - [Declaring routes](#declaring-routes)
    - [Declaring middlewares](#declaring-middlewares)
    - [Nested routers](#nested-routers)
      - [Exit Current Router](#exit-current-router)
    - [Using the router](#using-the-router)
    - [Request Object](#request-object)
  - [Benchmark](#benchmark)
  - [Related](#related)
  - [License](#license)

A middleware style router, similar to [express@router](https://github.com/pillarjs/router), plus:

- **Predictable Performance**: Unlike the Express router, which is based on regex patterns, `router-http` is backed by [find-my-way](https://github.com/delvedor/find-my-way), a Trie-based router. This means lookup time remains constant regardless of the number of routes.
- **Maintained and well tested**: Built for reliability and long-term maintenance.
- **Small footprint**: Extremely lightweight (1.8 kB).

The Express router implementation is based on regex detection that degrades linearly with the number of routes because it has to test multiple regex patterns:

| Number of Routes | `trouter` (ops/sec) | `find-my-way` (ops/sec) | Winner |
| :--- | :--- | :--- | :--- |
| **5 routes** | ~10.7M | **~13.7M** | **find-my-way** |
| **10 routes** | ~6.5M | **~13.7M** | **find-my-way** |
| **50 routes** | ~1.5M | **~11.5M** | **find-my-way** |
| **1000 routes** | ~41k | **~10.6M** | **find-my-way** |

In contrast, router-http is backed by a trie-based implementation that maintains nearly constant performance regardless of the number of routes.

## Install

```bash
$ npm install router-http --save
```

## Usage

First, you should to create a router:

```js
const createRouter = require('router-http')

const router = createRouter((error, req, res) => {
  const hasError = error !== undefined
  res.statusCode = hasError ? error.statusCode ?? 500 : 404
  res.end(hasError ? error.message ?? 'Internal Server Error' : 'Not Found')
})
```

The router requires a final handler that will be called if an error occurred or none of the routes match.

### Options

You can pass a second argument to the router constructor to customize the underlying [find-my-way](https://github.com/delvedor/find-my-way) instance:

```js
const router = createRouter(final, {
  caseSensitive: false,
  ignoreTrailingSlash: true
})
```

See all the available options in the [find-my-way](https://github.com/delvedor/find-my-way#options) documentation.

### Declaring routes

The routes are declared using HTTP verbs:

```js
/**
 * Declaring multiple routes based on the HTTP verb.
 */
router
  .get('/', (req, res) => {
    res.statusCode = 204
    res.end()
  })
  .post('/ping', (req, res) => res.end('pong'))
  .get('/greetings/:name', (req, res) => {
    const { name } = req.params
    res.end(`Hello, ${name}!`)
  })
```

Alternatively, you can call `.all` for associate a route for all the verbs:

```js
/**
 * Declaring a route to match all the HTTP verbs.
 */
router.all('/ping', (req, res) => res.end('pong'))
```

You can also pass handlers as arrays, which is useful for reusing middleware chains:

```js
const authMiddleware = (req, res, next) => {
  // authentication logic
  next()
}

const logMiddleware = (req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
}

const commonMiddlewares = [authMiddleware, logMiddleware]

router.get('/protected', commonMiddlewares, (req, res) => {
  res.end('Protected content')
})
```

### Declaring middlewares

A middleware can be declared at root level:

```js
/**
 * Declaring a middleware that will be always executed.
 */
router
  .use('/', (req, res, next) => {
    req.timestamp = Date.now()
    next()
  })
```

or for specific routes:

```js
/**
 * Declaring a middleware to execute for a certain route path.
 */
router
  .use('/greetings', (req, res, next) => {
    req.greetings = 'Greetings'
    next()
  })
  .get('/greetings/:username', (req, res) => {
    res.end(`${req.greetings}, ${req.params.username}`)
  })
```

Also, you can declare conditional middlewares:

```js
/**
 * Just add the middleware if it's production environment
 */
router
  .use(process.env.NODE_ENV === 'production' && authentication())
```

They are only will add if the condition is satisfied.

Middlewares always run **before** route handlers, regardless of declaration order. This means you can declare `.use()` before or after `.get()` / `.post()` / etc., and the middleware will still execute first.

### Nested routers

You can use a router as a middleware for another router. This is useful for prefixing routes or for modularizing your application.

When a sub-router is used as a middleware, it will only handle requests that match its prefix. If no route matches inside the sub-router, it will automatically call `next()` to pass control back to the parent router.

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

#### Exit Current Router

You can use `next('router')` to skip all remaining handlers in the current router and pass control back to the parent router. This is useful for conditional routing, such as a "Beta" router that only handles requests for certain users:

```js
const beta = createRouter(final)

// Middleware to check if the user is a beta tester
beta.use((req, res, next) => {
  if (!req.isBetaTester) return next('router')
  next()
})

beta.get('/search', (req, res) => {
  res.end('Using the new AI-powered search engine!')
})

const router = createRouter(final)

// Mount the beta router
router.use('/v1', beta)

// This will be reached if:
// 1. The user is NOT a beta tester (next('router') was called)
// 2. Or the path didn't match anything inside the beta router
router.get('/v1/search', (req, res) => {
  res.end('Using the classic search engine.')
})
```

### Using the router

After the router has been initialized, start using it as handler in your Node.js server:

```js
const server = http.createServer(router)
```

### Request Object

The router enhances the `req` object with the following fields:

- **`req.path`**: The pathname of the URL.
- **`req.params`**: An object containing the parameters from the route pattern.
- **`req.query`**: The raw query string (the part after the `?`).
- **`req.search`**: The raw search string (including the `?`).

Note that `req.query` and `req.search` will only be populated if they aren't already present on the request object.

## Benchmark

With all the improvements, `router-http` is approximately 30% faster than the express router for a single route. More importantly, while Express performance degrades linearly as you add more routes (due to regex matching), `router-http` performance remains constant.

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

See more details, check [benchmark](/benchmark) section.

## Related

- [send-http](https://github.com/Kikobeats/send-http) – A `res.end` with data type detection.
- [http-body](https://github.com/Kikobeats/http-body) – Parse the http.IncomingMessage body into text/json/buffer.
- [http-compression](https://github.com/Kikobeats/http-compression) – Adding compression (gzip/brotli) for your HTTP server in Node.js.

## License

Full credits to [Luke Edwards](https://github.com/lukeed) for writing [Polka](https://github.com/lukeed/polka) and inspired this project.

**router-http** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/router-http/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/Kikobeats/router-http/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
