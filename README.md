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

### Prefixing routes

In case you need you can prefix all the routes:

```js
routes.get('/', (req, res) => res.end('Welcome to my API!'))

/**
 * Prefix all routes with the API version
 */
const router = createRouter(final)
router
  .use('/latest', routes)
  .use('/v1', routes)
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

**router-http@1.0.0**

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.33ms  690.36us  30.28ms   97.16%
    Req/Sec     9.27k     1.09k   11.76k    89.58%
  2214097 requests in 30.02s, 276.61MB read
Requests/sec:  73754.53
Transfer/sec:      9.21MB
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
