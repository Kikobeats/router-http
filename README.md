# router-http

![Last version](https://img.shields.io/github/tag/Kikobeats/router-http.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/router-http.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/router-http)
[![NPM Status](https://img.shields.io/npm/dm/router-http.svg?style=flat-square)](https://www.npmjs.org/package/router-http)

A middleware style router, similar to [express@router](https://github.com/pillarjs/router), plus:

- Faster (x3 compared with Express).
- Maintained and well tested.
- Smaller (1.4 kB).

Don't get me wrong: The original Express router is a piece of art. I used it for years and I just considered create this library after experienced a bug that never was addressed in the stable version due to the [lack of maintenance](https://github.com/pillarjs/router/pull/60).

While I was evaluating the market for finding an alternative, I found [polka](https://github.com/lukeed/polka/tree/master/packages/polka) was a good starting point for creating a replacement. This library is different from polka in that it only contains the code that is strictly necessary for routing, nothing else.

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

## Benchmark

**express@4.18.2**

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     4.12ms  653.26us  21.71ms   89.35%
    Req/Sec     2.93k   159.60     5.99k    84.75%
  700421 requests in 30.06s, 102.87MB read
Requests/sec:  23304.22
Transfer/sec:      3.42MB
```

**router-http@1.0.12**

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.12ms    2.19ms  86.47ms   99.55%
    Req/Sec    11.94k   756.06    13.04k    94.31%
  959711 requests in 10.10s, 119.90MB read
Requests/sec:  95014.35
Transfer/sec:     11.87MB
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
